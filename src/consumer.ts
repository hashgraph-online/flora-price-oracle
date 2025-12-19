import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { HCS21Client, HCS15Client, Logger } from '@hashgraphonline/standards-sdk';
import {
  initDb,
  saveConsensusEntry,
  loadConsensusHistory,
} from './lib/db.js';
import type { ConsumerConfig, ConsumerHandle } from './consumer/types.js';
import { resolveFloraNetwork } from './consumer/flora.js';
import { provisionPetalAccounts } from './consumer/petals.js';
import {
  ensureRegistryGraph,
  resolveManifestPointers,
  publishDeclarations,
} from './consumer/registry.js';
import { buildConsumer } from './consumer/server.js';
import { resolveNetwork } from './lib/network.js';
import { resolveOperatorKeyType, type HederaKeyType } from './lib/operator-key-type.js';

const logger = Logger.getInstance({ module: 'flora-consumer' });

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

export const startConsumer = async (
  overrides?: Partial<ConsumerConfig>
): Promise<ConsumerHandle> => {
  await initDb();
  const persistedHistory = await loadConsensusHistory();

  const parseNumber = (value: string | undefined, fallback: number): number => {
    const trimmed = value?.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const network = resolveNetwork(process.env.HEDERA_NETWORK);

  const base: ConsumerConfig = {
    quorum: parseNumber(process.env.QUORUM, 2),
    expectedPetals: parseNumber(process.env.EXPECTED_PETALS, 3),
    port: Number(process.env.PORT ?? '3000'),
    thresholdFingerprint: process.env.THRESHOLD_FINGERPRINT ?? 'demo-threshold',
    floraAccountId: '',
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

  const operatorKeyType: HederaKeyType = await resolveOperatorKeyType({
    mirrorBaseUrl: base.mirrorBaseUrl,
    accountId: operatorId,
  }).catch((error: unknown) => {
    logger.warn('Failed to detect operator key type; defaulting to ECDSA', error);
    return 'ecdsa' as const;
  });

  const hcs21 = new HCS21Client({
    network,
    operatorId,
    operatorKey,
    keyType: operatorKeyType,
  });
  const hcs15 = new HCS15Client({
    network,
    operatorId,
    operatorKey,
    keyType: operatorKeyType,
    mirrorNodeUrl: process.env.MIRROR_BASE_URL ?? 'https://testnet.mirrornode.hedera.com',
  });

  const petalMinHbarBalance = parseNumber(process.env.PETAL_MIN_HBAR_BALANCE, 1);
  const petalTargetHbarBalance = parseNumber(process.env.PETAL_TARGET_HBAR_BALANCE, 2);

  const petalAccounts = await provisionPetalAccounts(petalIds, hcs15, network, {
    operatorId,
    operatorKey,
    operatorKeyType,
    minHbarBalance: petalMinHbarBalance,
    targetHbarBalance: petalTargetHbarBalance,
  });
  const memberAccounts = Object.values(petalAccounts).map((entry) => entry.accountId);
  const memberPrivateKeys = Object.values(petalAccounts).map((entry) => entry.privateKey);
  const floraThreshold = parseNumber(process.env.FLORA_THRESHOLD, petalIds.length);

  const floraNetwork =
    overrides?.floraAccountId &&
    overrides.stateTopicId &&
    overrides.coordinationTopicId &&
    overrides.transactionTopicId
      ? {
          floraAccountId: overrides.floraAccountId,
          stateTopicId: overrides.stateTopicId,
          coordinationTopicId: overrides.coordinationTopicId,
          transactionTopicId: overrides.transactionTopicId,
        }
      : await resolveFloraNetwork({
          operatorId,
          operatorKey,
          operatorKeyType,
          network,
          members: memberAccounts,
          memberPrivateKeys,
          threshold: floraThreshold,
        });

  const manifestPointers = await resolveManifestPointers(hcs21);
  const registryGraph = await ensureRegistryGraph(hcs21, operatorId, manifestPointers);
  await publishDeclarations(hcs21, registryGraph, manifestPointers, {
    floraAccount: floraNetwork.floraAccountId,
    threshold: config.thresholdFingerprint,
    stateTopic: floraNetwork.stateTopicId,
    coordinationTopic: floraNetwork.coordinationTopicId,
    transactionTopic: floraNetwork.transactionTopicId,
  });

  const merged: ConsumerConfig = {
    ...config,
    floraAccountId: floraNetwork.floraAccountId,
    adapterCategoryTopicId: registryGraph.categoryTopicId,
    adapterDiscoveryTopicId: registryGraph.discoveryTopicId,
    adapterTopics: registryGraph.adapterTopics,
    adapterRegistryMetadataPointer: registryGraph.metadataPointer,
    stateTopicId: floraNetwork.stateTopicId,
    coordinationTopicId: floraNetwork.coordinationTopicId,
    transactionTopicId: floraNetwork.transactionTopicId,
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
    logger.info(`Flora consumer listening on ${merged.port}`);
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
