import "dotenv/config";
import fetch from "node-fetch";
import { TopicId } from "@hashgraph/sdk";
import { Logger } from "@hashgraphonline/standards-sdk";
import { startConsumer } from "../src/consumer.js";
import { startPetal } from "../src/petal.js";
import { selectRoundLeader } from "../src/consumer/leader.js";
import type { AdapterDeclaration } from "../src/adapters/declarations.js";
import { MockAdapter } from "../src/adapters/mock.js";

type AdaptersResponse = {
  petals?: {
    petalId: string;
    accountId?: string;
    publicKey?: string;
    keyType?: string;
    stateTopicId?: string;
  }[];
  members?: {
    petalId: string;
    accountId?: string;
    publicKey?: string;
    keyType?: string;
  }[];
  flora?: { accountId?: string; publicKey?: string; keyType?: string };
  topics: {
    state: string;
    coordination: string;
    transaction: string;
    registryCategory: string;
    registryDiscovery: string;
  };
  metadata: {
    registryPointer: string;
    network: string;
    floraAccountId?: string;
  };
};

const logger = Logger.getInstance({ module: "flora-smoke" });

type LatestPrice = { epoch: number; price: number; participants?: string[] };

const waitForAdapters = async (baseUrl: string): Promise<AdaptersResponse> => {
  const url = `${baseUrl}/adapters`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const body = (await response.json()) as AdaptersResponse;
      if (body?.topics?.state && body?.topics?.coordination && body?.topics?.transaction) {
        return body;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Timed out waiting for /adapters response");
};

const waitForLatestPrice = async (
  baseUrl: string,
): Promise<LatestPrice> => {
  const url = `${baseUrl}/price/latest`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const body = (await response.json()) as LatestPrice;
      if (typeof body.epoch === "number" && typeof body.price === "number") {
        return body;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Timed out waiting for /price/latest response");
};

const waitForPetalKeys = async (baseUrl: string): Promise<AdaptersResponse> => {
  const url = `${baseUrl}/adapters`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const body = (await response.json()) as AdaptersResponse;
      const petalSource = body.members?.length ? body.members : body.petals ?? [];
      const petalsWithAccounts =
        petalSource.filter((petal) => typeof petal.accountId === "string") ?? [];
      const petalsMissingKeys = petalsWithAccounts.filter(
        (petal) => typeof petal.publicKey !== "string" || petal.publicKey.trim().length === 0,
      );
      if (petalsWithAccounts.length > 0 && petalsMissingKeys.length === 0) {
        return body;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Timed out waiting for petal public keys from /adapters");
};

const normalizeMirrorBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -"/api/v1".length) : trimmed;
};

const isAccountId = (value: string): boolean => /^\d+\.\d+\.\d+$/.test(value.trim());

type MirrorTopicMessage = {
  message?: string;
  payer_account_id?: string;
  chunk_info?: { initial_transaction_id?: { account_id?: string } };
};

type StateTopicPayload = { epoch?: number; memo?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseStateTopicPayload = (entry: MirrorTopicMessage): StateTopicPayload | null => {
  if (!entry.message) return null;
  try {
    const decoded = Buffer.from(entry.message, "base64").toString("utf8");
    const payload = JSON.parse(decoded) as unknown;
    if (!isRecord(payload)) return null;
    if (payload.p !== "hcs-17" || payload.op !== "state_hash") return null;
    const epoch =
      typeof payload.epoch === "number" && Number.isFinite(payload.epoch)
        ? payload.epoch
        : undefined;
    const memo = typeof payload.m === "string" ? payload.m : undefined;
    return { epoch, memo };
  } catch {
    return null;
  }
};

const waitForStateTopicLeader = async (params: {
  mirrorBaseUrl: string;
  stateTopicId: string;
  leaderAccountId: string;
  epoch: number;
}): Promise<void> => {
  const base = normalizeMirrorBaseUrl(params.mirrorBaseUrl);
  const url = `${base}/api/v1/topics/${params.stateTopicId}/messages?order=desc&limit=200`;
  const expectedMemo = `hcs17:${params.epoch}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const body = (await response.json()) as {
        messages?: MirrorTopicMessage[];
      };
      const messages = body.messages ?? [];
      for (const msg of messages) {
        const payload = parseStateTopicPayload(msg);
        const epochMatch = payload?.epoch === params.epoch || payload?.memo === expectedMemo;
        if (!epochMatch) continue;
        const payer = msg.payer_account_id;
        const transactionAccount = msg.chunk_info?.initial_transaction_id?.account_id;
        const payerOk = payer === params.leaderAccountId;
        const transactionOk =
          transactionAccount === params.leaderAccountId || payerOk;
        if (payerOk && transactionOk) {
          return;
        }
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for state topic leader to publish");
};

const runExternalSmoke = async (): Promise<void> => {
  const baseUrl = (process.env.FLORA_SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  );
  await waitForLatestPrice(baseUrl);
  await waitForAdapters(baseUrl);
  const adaptersResponse = await waitForPetalKeys(baseUrl);
  const floraAccountId = adaptersResponse.metadata.floraAccountId;
  if (!floraAccountId) {
    throw new Error("Missing floraAccountId in /adapters response");
  }

  const petals = adaptersResponse.members?.length
    ? adaptersResponse.members
    : adaptersResponse.petals ?? [];
  const petalsWithAccounts = petals.filter((petal) => typeof petal.accountId === "string");
  if (petalsWithAccounts.length === 0) {
    throw new Error("No petal accounts reported by /adapters");
  }

  const uniquePetalAccounts = new Set(petalsWithAccounts.map((petal) => petal.accountId));
  if (uniquePetalAccounts.size !== petalsWithAccounts.length) {
    throw new Error("Expected each petal to report a unique accountId");
  }

  const petalsMissingKeys = petalsWithAccounts.filter(
    (petal) => typeof petal.publicKey !== "string" || petal.publicKey.trim().length === 0,
  );
  if (petalsMissingKeys.length > 0) {
    throw new Error("One or more petal public keys missing from /adapters");
  }

  if (!adaptersResponse.flora?.accountId) {
    throw new Error("Missing flora account details from /adapters");
  }
  if (!adaptersResponse.flora?.publicKey) {
    throw new Error("Missing flora public key from /adapters");
  }
  const expectedNetwork = (process.env.HEDERA_NETWORK ?? "testnet")
    .trim()
    .toLowerCase();
  if (adaptersResponse.metadata.network !== expectedNetwork) {
    throw new Error(
      `Expected network ${expectedNetwork} but got ${adaptersResponse.metadata.network}`,
    );
  }

  const latest = await waitForLatestPrice(baseUrl);
  const participants = latest.participants ?? [];
  if (participants.length === 0) {
    throw new Error("Expected latest consensus to include participants");
  }
  const invalidParticipants = participants.filter((participant) => !isAccountId(participant));
  if (invalidParticipants.length > 0) {
    throw new Error(`Expected account IDs in participants: ${invalidParticipants.join(", ")}`);
  }
  const expectedAccounts = petalsWithAccounts.map((petal) => petal.accountId as string);
  const missingParticipants = expectedAccounts.filter(
    (accountId) => !participants.includes(accountId),
  );
  if (missingParticipants.length > 0) {
    throw new Error(`Missing petal accounts in participants: ${missingParticipants.join(", ")}`);
  }

  const expectedLeader = selectRoundLeader(latest.epoch, expectedAccounts);
  if (!expectedLeader) {
    throw new Error("Failed to resolve round leader for latest consensus");
  }
  await waitForStateTopicLeader({
    mirrorBaseUrl: process.env.MIRROR_BASE_URL ?? "https://testnet.mirrornode.hedera.com",
    stateTopicId: adaptersResponse.topics.state,
    leaderAccountId: expectedLeader,
    epoch: latest.epoch,
  });

  const badFloraAccountId = floraAccountId === "0.0.0" ? "0.0.1" : "0.0.0";
  const now = new Date().toISOString();
  const badProofResponse = await fetch(`${baseUrl}/proof`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      epoch: latest.epoch + 1,
      stateHash: "bad-state-hash",
      thresholdFingerprint: "demo-threshold",
      petalId: "smoke",
      petalAccountId: "0.0.123",
      petalStateTopicId: adaptersResponse.topics.state,
      floraAccountId: badFloraAccountId,
      participants: expectedAccounts,
      records: [
        {
          adapterId: "mock",
          entityId: "HBAR-USD",
          payload: { price: 0.07 },
          timestamp: now,
          sourceFingerprint: "fp-mock",
        },
      ],
      timestamp: now,
      adapterFingerprints: { mock: "fp-mock" },
      registryTopicId: adaptersResponse.topics.registryCategory,
    }),
  });
  if (badProofResponse.status !== 400) {
    throw new Error("Expected /proof to reject mismatched floraAccountId");
  }

  logger.info(
    `External smoke ok: flora=${floraAccountId} petals=${petalsWithAccounts.length} latestEpoch=${latest.epoch}`,
  );
};

const runLocalSmoke = async (): Promise<void> => {
  process.env.FLORA_PARTICIPANTS = "petal-a,petal-b";

  const consumer = await startConsumer({
    port: 3100,
    quorum: 2,
    expectedPetals: 2,
    mirrorBaseUrl: process.env.MIRROR_BASE_URL,
  });

  const baseUrl = "http://localhost:3100";
  const adaptersResponse = await waitForAdapters(baseUrl);
  const floraAccountId = adaptersResponse.metadata.floraAccountId;
  if (!floraAccountId) {
    throw new Error("Missing floraAccountId in /adapters response");
  }
  const topics = adaptersResponse.topics;
  const petalAccounts =
    adaptersResponse.petals
      ?.map((petal) => petal.accountId)
      .filter((accountId): accountId is string => typeof accountId === "string") ?? [];

  const mockDeclarations: AdapterDeclaration[] = [
    {
      p: "hcs-21",
      op: "register",
      adapter_id: "mock-a",
      entity: "HBAR-USD",
      package: { registry: "demo", name: "mock-a", version: "1.0.0", integrity: "sha384-mock" },
      manifest: "hcs://1/0.0.0",
      config: {
        type: "flora",
        account: floraAccountId,
        threshold: "demo-threshold",
        ctopic: topics.coordination,
        ttopic: topics.transaction,
        stopic: topics.state,
      },
      state_model: "hcs17:sha384",
    },
    {
      p: "hcs-21",
      op: "register",
      adapter_id: "mock-b",
      entity: "HBAR-USD",
      package: { registry: "demo", name: "mock-b", version: "1.0.0", integrity: "sha384-mock" },
      manifest: "hcs://1/0.0.0",
      config: {
        type: "flora",
        account: floraAccountId,
        threshold: "demo-threshold",
        ctopic: topics.coordination,
        ttopic: topics.transaction,
        stopic: topics.state,
      },
      state_model: "hcs17:sha384",
    },
  ];
  const adapters = [new MockAdapter("mock-a", 0.0705), new MockAdapter("mock-b", 0.071)];

  const petalA = await startPetal({
    petalId: "petal-a",
    floraAccountId,
    floraStateTopicId: TopicId.fromString(topics.state),
    coordinationTopicId: TopicId.fromString(topics.coordination),
    transactionTopicId: TopicId.fromString(topics.transaction),
    registryTopicId: topics.registryCategory,
    adapterDeclarations: mockDeclarations,
    adapters,
  });
  const petalB = await startPetal({
    petalId: "petal-b",
    floraAccountId,
    floraStateTopicId: TopicId.fromString(topics.state),
    coordinationTopicId: TopicId.fromString(topics.coordination),
    transactionTopicId: TopicId.fromString(topics.transaction),
    registryTopicId: topics.registryCategory,
    adapterDeclarations: mockDeclarations,
    adapters,
  });

  let consensus = null;
  try {
    consensus = await consumer.waitForConsensus(40_000);
    if (!consensus) {
      throw new Error("No consensus reached in smoke test");
    }

    const badFloraAccountId = floraAccountId === "0.0.0" ? "0.0.1" : "0.0.0";
    const now = new Date().toISOString();
    const badProofResponse = await fetch(`${baseUrl}/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        epoch: consensus.epoch + 1,
        stateHash: "bad-state-hash",
        thresholdFingerprint: "demo-threshold",
        petalId: "petal-a",
        petalAccountId: "0.0.123",
        petalStateTopicId: topics.state,
        floraAccountId: badFloraAccountId,
        participants: petalAccounts,
        records: [
          {
            adapterId: "mock-a",
            entityId: "HBAR-USD",
            payload: { price: 0.07 },
            timestamp: now,
            sourceFingerprint: "fp-mock",
          },
        ],
        timestamp: now,
        adapterFingerprints: { "mock-a": "fp-mock" },
        registryTopicId: topics.registryCategory,
      }),
    });
    if (badProofResponse.status !== 400) {
      throw new Error("Expected /proof to reject mismatched floraAccountId");
    }
  } finally {
    petalA.stop();
    petalB.stop();
    consumer.stop();
  }

  logger.info(`Smoke test consensus price ${consensus.price}`);
};

const main = async (): Promise<void> => {
  const mode = process.env.FLORA_SMOKE_MODE?.trim().toLowerCase();
  if (!mode || mode === "external") {
    await runExternalSmoke();
    return;
  }
  if (mode === "local") {
    await runLocalSmoke();
    return;
  }
  throw new Error(`Unsupported FLORA_SMOKE_MODE: ${process.env.FLORA_SMOKE_MODE}`);
};

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
