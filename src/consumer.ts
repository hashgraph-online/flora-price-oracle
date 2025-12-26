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
import { publishConsensusToStateTopic } from "./consumer/state-topic-publisher.js";
import { selectRoundLeader, sortAccountIds } from "./consumer/leader.js";
import { validateProofsOnStateTopics } from "./consumer/state-topic-validation.js";
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
  const petalAccountsById = Object.fromEntries(
    Object.entries(petalAccounts).map(([petalId, entry]) => [petalId, entry.accountId]),
  );
  const memberAccounts = Object.values(petalAccounts).map((entry) => entry.accountId);
  const memberPrivateKeys = Object.values(petalAccounts).map((entry) => entry.privateKey);
  const petalPrivateKeysByAccountId = Object.fromEntries(
    Object.values(petalAccounts).map((entry) => [entry.accountId, entry.privateKey]),
  );
  const orderedMemberAccounts = sortAccountIds(memberAccounts);
  const petalKeyTypesByAccountId: Record<string, HederaKeyType> = {};
  await Promise.all(
    orderedMemberAccounts.map(async (accountId) => {
      const keyType: HederaKeyType = await resolveOperatorKeyType({
        mirrorBaseUrl: config.mirrorBaseUrl,
        accountId,
      }).catch((error: unknown) => {
        logger.warn("Failed to detect petal key type; defaulting to ECDSA", {
          accountId,
          error,
        });
        return "ecdsa" as const;
      });
      petalKeyTypesByAccountId[accountId] = keyType;
    }),
  );
  const isAccountId = (value: string): boolean => /^\d+\.\d+\.\d+$/.test(value.trim());
  const normalizeParticipants = (participants: string[]): string[] => {
    if (orderedMemberAccounts.length === 0) return participants;
    const invalid = participants.some((participant) => !isAccountId(participant));
    return invalid ? orderedMemberAccounts : participants;
  };
  const normalizedHistory = persistedHistory.map((entry) => ({
    ...entry,
    participants: normalizeParticipants(entry.participants),
  }));
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
          mirrorBaseUrl: config.mirrorBaseUrl,
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
    petalAccountsById,
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
    normalizedHistory[normalizedHistory.length - 1]?.consensusTimestamp ||
    (await fetchLatestMirrorTimestamp(
      merged.stateTopicId,
      merged.mirrorBaseUrl
    )) ||
    '0';

  const { app, getLatest, waitForConsensus, stopPolling } = buildConsumer(
    merged,
    {
      initialHistory: normalizedHistory,
      persistConsensus: saveConsensusEntry,
      initialLastTimestamp,
      publishConsensus: async (entry, proofs) => {
        const leaderAccountId = selectRoundLeader(entry.epoch, orderedMemberAccounts);
        if (!leaderAccountId) {
          logger.warn("No leader resolved for consensus publish", { epoch: entry.epoch });
          return null;
        }
        const leaderPrivateKey = petalPrivateKeysByAccountId[leaderAccountId];
        if (!leaderPrivateKey) {
          logger.warn("Leader private key unavailable for consensus publish", {
            epoch: entry.epoch,
            leaderAccountId,
          });
          return null;
        }
        const leaderKeyType = petalKeyTypesByAccountId[leaderAccountId];
        const validation = await validateProofsOnStateTopics({
          mirrorBaseUrl: merged.mirrorBaseUrl,
          proofs,
        });
        if (validation.invalid.length > 0) {
          logger.warn("Consensus publish blocked by missing petal state topics", {
            epoch: entry.epoch,
            leaderAccountId,
            invalidPetals: validation.invalid.map((proof) => proof.petalId),
          });
          return null;
        }
        return await publishConsensusToStateTopic({
          network,
          publisherAccountId: leaderAccountId,
          publisherPrivateKey: leaderPrivateKey,
          publisherKeyType: leaderKeyType,
          floraAccountId: floraNetwork.floraAccountId,
          stateTopicId: floraNetwork.stateTopicId,
          topics: [
            floraNetwork.coordinationTopicId,
            floraNetwork.transactionTopicId,
            registryGraph.categoryTopicId,
            registryGraph.discoveryTopicId,
          ],
          entry,
          thresholdFingerprint: config.thresholdFingerprint,
        });
      },
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
