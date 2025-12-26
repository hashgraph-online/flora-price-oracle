import {
  HCS16Client,
  FloraTopicType,
  Logger,
  type NetworkType,
} from "@hashgraphonline/standards-sdk";
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  KeyList,
  TopicUpdateTransaction,
  TopicCreateTransaction,
} from "@hashgraph/sdk";
import type { PrivateKey } from "@hashgraph/sdk";
import { getState, setState } from "./persistence.js";
import { buildHederaClient } from "../lib/hedera-client.js";
import type { HederaKeyType } from "../lib/operator-key-type.js";
import { parsePrivateKey } from "../lib/hedera-private-key.js";
import { fetchWithTimeout } from "../lib/http.js";

export type FloraNetwork = {
  floraAccountId: string;
  stateTopicId: string;
  coordinationTopicId: string;
  transactionTopicId: string;
};

const logger = new Logger({ module: "flora-consumer" });
const submitKeyStateKey = "flora_submit_keys_updated";
const submitKeyUpdateMemo = "hcs-16:op:1:1";

const normalizeValue = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const storeStateValue = async (key: string, value?: string): Promise<void> => {
  if (!value) return;
  await setState(key, value);
};

const parseMemberKeys = (memberPrivateKeys: string[]) =>
  memberPrivateKeys.map((key) => parsePrivateKey(key));

const normalizeMirrorBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -"/api/v1".length) : trimmed;
};

const readVarint = (
  bytes: Uint8Array,
  startOffset: number,
): { value: number; offset: number } | null => {
  let result = 0;
  let shift = 0;
  let offset = startOffset;
  for (let idx = 0; idx < 10 && offset < bytes.length; idx += 1) {
    const byte = bytes[offset];
    if (byte === undefined) return null;
    result |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) {
      return { value: result, offset };
    }
    shift += 7;
  }
  return null;
};

const hexToBytes = (hex: string): Uint8Array | null => {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return null;
  if (trimmed.length % 2 !== 0) return null;
  const out = new Uint8Array(trimmed.length / 2);
  for (let idx = 0; idx < out.length; idx += 1) {
    const value = Number.parseInt(trimmed.slice(idx * 2, idx * 2 + 2), 16);
    if (!Number.isFinite(value)) return null;
    out[idx] = value;
  }
  return out;
};

const decodeThresholdFromProtobufKey = (hexKey: string): number | null => {
  const bytes = hexToBytes(hexKey);
  if (!bytes || bytes.length < 3) return null;

  const tag = readVarint(bytes, 0);
  if (!tag || tag.value !== 0x2a) return null;

  const length = readVarint(bytes, tag.offset);
  if (!length) return null;
  if (length.value <= 0) return null;

  const start = length.offset;
  const end = start + length.value;
  if (end > bytes.length) return null;

  const inner = bytes.slice(start, end);
  const innerTag = readVarint(inner, 0);
  if (!innerTag || innerTag.value !== 0x08) return null;
  const threshold = readVarint(inner, innerTag.offset);
  if (!threshold) return null;
  return threshold.value;
};

type MirrorTopicInfo = {
  submit_key?: { _type?: string; key?: string };
};

const fetchTopicSubmitThreshold = async (params: {
  mirrorBaseUrl: string;
  topicId: string;
}): Promise<number | null> => {
  const base = normalizeMirrorBaseUrl(params.mirrorBaseUrl);
  const url = `${base}/api/v1/topics/${params.topicId}`;
  const response = await fetchWithTimeout(url, {}, 5000);
  if (!response.ok) return null;
  const body = (await response.json()) as MirrorTopicInfo;
  const encoded = body.submit_key?.key;
  if (!encoded) return null;
  return decodeThresholdFromProtobufKey(encoded);
};

const signAndExecuteTopicCreate = async (params: {
  client: Client;
  tx: TopicCreateTransaction;
  memberKeys: PrivateKey[];
}): Promise<string> => {
  const frozen = await params.tx.freezeWith(params.client);
  let signed = frozen;
  for (const key of params.memberKeys) {
    signed = await signed.sign(key);
  }
  const resp = await signed.execute(params.client);
  const receipt = await resp.getReceipt(params.client);
  if (!receipt.topicId) {
    throw new Error("Failed to create Flora topic");
  }
  return receipt.topicId.toString();
};

const updateTopicSubmitKey = async (params: {
  client: Client;
  topicId: string;
  submitKey: KeyList;
  memberKeys: PrivateKey[];
}): Promise<void> => {
  const tx = new TopicUpdateTransaction()
    .setTopicId(params.topicId)
    .setSubmitKey(params.submitKey)
    .setTransactionMemo(submitKeyUpdateMemo);

  const frozen = await tx.freezeWith(params.client);
  let signed = frozen;
  for (const key of params.memberKeys) {
    signed = await signed.sign(key);
  }
  const resp = await signed.execute(params.client);
  await resp.getReceipt(params.client);
};

const ensureSubmitKeysUpdated = async (params: {
  client: Client;
  topicIds: string[];
  submitKey: KeyList;
  memberKeys: PrivateKey[];
  mirrorBaseUrl: string;
}): Promise<void> => {
  const stored = normalizeValue(await getState(submitKeyStateKey));
  const topicThresholds = await Promise.all(
    params.topicIds.map(async (topicId) => {
      const threshold = await fetchTopicSubmitThreshold({
        mirrorBaseUrl: params.mirrorBaseUrl,
        topicId,
      }).catch(() => null);
      return { topicId, threshold };
    }),
  );

  const needsUpdate = topicThresholds
    .filter((entry) => typeof entry.threshold === "number" && entry.threshold !== 1)
    .map((entry) => entry.topicId);

  if (needsUpdate.length === 0) {
    if (stored !== "true") {
      await setState(submitKeyStateKey, "true");
    }
    return;
  }

  try {
    for (const topicId of needsUpdate) {
      await updateTopicSubmitKey({
        client: params.client,
        topicId,
        submitKey: params.submitKey,
        memberKeys: params.memberKeys,
      });
      logger.info("Updated flora topic submit key", { topicId });
    }
    await setState(submitKeyStateKey, "true");
  } catch (error) {
    logger.warn("Failed to update flora submit keys", { error });
  }
};

const waitForKeyLists = async (
  client: HCS16Client,
  members: string[],
  threshold: number,
): Promise<{ adminKey: KeyList; submitKey: KeyList }> => {
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const adminKey = await client.assembleKeyList({ members, threshold });
      const submitKey = await client.assembleKeyList({ members, threshold: 1 });
      return { adminKey, submitKey };
    } catch (error) {
      logger.warn("Waiting for petal keys to appear on mirror node", {
        attempt: attempt + 1,
        error,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Failed to resolve petal public keys from mirror node");
};

const createFloraWithRetry = async (
  client: HCS16Client,
  hederaClient: Client,
  memberKeys: PrivateKey[],
  members: string[],
  threshold: number,
): Promise<FloraNetwork> => {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const keyList = await client.assembleKeyList({ members, threshold });
      const submitList = await client.assembleKeyList({ members, threshold: 1 });

      const createAcc = await new AccountCreateTransaction()
        .setKey(keyList)
        .setInitialBalance(new Hbar(5))
        .setMaxAutomaticTokenAssociations(-1)
        .execute(hederaClient);
      const accReceipt = await createAcc.getReceipt(hederaClient);
      if (!accReceipt.accountId) {
        throw new Error("Failed to create Flora account");
      }
      const floraAccountId = accReceipt.accountId.toString();

      const txs = client.buildFloraTopicCreateTxs({
        floraAccountId,
        keyList,
        submitList,
      });
      txs.state.setSubmitKey(submitList);

      const communication = await signAndExecuteTopicCreate({
        client: hederaClient,
        tx: txs.communication,
        memberKeys,
      });
      const transaction = await signAndExecuteTopicCreate({
        client: hederaClient,
        tx: txs.transaction,
        memberKeys,
      });
      const state = await signAndExecuteTopicCreate({
        client: hederaClient,
        tx: txs.state,
        memberKeys,
      });

      return {
        floraAccountId,
        stateTopicId: state,
        coordinationTopicId: communication,
        transactionTopicId: transaction,
      };
    } catch (error) {
      logger.warn("Flora account creation retry", { attempt: attempt + 1, error });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Failed to create Flora account with topics");
};

export const resolveFloraNetwork = async (params: {
  operatorId: string;
  operatorKey: string;
  operatorKeyType?: HederaKeyType;
  network: NetworkType;
  mirrorBaseUrl: string;
  members: string[];
  memberPrivateKeys: string[];
  threshold: number;
}): Promise<FloraNetwork> => {
  if (params.members.length === 0) {
    throw new Error("At least one petal account is required to build a Flora");
  }
  if (params.memberPrivateKeys.length === 0) {
    throw new Error("At least one petal private key is required to create Flora topics");
  }

  const threshold = Math.min(Math.max(params.threshold, 1), params.members.length);
  const memberKeys = parseMemberKeys(params.memberPrivateKeys);

  const envFloraAccountId = normalizeValue(process.env.FLORA_ACCOUNT_ID);
  const storedFloraAccountId = normalizeValue(await getState("flora_account_id"));
  const floraAccountId = envFloraAccountId ?? storedFloraAccountId;
  await storeStateValue("flora_account_id", envFloraAccountId);

  const stateTopicEnv = normalizeValue(process.env.STATE_TOPIC_ID);
  const coordinationTopicEnv = normalizeValue(process.env.CTOPIC_ID);
  const transactionTopicEnv = normalizeValue(process.env.TTOPIC_ID);
  const storedStateTopic = normalizeValue(await getState("state_topic_id"));
  const storedCoordination = normalizeValue(await getState("coordination_topic_id"));
  const storedTransaction = normalizeValue(await getState("transaction_topic_id"));

  const resolvedState = stateTopicEnv ?? storedStateTopic;
  const resolvedCoordination = coordinationTopicEnv ?? storedCoordination;
  const resolvedTransaction = transactionTopicEnv ?? storedTransaction;
  await storeStateValue("state_topic_id", stateTopicEnv);
  await storeStateValue("coordination_topic_id", coordinationTopicEnv);
  await storeStateValue("transaction_topic_id", transactionTopicEnv);

  const floraClient = new HCS16Client({
    network: params.network,
    operatorId: params.operatorId,
    operatorKey: params.operatorKey,
    keyType: params.operatorKeyType,
    logger,
  });
  const hederaClient = buildHederaClient({
    network: params.network,
    operatorId: params.operatorId,
    operatorKey: params.operatorKey,
    operatorKeyType: params.operatorKeyType,
  });

  if (!floraAccountId) {
    const created = await createFloraWithRetry(
      floraClient,
      hederaClient,
      memberKeys,
      params.members,
      threshold,
    );
    await setState("flora_account_id", created.floraAccountId);
    await setState("state_topic_id", created.stateTopicId);
    await setState("coordination_topic_id", created.coordinationTopicId);
    await setState("transaction_topic_id", created.transactionTopicId);
    await setState(submitKeyStateKey, "false");

    const { submitKey } = await waitForKeyLists(floraClient, params.members, threshold);
    await ensureSubmitKeysUpdated({
      client: hederaClient,
      topicIds: [created.stateTopicId, created.coordinationTopicId, created.transactionTopicId],
      submitKey,
      memberKeys,
      mirrorBaseUrl: params.mirrorBaseUrl,
    });
    return created;
  }

  const { adminKey, submitKey } = await waitForKeyLists(
    floraClient,
    params.members,
    threshold,
  );

  const createTopic = async (
    topicType: FloraTopicType,
  ): Promise<string> => {
    const txs = floraClient.buildFloraTopicCreateTxs({
      floraAccountId,
      keyList: adminKey,
      submitList: submitKey,
    });
    let tx: TopicCreateTransaction;
    switch (topicType) {
      case FloraTopicType.COMMUNICATION:
        tx = txs.communication;
        break;
      case FloraTopicType.TRANSACTION:
        tx = txs.transaction;
        break;
      case FloraTopicType.STATE:
        tx = txs.state;
        tx.setSubmitKey(submitKey);
        break;
      default:
        throw new Error("Unsupported Flora topic type");
    }
    return await signAndExecuteTopicCreate({
      client: hederaClient,
      tx,
      memberKeys,
    });
  };

  const stateTopicId = resolvedState ?? (await createTopic(FloraTopicType.STATE));
  const coordinationTopicId =
    resolvedCoordination ?? (await createTopic(FloraTopicType.COMMUNICATION));
  const transactionTopicId =
    resolvedTransaction ?? (await createTopic(FloraTopicType.TRANSACTION));

  await ensureSubmitKeysUpdated({
    client: hederaClient,
    topicIds: [stateTopicId, coordinationTopicId, transactionTopicId],
    submitKey,
    memberKeys,
    mirrorBaseUrl: params.mirrorBaseUrl,
  });

  await setState("state_topic_id", stateTopicId);
  await setState("coordination_topic_id", coordinationTopicId);
  await setState("transaction_topic_id", transactionTopicId);
  return {
    floraAccountId,
    stateTopicId,
    coordinationTopicId,
    transactionTopicId,
  };
};
