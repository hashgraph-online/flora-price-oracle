import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { HCS21Client, HCS15Client } from '@hashgraphonline/standards-sdk';
import {
  initDb,
  saveConsensusEntry,
  loadConsensusHistory,
} from './lib/db.js';
import type { ConsumerConfig, ConsumerHandle } from './consumer/types.js';
import { resolveFloraTopics } from './consumer/topics.js';
import { provisionPetalAccounts } from './consumer/petals.js';
import {
  ensureRegistryGraph,
  resolveManifestPointers,
  publishDeclarations,
} from './consumer/registry.js';
import { buildConsumer } from './consumer/server.js';

const fetchLatestMirrorTimestamp = async (
  stateTopicId: string,
  mirrorBaseUrl: string
): Promise<string> => {
  const url = `${mirrorBaseUrl}/api/v1/topics/${stateTopicId}/messages?order=desc&limit=1`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return '0';
    }
    const body = (await response.json()) as {
      messages?: { consensus_timestamp?: string }[];
    };
    const ts = body.messages?.[0]?.consensus_timestamp;
    return ts ?? '0';
  } catch {
    return '0';
  }
};

// manifest utilities moved to ./consumer/registry.ts

export const startConsumer = async (
  overrides?: Partial<ConsumerConfig>
): Promise<ConsumerHandle> => {
  await initDb();
  const persistedHistory = await loadConsensusHistory();

  const parseNumber = (value: string | undefined, fallback: number): number =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;

  const network = process.env.HEDERA_NETWORK ?? 'testnet';

  const base: ConsumerConfig = {
    quorum: parseNumber(process.env.QUORUM, 2),
    expectedPetals: parseNumber(process.env.EXPECTED_PETALS, 3),
    port: Number(process.env.PORT ?? '3000'),
    thresholdFingerprint: process.env.THRESHOLD_FINGERPRINT ?? 'demo-threshold',
    stateTopicId: '',
    coordinationTopicId: '',
    transactionTopicId: '',
    network,
    mirrorBaseUrl:
      process.env.MIRROR_BASE_URL ?? 'https://testnet.mirrornode.hedera.com',
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? '10000'),
    adapterCategoryTopicId: '',
    adapterDiscoveryTopicId: '',
    adapterTopics: {},
    adapterRegistryMetadataPointer: '',
  };

  const config: ConsumerConfig = { ...base, ...overrides };

  const petalIds = (process.env.FLORA_PARTICIPANTS ?? 'petal-1,petal-2,petal-3')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const operatorId =
    process.env.HEDERA_ACCOUNT_ID || process.env.TESTNET_HEDERA_ACCOUNT_ID;
  const operatorKey =
    process.env.HEDERA_PRIVATE_KEY || process.env.TESTNET_HEDERA_PRIVATE_KEY;
  if (!operatorId || !operatorKey) {
    throw new Error(
      'HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY are required to create registry'
    );
  }

  const hcs21 = new HCS21Client({ network, operatorId, operatorKey });
  const hcs15 = new HCS15Client({
    network,
    operatorId,
    operatorKey,
    mirrorNodeUrl: process.env.MIRROR_BASE_URL ?? 'https://testnet.mirrornode.hedera.com',
  });

  // Provision petal accounts (HCS-15) + HCS-11 profiles and persist credentials
  const petalAccounts = await provisionPetalAccounts(petalIds, hcs15, network);

  // Resolve or create flora topics (state/coordination/transaction) via standards-sdk
  const { stateTopicId, coordinationTopicId, transactionTopicId } = await resolveFloraTopics(
    operatorId,
    operatorKey,
    network
  );

  const manifestPointers = await resolveManifestPointers(hcs21);
  const registryGraph = await ensureRegistryGraph(hcs21, operatorId, manifestPointers);
  await publishDeclarations(hcs21, registryGraph, manifestPointers, {
    floraAccount: operatorId,
    threshold: config.thresholdFingerprint,
    stateTopic: stateTopicId,
    coordinationTopic: coordinationTopicId,
    transactionTopic: transactionTopicId,
  });

  const merged: ConsumerConfig = {
    ...config,
    adapterCategoryTopicId: registryGraph.categoryTopicId,
    adapterDiscoveryTopicId: registryGraph.discoveryTopicId,
    adapterTopics: registryGraph.adapterTopics,
    adapterRegistryMetadataPointer: registryGraph.metadataPointer,
    stateTopicId,
    coordinationTopicId,
    transactionTopicId,
  };
  const initialLastTimestamp =
    persistedHistory[persistedHistory.length - 1]?.timestamp ||
    (await fetchLatestMirrorTimestamp(
      merged.stateTopicId,
      merged.mirrorBaseUrl
    )) ||
    '0';

  const { app, getLatest, waitForConsensus, stopPolling } = buildConsumer(
    merged,
    {
      initialHistory: persistedHistory,
      persistConsensus: saveConsensusEntry,
      initialLastTimestamp,
    }
  );
  const server = app.listen(merged.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Flora consumer listening on ${merged.port}`);
  });

  return {
    stop: () => {
      server.close();
      stopPolling();
    },
    getLatest,
    waitForConsensus,
  };
};

if (process.argv[1] && process.argv[1].includes('consumer')) {
  void startConsumer();
}
