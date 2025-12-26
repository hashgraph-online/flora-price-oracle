import express, { type NextFunction, type Request, type Response } from 'express';
import { Logger } from '@hashgraphonline/standards-sdk';
import { aggregateConsensus } from './consensus.js';
import type {
  ProofPayload,
  ConsensusEntry,
  ConsumerConfig,
  PetalAdapterState,
  ConsumerHandle,
} from './types.js';
import type { PublishedConsensusMeta } from "./state-topic-publisher.js";
import { createAccountKeyFetcher } from "./account-keys.js";
import { sortAccountIds } from "./leader.js";
import { createStateTopicPoller } from "./state-topic-poller.js";
import {
  type ChunkedProofPayload,
  getEpochFromPayload,
  isChunkedProofPayload,
  isProofPayload,
} from './validation.js';

export const buildConsumer = (
  config: ConsumerConfig,
  options: {
    initialHistory?: ConsensusEntry[];
    persistConsensus?: (entry: ConsensusEntry) => Promise<void>;
    initialLastTimestamp?: string;
    publishConsensus?: (
      entry: ConsensusEntry,
      proofs: ProofPayload[],
    ) => Promise<PublishedConsensusMeta | null>;
  } = {}
): {
  app: express.Express;
  getLatest: () => ConsensusEntry | null;
  waitForConsensus: (timeoutMs: number) => Promise<ConsensusEntry | null>;
  stopPolling: () => void;
} => {
  const proofsByEpoch = new Map<number, ProofPayload[]>();
  const history: ConsensusEntry[] = [...(options.initialHistory ?? [])];
  const petalAdapters = new Map<string, PetalAdapterState>();
  const metaByEpoch = new Map<
    number,
    { consensusTimestamp?: string; sequenceNumber?: number }
  >();
  const metaQueue: number[] = [];
  const publishConsensus = options.publishConsensus;
  const publishedConsensus = new Map<number, string>();
  const publishingConsensus = new Map<number, string>();
  const publishRetryTimers = new Map<number, NodeJS.Timeout>();
  const publishRetryAttempts = new Map<number, number>();
  const chunkBuffer: Map<
    string,
    {
      total: number;
      parts: (string | undefined)[];
    }
  > = new Map();
  const {
    quorum,
    expectedPetals,
    thresholdFingerprint,
    petalAccountsById,
    floraAccountId,
    stateTopicId,
    coordinationTopicId,
    transactionTopicId,
    network,
    mirrorBaseUrl,
    pollIntervalMs,
    adapterCategoryTopicId,
    adapterDiscoveryTopicId,
    adapterTopics,
    adapterRegistryMetadataPointer,
  } = config;
  if (!floraAccountId) {
    throw new Error('FLORA_ACCOUNT_ID is required for consumer');
  }
  if (!stateTopicId) {
    throw new Error('STATE_TOPIC_ID is required for consumer');
  }
  if (!coordinationTopicId || !transactionTopicId) {
    throw new Error('Coordination and transaction topics are required for consumer');
  }
  const participantAccounts = petalAccountsById
    ? sortAccountIds(Object.values(petalAccountsById))
    : [];
  const petalStateTopicsById = new Map<string, string>();
  const serverApp = express();
  const persistConsensus = options.persistConsensus;
  const logger = Logger.getInstance({ module: 'flora-consumer' });
  const fetchAccountKey = createAccountKeyFetcher({ mirrorBaseUrl });
  serverApp.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });
  serverApp.use(express.json({ limit: '1mb' }));

  const hasExpectedParticipants = (participants: string[]): boolean => {
    const expectedCount =
      participantAccounts.length > 0 ? participantAccounts.length : expectedPetals;
    if (expectedCount > 0 && participants.length !== expectedCount) return false;
    if (participantAccounts.length === 0) return true;
    const normalized = sortAccountIds(participants);
    if (normalized.length !== participantAccounts.length) return false;
    return normalized.every((accountId, index) => accountId === participantAccounts[index]);
  };

  const getLatestPublishedConsensus = (): ConsensusEntry | null => {
    for (let idx = history.length - 1; idx >= 0; idx -= 1) {
      const entry = history[idx];
      if (!entry) continue;
      if (typeof entry.consensusTimestamp === "string" && entry.consensusTimestamp.length > 0) {
        return entry;
      }
    }
    return null;
  };

  const scheduleConsensusPublish = (entry: ConsensusEntry, proofs: ProofPayload[]) => {
    if (!publishConsensus) return;
    const existing = publishedConsensus.get(entry.epoch);
    if (existing === entry.stateHash) return;
    const inFlight = publishingConsensus.get(entry.epoch);
    if (inFlight === entry.stateHash) return;
    publishingConsensus.set(entry.epoch, entry.stateHash);
    const existingTimer = publishRetryTimers.get(entry.epoch);
    if (existingTimer) {
      clearTimeout(existingTimer);
      publishRetryTimers.delete(entry.epoch);
    }

    void publishConsensus(entry, proofs)
      .then((meta) => {
        if (!meta) {
          const attempts = (publishRetryAttempts.get(entry.epoch) ?? 0) + 1;
          publishRetryAttempts.set(entry.epoch, attempts);
          const delayMs = Math.min(120_000, 5_000 * attempts);
          if (!publishRetryTimers.has(entry.epoch)) {
            const timer = setTimeout(() => {
              publishRetryTimers.delete(entry.epoch);
              const latestEntry = history.find((item) => item.epoch === entry.epoch);
              if (!latestEntry) return;
              const latestProofs = proofsByEpoch.get(entry.epoch) ?? proofs;
              scheduleConsensusPublish(latestEntry, latestProofs);
            }, delayMs);
            publishRetryTimers.set(entry.epoch, timer);
          }
          return;
        }
        publishRetryAttempts.delete(entry.epoch);
        publishedConsensus.set(entry.epoch, entry.stateHash);
        const idx = history.findIndex((item) => item.epoch === entry.epoch);
        if (idx < 0) return;
        const updated: ConsensusEntry = {
          ...history[idx],
          consensusTimestamp: history[idx].consensusTimestamp ?? meta.consensusTimestamp,
          sequenceNumber: history[idx].sequenceNumber ?? meta.sequenceNumber,
          hcsMessage: history[idx].hcsMessage ?? meta.hcsMessage,
        };
        history[idx] = updated;
        if (persistConsensus) {
          void persistConsensus(updated).catch(() => {});
        }
      })
      .catch((error: unknown) => {
        logger.warn("Consensus state publish failed", { epoch: entry.epoch, error });
        const attempts = (publishRetryAttempts.get(entry.epoch) ?? 0) + 1;
        publishRetryAttempts.set(entry.epoch, attempts);
        const delayMs = Math.min(120_000, 5_000 * attempts);
        if (!publishRetryTimers.has(entry.epoch)) {
          const timer = setTimeout(() => {
            publishRetryTimers.delete(entry.epoch);
            const latestEntry = history.find((item) => item.epoch === entry.epoch);
            if (!latestEntry) return;
            const latestProofs = proofsByEpoch.get(entry.epoch) ?? proofs;
            scheduleConsensusPublish(latestEntry, latestProofs);
          }, delayMs);
          publishRetryTimers.set(entry.epoch, timer);
        }
      })
      .finally(() => {
        publishingConsensus.delete(entry.epoch);
      });
  };

  serverApp.post(['/proof', '/api/proof'], (req: Request, res: Response) => {
    const payload: unknown = req.body;

    if (isChunkedProofPayload(payload)) {
      const expectedAccountId = petalAccountsById?.[payload.petalId];
      if (expectedAccountId && payload.petalAccountId !== expectedAccountId) {
        logger.warn('[proof] rejected: petal account mismatch', {
          petalId: payload.petalId,
          expectedAccountId,
          petalAccountId: payload.petalAccountId,
        });
        return res.status(400).json({ error: 'Invalid petal account' });
      }
      if (payload.floraAccountId !== floraAccountId) {
        logger.warn('[proof] rejected: flora account mismatch');
        return res.status(400).json({ error: 'Invalid flora account' });
      }
      ingestProof(payload);
      return res.json({ status: 'accepted' });
    }

    if (!isProofPayload(payload)) {
      logger.warn('[proof] rejected: invalid payload');
      return res.status(400).json({ error: 'Invalid proof payload' });
    }

    const expectedAccountId = petalAccountsById?.[payload.petalId];
    if (expectedAccountId && payload.petalAccountId !== expectedAccountId) {
      logger.warn('[proof] rejected: petal account mismatch', {
        petalId: payload.petalId,
        expectedAccountId,
        petalAccountId: payload.petalAccountId,
      });
      return res.status(400).json({ error: 'Invalid petal account' });
    }
    if (!hasExpectedParticipants(payload.participants)) {
      logger.warn('[proof] rejected: participants mismatch');
      return res.status(400).json({ error: 'Unexpected participants' });
    }
    const existingStateTopic = petalStateTopicsById.get(payload.petalId);
    if (existingStateTopic && payload.petalStateTopicId !== existingStateTopic) {
      logger.warn('[proof] rejected: petal state topic mismatch', {
        petalId: payload.petalId,
        expectedStateTopicId: existingStateTopic,
        petalStateTopicId: payload.petalStateTopicId,
      });
      return res.status(400).json({ error: 'Invalid petal state topic' });
    }
    if (!existingStateTopic) {
      petalStateTopicsById.set(payload.petalId, payload.petalStateTopicId);
    }

    logger.info(
      `[proof] received epoch=${payload.epoch} petal=${payload.petalId} participants=${payload.participants.length}`
    );

    if (payload.floraAccountId !== floraAccountId) {
      logger.warn('[proof] rejected: flora account mismatch');
      return res.status(400).json({ error: 'Invalid flora account' });
    }
    if (payload.thresholdFingerprint !== thresholdFingerprint) {
      logger.warn('[proof] rejected: threshold mismatch');
      return res.status(400).json({ error: 'Invalid threshold fingerprint' });
    }
    if (payload.registryTopicId !== adapterCategoryTopicId) {
      logger.warn('[proof] rejected: registry topic mismatch');
      return res.status(400).json({ error: 'Unexpected registry topic' });
    }
    ingestProof(payload);
    return res.json({ status: 'accepted' });
  });

  serverApp.get(['/price/latest', '/api/price/latest'], (_req: Request, res: Response) => {
    const latest = publishConsensus ? getLatestPublishedConsensus() : history[history.length - 1];
    if (!latest) {
      return res.status(404).json({ error: 'No consensus yet' });
    }
    return res.json({
      ...latest,
      hcsMessage: latest.hcsMessage ?? `hcs://17/${stateTopicId}`,
    });
  });

  serverApp.get(['/price/history', '/api/price/history'], (_req: Request, res: Response) => {
    const ordered = [...history].reverse();
    const limit = Math.max(
      1,
      Math.min(200, Number((_req.query.limit as string) ?? '50'))
    );
    const offset = Math.max(0, Number((_req.query.offset as string) ?? '0'));
    const items = ordered.slice(offset, offset + limit).map((entry) => ({
      ...entry,
      hcsMessage: entry.hcsMessage ?? `hcs://17/${stateTopicId}`,
    }));
    return res.json({
      total: history.length,
      offset,
      limit,
      items,
    });
  });

  serverApp.get(['/health', '/api/health'], (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  serverApp.get(['/adapters', '/api/adapters'], async (_req: Request, res: Response) => {
    const petals = Array.from(petalAdapters.values()).sort((a, b) =>
      a.petalId.localeCompare(b.petalId)
    );
    const petalsWithKeys = await Promise.all(
      petals.map(async (entry) => {
        if (!entry.accountId) return entry;
        const key = await fetchAccountKey(entry.accountId);
        if (!key) return entry;
        return {
          ...entry,
          publicKey: key.publicKey,
          keyType: key.keyType,
        };
      })
    );
    const memberEntries = petalAccountsById
      ? Object.entries(petalAccountsById)
      : [];
    const members = await Promise.all(
      memberEntries.map(async ([petalId, accountId]) => {
        const key = await fetchAccountKey(accountId);
        return {
          petalId,
          accountId,
          publicKey: key?.publicKey,
          keyType: key?.keyType,
        };
      })
    );
    const resolvedMembers =
      members.length > 0
        ? members
        : petalsWithKeys.map((entry) => ({
            petalId: entry.petalId,
            accountId: entry.accountId,
            publicKey: entry.publicKey,
            keyType: entry.keyType,
          }));
    const floraKey = await fetchAccountKey(floraAccountId);
    const aggregateFingerprints: Record<string, string> = {};
    const aggregateAdapters = new Set<string>();
    petalsWithKeys.forEach((entry) => {
      entry.adapters.forEach((adapterId) => aggregateAdapters.add(adapterId));
      Object.entries(entry.fingerprints).forEach(([id, fp]) => {
        aggregateFingerprints[id] = fp;
      });
    });
    res.json({
      petals: petalsWithKeys,
      members: resolvedMembers,
      flora: {
        accountId: floraAccountId,
        publicKey: floraKey?.publicKey,
        keyType: floraKey?.keyType,
      },
      aggregate: {
        adapters: Array.from(aggregateAdapters).sort(),
        fingerprints: aggregateFingerprints,
        registry: {
          categoryTopicId: adapterCategoryTopicId,
          discoveryTopicId: adapterDiscoveryTopicId,
          adapterTopics,
        },
      },
      topics: {
        state: stateTopicId,
        coordination: coordinationTopicId,
        transaction: transactionTopicId,
        registryCategory: adapterCategoryTopicId,
        registryDiscovery: adapterDiscoveryTopicId,
      },
      metadata: {
        registryPointer: adapterRegistryMetadataPointer,
        network,
        floraAccountId,
      },
    });
  });

  const ingestProof = (proof: ProofPayload | ChunkedProofPayload) => {
    if (isChunkedProofPayload(proof)) {
      const key = `${proof.petalId}-${proof.epoch}`;
      const existing = chunkBuffer.get(key) ?? {
        total: proof.total_chunks,
        parts: new Array(proof.total_chunks),
      };
      existing.parts[proof.chunk_id - 1] = proof.data;
      chunkBuffer.set(key, existing);
      if (existing.parts.every((part) => part !== undefined)) {
        const assembled = existing.parts.join('');
        try {
          const parsed = JSON.parse(assembled) as unknown;
          if (!isProofPayload(parsed)) {
            logger.warn('[proof] rejected: invalid chunk assembly');
            chunkBuffer.delete(key);
            return;
          }
          chunkBuffer.delete(key);
          ingestProof(parsed);
          return;
        } catch {
          logger.warn('[proof] rejected: chunk assembly failed');
        }
      }
      return;
    }

    const meta = metaByEpoch.get(proof.epoch);
    const hcsPointer = `hcs://17/${stateTopicId}`;
    const enriched: ProofPayload = {
      ...proof,
      hcsMessage: proof.hcsMessage ?? hcsPointer,
      consensusTimestamp: meta?.consensusTimestamp ?? proof.consensusTimestamp,
      sequenceNumber: meta?.sequenceNumber ?? proof.sequenceNumber,
    };

    const adapterIds = Object.keys(enriched.adapterFingerprints ?? {}).sort();
    petalAdapters.set(enriched.petalId, {
      petalId: enriched.petalId,
      accountId: enriched.petalAccountId,
      stateTopicId: enriched.petalStateTopicId,
      epoch: enriched.epoch,
      timestamp: enriched.timestamp,
      adapters: adapterIds,
      fingerprints: enriched.adapterFingerprints ?? {},
    });
    const bucket = proofsByEpoch.get(enriched.epoch) ?? [];
    bucket.push(enriched);
    proofsByEpoch.set(enriched.epoch, bucket);
    if (!metaByEpoch.has(enriched.epoch)) {
      if (!metaQueue.includes(enriched.epoch)) {
        metaQueue.push(enriched.epoch);
      }
    }

    const consensus = aggregateConsensus(
      enriched.epoch,
      bucket,
      quorum,
      thresholdFingerprint,
      participantAccounts,
    );
    if (consensus) {
      const { entry, proofs } = consensus;
      const exists = history.some(
        (item) => item.epoch === entry.epoch && item.stateHash === entry.stateHash,
      );
      if (!exists) {
        history.push(entry);
        history.sort((a, b) => a.epoch - b.epoch);
        if (options.persistConsensus) {
          void options.persistConsensus(entry).catch(() => {});
        }
        scheduleConsensusPublish(entry, proofs);
      }
    }
  };

  const applyMeta = (
    epoch: number,
    meta: { consensusTimestamp?: string; sequenceNumber?: number }
  ) => {
    const existing = metaByEpoch.get(epoch) ?? {};
    metaByEpoch.set(epoch, { ...existing, ...meta });

    const bucket = proofsByEpoch.get(epoch);
    if (bucket) {
      bucket.forEach((entry) => {
        entry.consensusTimestamp =
          entry.consensusTimestamp ?? meta.consensusTimestamp;
        entry.sequenceNumber = entry.sequenceNumber ?? meta.sequenceNumber;
      });
    }
    const queueIndex = metaQueue.indexOf(epoch);
    if (queueIndex >= 0) {
      metaQueue.splice(queueIndex, 1);
    }

    const idx = history.findIndex((entry) => entry.epoch === epoch);
    if (idx >= 0) {
      const updated: ConsensusEntry = {
        ...history[idx],
        consensusTimestamp:
          history[idx].consensusTimestamp ?? meta.consensusTimestamp,
        sequenceNumber: history[idx].sequenceNumber ?? meta.sequenceNumber,
        hcsMessage: history[idx].hcsMessage ?? `hcs://17/${stateTopicId}`,
      };
      history[idx] = updated;
      if (persistConsensus) {
        void persistConsensus(updated).catch(() => {});
      }
    }
  };
  const { stop: stopPolling } = createStateTopicPoller({
    mirrorBaseUrl,
    stateTopicId,
    pollIntervalMs,
    logger,
    initialLastTimestamp: options.initialLastTimestamp ?? "0",
    getEpochFromPayload,
    getFallbackEpoch: () => (metaQueue.length > 0 ? metaQueue[0] : undefined),
    applyMeta,
    ingestProof,
    isProofPayload,
  });

  return {
    app: serverApp,
    getLatest: () => (publishConsensus ? getLatestPublishedConsensus() : history[history.length - 1]) ?? null,
    waitForConsensus: (timeoutMs: number) =>
      new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const latest = publishConsensus
            ? getLatestPublishedConsensus()
            : history[history.length - 1];
          if (latest) {
            resolve(latest);
            return;
          }
          if (Date.now() - start > timeoutMs) {
            resolve(null);
            return;
          }
          setTimeout(check, 500);
        };
        check();
      }),
    stopPolling,
  };
};
