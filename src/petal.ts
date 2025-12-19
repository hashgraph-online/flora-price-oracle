import dotenv from "dotenv";
import { TopicId } from "@hashgraph/sdk";
import {
  HCS21Client,
  HCS17Client,
  Logger,
  type NetworkType,
  canonicalize as canonicalizeHcs21,
  verifyDeclarationSignature,
} from "@hashgraphonline/standards-sdk";
import fetch from "node-fetch";
import { loadAdaptersFromRegistry, type Hcs21RegistryEntry } from "./adapters/registry.js";
import type { AdapterDeclaration } from "./adapters/declarations.js";
import type { AdapterRecord, PriceAdapter } from "./adapters/types.js";
import { canonicalize } from "./lib/canonicalize.js";
import { sha384 } from "./lib/hash.js";
import { getState, getSecureState, initDb, setState } from "./lib/db.js";
import { resolveNetwork } from "./lib/network.js";

dotenv.config();

const createPetalLogger = (petalId: string) =>
  Logger.getInstance({ module: `flora-petal:${petalId}` });

type PetalConfig = {
  petalId: string;
  accountId: string;
  privateKey: string;
  floraAccountId: string;
  participants: string[];
  floraThresholdFingerprint: string;
  blockTimeMs: number;
  epochOriginMs: number;
  stateTopicId: TopicId;
  coordinationTopicId: TopicId;
  transactionTopicId: TopicId;
  registryTopicId: string;
  mirrorBaseUrl: string;
  network: NetworkType;
  publisherPublicKey?: string;
};

type PetalOverrides = Partial<PetalConfig> & {
  adapters?: PriceAdapter[];
  adapterDeclarations?: AdapterDeclaration[];
};

type RegistryResolutionParams = {
  provided?: string;
};

const normalizePointer = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveRegistryTopicId = async (params: RegistryResolutionParams): Promise<string> => {
  const direct =
    normalizePointer(params.provided) ??
    normalizePointer(process.env.ADAPTER_CATEGORY_TOPIC_ID) ??
    normalizePointer(process.env.ADAPTER_REGISTRY_TOPIC_ID);
  await initDb();
  if (direct) {
    await setState("adapter_registry_category_topic_id", direct);
    return direct;
  }
  const stored = await getState("adapter_registry_category_topic_id");
  if (stored && stored.trim().length > 0) {
    return stored;
  }
  throw new Error("Adapter category topic not found. Ensure consumer has bootstrapped the registry.");
};

const resolveConfig = async (override?: PetalOverrides): Promise<PetalConfig> => {
  const resolvedPetalId = override?.petalId ?? process.env.PETAL_ID ?? "petal-unknown";
  const logger = createPetalLogger(resolvedPetalId);
  const participants = (process.env.FLORA_PARTICIPANTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const epochOriginStored = await getState("epoch_origin_ms");
  const epochOriginMs = override?.epochOriginMs ?? (epochOriginStored ? Number(epochOriginStored) : Date.now());

  const base: PetalConfig = {
    petalId: resolvedPetalId,
    accountId: "",
    privateKey: "",
    floraAccountId: "",
    participants,
    floraThresholdFingerprint: process.env.FLORA_THRESHOLD_FINGERPRINT ?? "demo-threshold",
    blockTimeMs: parseNumber(process.env.BLOCK_TIME_MS, 2000),
    epochOriginMs,
    stateTopicId: TopicId.fromString("0.0.0"),
    coordinationTopicId: TopicId.fromString("0.0.0"),
    transactionTopicId: TopicId.fromString("0.0.0"),
    registryTopicId: "",
    mirrorBaseUrl: process.env.MIRROR_BASE_URL ?? "https://testnet.mirrornode.hedera.com",
    network: resolveNetwork(process.env.HEDERA_NETWORK),
    publisherPublicKey: process.env.ADAPTER_PUBLISHER_KEY,
  };

  const merged: PetalConfig = { ...base, ...(override ?? {}) };
  if (merged.epochOriginMs > Date.now()) {
    merged.epochOriginMs = Date.now();
  }
  if (!epochOriginStored) {
    await setState("epoch_origin_ms", merged.epochOriginMs.toString());
  }

  const waitForAccount = async (): Promise<{ accountId: string; privateKey: string }> => {
    const overrideAccount = normalizePointer(merged.accountId);
    const overrideKey = normalizePointer(merged.privateKey);
    if (overrideAccount && overrideKey) {
      return { accountId: overrideAccount, privateKey: overrideKey };
    }

    const envAccount = normalizePointer(process.env.PETAL_ACCOUNT_ID ?? process.env.HEDERA_ACCOUNT_ID);
    const envKey = normalizePointer(process.env.PETAL_PRIVATE_KEY ?? process.env.HEDERA_PRIVATE_KEY);
    if (envAccount && envKey) {
      logger.info(`Using petal account from env: ${envAccount}`);
      return { accountId: envAccount, privateKey: envKey };
    }

    const accountKey = `petal_account_${resolvedPetalId}`;
    const privateKeyKey = `petal_private_key_${resolvedPetalId}`;
    for (let i = 0; i < 30; i += 1) {
      const storedAccount = await getState(accountKey);
      const storedPrivateKey = await getSecureState(privateKeyKey);
      if (storedAccount && storedPrivateKey) {
        logger.info(`Loaded petal account from db: ${storedAccount}`);
        return { accountId: storedAccount, privateKey: storedPrivateKey };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${accountKey} is required for Hedera publication`);
  };

  const { accountId, privateKey } = await waitForAccount();
  const registryTopicId = await resolveRegistryTopicId({
    provided: merged.registryTopicId,
  });

  const waitForValue = async (key: string, envValue?: string): Promise<string> => {
    const trimmed = normalizePointer(envValue);
    if (trimmed) {
      logger.info(`Using ${key} from env: ${trimmed}`);
      return trimmed;
    }
    for (let i = 0; i < 30; i += 1) {
      const value = normalizePointer(await getState(key));
      if (value) {
        logger.info(`Loaded ${key} from db: ${value}`);
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${key} is required for Hedera publication`);
  };

  const floraAccountId =
    normalizePointer(merged.floraAccountId) ??
    (await waitForValue("flora_account_id", process.env.FLORA_ACCOUNT_ID));

  const stateTopicId =
    override?.stateTopicId ??
    TopicId.fromString(await waitForValue("state_topic_id", process.env.STATE_TOPIC_ID));
  const coordinationTopicId =
    override?.coordinationTopicId ??
    TopicId.fromString(await waitForValue("coordination_topic_id", process.env.CTOPIC_ID));
  const transactionTopicId =
    override?.transactionTopicId ??
    TopicId.fromString(await waitForValue("transaction_topic_id", process.env.TTOPIC_ID));

  return {
    ...merged,
    registryTopicId,
    stateTopicId,
    coordinationTopicId,
    transactionTopicId,
    accountId,
    privateKey,
    floraAccountId,
  };
};

type ProofPayload = {
  epoch: number;
  stateHash: string;
  thresholdFingerprint: string;
  petalId: string;
  petalAccountId: string;
  floraAccountId: string;
  participants: string[];
  records: AdapterRecord[];
  timestamp: string;
  adapterFingerprints: Record<string, string>;
  registryTopicId: string;
};

const buildProof = (
  records: AdapterRecord[],
  epoch: number,
  config: PetalConfig,
  adapterFingerprints: Record<string, string>,
): ProofPayload => {
  const epochTimestamp = new Date(config.epochOriginMs + epoch * config.blockTimeMs).toISOString();
  const sortedRecords = [...records].sort((a, b) => {
    if (a.adapterId === b.adapterId) {
      return a.entityId.localeCompare(b.entityId);
    }
    return a.adapterId.localeCompare(b.adapterId);
  });

  const normalizedRecords = sortedRecords.map((record) => ({
    ...record,
    timestamp: epochTimestamp,
  }));

  const stateHash = sha384(
    canonicalize({
      records: normalizedRecords,
      thresholdFingerprint: config.floraThresholdFingerprint,
      adapterFingerprints,
      registryTopicId: config.registryTopicId,
    }),
  );

  return {
    epoch,
    stateHash,
    thresholdFingerprint: config.floraThresholdFingerprint,
    petalId: config.petalId,
    petalAccountId: config.accountId,
    floraAccountId: config.floraAccountId,
    participants: config.participants,
    records: normalizedRecords,
    timestamp: epochTimestamp,
    adapterFingerprints,
    registryTopicId: config.registryTopicId,
  };
};

const fetchRegistry = async (config: PetalConfig): Promise<Hcs21RegistryEntry[]> => {
  const logger = createPetalLogger(config.petalId);
  const client = new HCS21Client({
    network: config.network,
    operatorId: config.accountId,
    operatorKey: config.privateKey,
    mirrorNodeUrl: config.mirrorBaseUrl,
  });

  const categoryEntries = await client.fetchCategoryEntries(config.registryTopicId);
  const entries: Hcs21RegistryEntry[] = [];

  for (const entry of categoryEntries) {
    try {
      const versionResolution = await client.resolveVersionPointer(entry.adapterTopicId);
      const declEnvelopes = await client.fetchDeclarations(versionResolution.declarationTopicId, {
        order: "desc",
        limit: 20,
      });
      for (const envelope of declEnvelopes) {
        try {
          const decl = client.validateDeclaration(envelope.declaration);
          if (decl.op !== "register") continue;
          if (config.publisherPublicKey && decl.signature) {
            const verified = verifyDeclarationSignature(decl, config.publisherPublicKey);
            if (!verified) continue;
          }
          entries.push({
            adapter_id: decl.adapter_id,
            entity: decl.entity,
            hash: sha384(canonicalizeHcs21(decl)),
          });
          break;
        } catch {
        }
      }
    } catch (error) {
      logger.warn(`Failed to resolve adapter entry ${entry.adapterId}`, error);
    }
  }

  return entries;
};

const runEpoch = async (
  epoch: number,
  config: PetalConfig,
  adapters: PriceAdapter[],
  adapterFingerprints: Record<string, string>,
): Promise<ProofPayload | null> => {
  const logger = createPetalLogger(config.petalId);
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.discoverPrice()));
  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      logger.warn(
        `Adapter ${adapters[idx]?.constructor?.name ?? idx} failed for epoch ${epoch}`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  });
  const records = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  if (records.length === 0) {
    logger.warn(`No records for epoch ${epoch}`);
    return null;
  }

  if (records.length < adapters.length) {
    logger.warn(`Partial records (${records.length}/${adapters.length}) for epoch ${epoch}, skipping`);
    return null;
  }

  const proof = buildProof(records, epoch, config, adapterFingerprints);
  const hcs17Client = new HCS17Client({
    network: config.network,
    operatorId: config.accountId,
    operatorKey: config.privateKey,
    mirrorNodeUrl: config.mirrorBaseUrl,
  });

  await hcs17Client.submitMessage(config.stateTopicId.toString(), {
    p: "hcs-17",
    op: "state_hash",
    state_hash: proof.stateHash,
    topics: [
      config.stateTopicId.toString(),
      config.coordinationTopicId.toString(),
      config.transactionTopicId.toString(),
      config.registryTopicId,
    ],
    account_id: config.floraAccountId,
    m: `hcs17:${epoch}`,
  });

  return proof;
};

export type PetalHandle = { stop: () => void };

const resolveAdapters = async (
  config: PetalConfig,
  override?: PetalOverrides,
): Promise<{ adapters: PriceAdapter[]; fingerprints: Record<string, string> }> => {
  if (override?.adapters && override.adapterDeclarations) {
    const fingerprints = Object.fromEntries(
      override.adapterDeclarations.map((decl) => [decl.adapter_id, sha384(canonicalizeHcs21(decl))]),
    );
    return { adapters: override.adapters, fingerprints };
  }

  const entries =
    override?.adapterDeclarations?.map((decl) => ({
      adapter_id: decl.adapter_id,
      entity: decl.entity,
      hash: sha384(canonicalizeHcs21(decl)),
    })) ?? (await fetchRegistry(config));
  const { adapters, fingerprints } = loadAdaptersFromRegistry(entries, "HBAR-USD");
  if (adapters.length === 0) {
    throw new Error("No usable adapters found in registry for entity HBAR-USD");
  }
  return { adapters, fingerprints };
};

export const startPetal = async (override?: PetalOverrides): Promise<PetalHandle> => {
  const config = await resolveConfig(override);
  const { adapters, fingerprints } = await resolveAdapters(config, override);
  const logger = createPetalLogger(config.petalId);
  logger.info(`Loaded ${adapters.length} adapters for entity ${adapters[0]?.entity ?? "unknown"}`);
  let lastEpoch = -1;

  const executeEpoch = () => {
    const elapsedMs = Math.max(0, Date.now() - config.epochOriginMs);
    const epoch = Math.floor(elapsedMs / config.blockTimeMs);
    if (epoch <= lastEpoch) {
      return;
    }
    lastEpoch = epoch;
    void runEpoch(epoch, config, adapters, fingerprints)
      .then(async (proof) => {
        if (!proof) return;
        const consumerUrl = process.env.CONSUMER_URL ?? "http://flora-consumer:3000";
        try {
          await fetch(`${consumerUrl}/proof`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(proof),
          });
          logger.info(`Posted proof epoch=${proof.epoch} to consumer`);
        } catch (error) {
          logger.warn("Failed to post proof", error);
        }
      })
      .catch((error) => {
        logger.error(`Failed to publish epoch ${epoch}`, error);
      });
  };

  executeEpoch();
  const timer = setInterval(executeEpoch, config.blockTimeMs);

  return {
    stop: () => clearInterval(timer),
  };
};

if (process.argv[1] && process.argv[1].includes("petal")) {
  void startPetal();
}
