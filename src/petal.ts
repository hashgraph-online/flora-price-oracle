import dotenv from "dotenv";
import { TopicId } from "@hashgraph/sdk";
import { HCS21Client, HCS17Client, canonicalize as canonicalizeHcs21, verifyDeclarationSignature } from "@hashgraphonline/standards-sdk";
import fetch from "node-fetch";
import { loadAdaptersFromRegistry, type Hcs21RegistryEntry } from "./adapters/registry.js";
import type { AdapterDeclaration } from "./adapters/declarations.js";
import type { AdapterRecord, PriceAdapter } from "./adapters/types.js";
import { canonicalize } from "./lib/canonicalize.js";
import { sha384 } from "./lib/hash.js";
import { getState, getSecureState, initDb, setState } from "./lib/db.js";

dotenv.config();

type PetalConfig = {
  petalId: string;
  accountId: string;
  privateKey: string;
  participants: string[];
  floraThresholdFingerprint: string;
  blockTimeMs: number;
  epochOriginMs: number;
  stateTopicId: TopicId;
  coordinationTopicId: TopicId;
  transactionTopicId: TopicId;
  registryTopicId: string;
  mirrorBaseUrl: string;
  network: string;
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
  const petalId = process.env.PETAL_ID ?? "petal-unknown";
  const participants = (process.env.FLORA_PARTICIPANTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const epochOriginStored = await getState("epoch_origin_ms");
  const epochOriginMs = override?.epochOriginMs ?? (epochOriginStored ? Number(epochOriginStored) : Date.now());

  const base: PetalConfig = {
    petalId,
    accountId: "",
    privateKey: "",
    participants,
    floraThresholdFingerprint: process.env.FLORA_THRESHOLD_FINGERPRINT ?? "demo-threshold",
    blockTimeMs: Number(process.env.BLOCK_TIME_MS ?? "2000"),
    epochOriginMs,
    stateTopicId: TopicId.fromString("0.0.0"), // will be overwritten after DB/env resolution
    coordinationTopicId: TopicId.fromString("0.0.0"),
    transactionTopicId: TopicId.fromString("0.0.0"),
    registryTopicId: "",
    mirrorBaseUrl: process.env.MIRROR_BASE_URL ?? "https://testnet.mirrornode.hedera.com",
    network: process.env.HEDERA_NETWORK ?? "testnet",
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
    const envAccount = process.env.PETAL_ACCOUNT_ID ?? process.env.HEDERA_ACCOUNT_ID;
    const envKey = process.env.PETAL_PRIVATE_KEY ?? process.env.HEDERA_PRIVATE_KEY;
    if (envAccount && envKey) {
      return { accountId: envAccount, privateKey: envKey };
    }

    const accountKey = `petal_account_${petalId}`;
    const privateKeyKey = `petal_private_key_${petalId}`;
    for (let i = 0; i < 30; i += 1) {
      const storedAccount = await getState(accountKey);
      const storedPrivateKey = await getSecureState(privateKeyKey);
      if (storedAccount && storedPrivateKey) {
        // eslint-disable-next-line no-console
        console.log(`[petal ${petalId}] loaded petal account from db: ${storedAccount}`);
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

  const waitForTopic = async (key: string, envValue?: string): Promise<string> => {
    const trimmed = envValue?.trim();
    if (trimmed) {
      // eslint-disable-next-line no-console
      console.log(`[petal ${petalId}] using ${key} from env: ${trimmed}`);
      return trimmed;
    }
    for (let i = 0; i < 30; i += 1) {
      const value = await getState(key);
      if (value && value.trim().length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[petal ${petalId}] loaded ${key} from db: ${value}`);
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${key} is required for Hedera publication`);
  };

  const stateTopicRaw = await waitForTopic("state_topic_id", process.env.STATE_TOPIC_ID);
  const coordinationTopicRaw = await waitForTopic("coordination_topic_id", process.env.CTOPIC_ID);
  const transactionTopicRaw = await waitForTopic("transaction_topic_id", process.env.TTOPIC_ID);

  if (!stateTopicRaw) {
    throw new Error("Missing state_topic_id");
  }
  const stateTopicId = TopicId.fromString(stateTopicRaw);
  const coordinationTopicId = TopicId.fromString(coordinationTopicRaw);
  const transactionTopicId = TopicId.fromString(transactionTopicRaw);
  return { ...merged, registryTopicId, stateTopicId, coordinationTopicId, transactionTopicId, accountId, privateKey };
};

type ProofPayload = {
  epoch: number;
  stateHash: string;
  thresholdFingerprint: string;
  petalId: string;
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
    participants: config.participants,
    records: normalizedRecords,
    timestamp: epochTimestamp,
    adapterFingerprints,
    registryTopicId: config.registryTopicId,
  };
};

const fetchRegistry = async (config: PetalConfig): Promise<Hcs21RegistryEntry[]> => {
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
          // skip invalid declarations
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[petal ${config.petalId}] failed to resolve adapter entry ${entry.adapterId}:`, error);
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
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.discoverPrice()));
  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      // eslint-disable-next-line no-console
      console.warn(
        `[petal ${config.petalId}] adapter ${adapters[idx]?.constructor?.name ?? idx} failed for epoch ${epoch}:`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  });
  const records = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  if (records.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[petal ${config.petalId}] no records for epoch ${epoch}`);
    return null;
  }

  if (records.length < adapters.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[petal ${config.petalId}] partial records (${records.length}/${adapters.length}) for epoch ${epoch}, skipping`,
    );
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
    topics: [config.stateTopicId.toString(), config.coordinationTopicId.toString(), config.transactionTopicId.toString(), config.registryTopicId],
    account_id: config.accountId,
    epoch,
    timestamp: proof.timestamp,
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
  // eslint-disable-next-line no-console
  console.log(`[petal ${config.petalId}] loaded ${adapters.length} adapters for entity ${adapters[0]?.entity ?? "unknown"}`);
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
          // eslint-disable-next-line no-console
          console.log(`[petal ${config.petalId}] posted proof epoch=${proof.epoch} to consumer`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`[petal ${config.petalId}] failed to post proof`, error);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`Petal ${config.petalId} failed to publish epoch ${epoch}`, error);
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
