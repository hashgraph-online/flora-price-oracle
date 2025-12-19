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
  PrivateKey,
  TopicCreateTransaction,
} from "@hashgraph/sdk";
import { getState, setState } from "./persistence.js";
import { buildHederaClient } from "../lib/hedera-client.js";
import type { HederaKeyType } from "../lib/operator-key-type.js";

export type FloraNetwork = {
  floraAccountId: string;
  stateTopicId: string;
  coordinationTopicId: string;
  transactionTopicId: string;
};

const logger = new Logger({ module: "flora-consumer" });

const normalizeValue = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const storeStateValue = async (key: string, value?: string): Promise<void> => {
  if (!value) return;
  await setState(key, value);
};

const parseMemberKeys = (memberPrivateKeys: string[]): PrivateKey[] =>
  memberPrivateKeys.map((key) => PrivateKey.fromStringECDSA(key));

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

const waitForKeyLists = async (
  client: HCS16Client,
  members: string[],
  threshold: number,
): Promise<{ adminKey: KeyList; submitKey: KeyList }> => {
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const adminKey = await client.assembleKeyList({ members, threshold });
      const submitKey = await client.assembleSubmitKeyList(members);
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
      const submitList = await client.assembleSubmitKeyList(members);

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

  if (floraAccountId && resolvedState && resolvedCoordination && resolvedTransaction) {
    await storeStateValue("state_topic_id", stateTopicEnv);
    await storeStateValue("coordination_topic_id", coordinationTopicEnv);
    await storeStateValue("transaction_topic_id", transactionTopicEnv);
    return {
      floraAccountId,
      stateTopicId: resolvedState,
      coordinationTopicId: resolvedCoordination,
      transactionTopicId: resolvedTransaction,
    };
  }

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
