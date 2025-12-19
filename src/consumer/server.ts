import express, { type NextFunction, type Request, type Response } from 'express';
import fetch from 'node-fetch';
import { Logger } from '@hashgraphonline/standards-sdk';
import { aggregateConsensus } from './consensus.js';
import type {
  ProofPayload,
  ConsensusEntry,
  ConsumerConfig,
  PetalAdapterState,
  ConsumerHandle,
} from './types.js';
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
  const chunkBuffer: Map<
    string,
    {
      total: number;
      parts: (string | undefined)[];
    }
  > = new Map();
  const accountKeyCache = new Map<
    string,
    { fetchedAt: number; keyType: string; publicKey: string }
  >();
  const ACCOUNT_KEY_TTL_MS = 5 * 60 * 1000;
  const {
    quorum,
    expectedPetals,
    thresholdFingerprint,
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

  const serverApp = express();
  const persistConsensus = options.persistConsensus;
  const logger = Logger.getInstance({ module: 'flora-consumer' });

  const normalizeMirrorBaseUrl = (value: string): string => {
    const trimmed = value.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed.slice(0, -'/api/v1'.length) : trimmed;
  };

  const fetchAccountKey = async (
    accountId: string
  ): Promise<{ keyType: string; publicKey: string } | null> => {
    const cached = accountKeyCache.get(accountId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < ACCOUNT_KEY_TTL_MS) {
      return { keyType: cached.keyType, publicKey: cached.publicKey };
    }

    const base = normalizeMirrorBaseUrl(mirrorBaseUrl);
    const url = `${base}/api/v1/accounts/${accountId}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const body = (await response.json()) as {
        key?: { _type?: string; key?: string };
      };
      const keyType = body.key?._type;
      const publicKey = body.key?.key;
      if (typeof keyType !== 'string' || typeof publicKey !== 'string') {
        return null;
      }
      accountKeyCache.set(accountId, { fetchedAt: now, keyType, publicKey });
      return { keyType, publicKey };
    } catch {
      return null;
    }
  };

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

  serverApp.post('/proof', (req: Request, res: Response) => {
    const payload: unknown = req.body;

    if (isChunkedProofPayload(payload)) {
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
    if (payload.participants.length !== expectedPetals) {
      logger.warn('[proof] rejected: participants mismatch');
      return res.status(400).json({ error: 'Unexpected participants' });
    }

    ingestProof(payload);
    return res.json({ status: 'accepted' });
  });

  serverApp.get('/price/latest', (_req: Request, res: Response) => {
    const latest = history[history.length - 1];
    if (!latest) {
      return res.status(404).json({ error: 'No consensus yet' });
    }
    return res.json({
      ...latest,
      hcsMessage: latest.hcsMessage ?? `hcs://17/${stateTopicId}`,
    });
  });

  serverApp.get('/price/history', (_req: Request, res: Response) => {
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

  serverApp.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  serverApp.get('/adapters', async (_req: Request, res: Response) => {
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

  let pollTimer: NodeJS.Timeout | null = null;
  let lastTimestamp = options.initialLastTimestamp ?? '0';

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
      expectedPetals
    );
    if (consensus) {
      const exists = history.some(
        (entry) =>
          entry.epoch === consensus.epoch &&
          entry.stateHash === consensus.stateHash
      );
      if (!exists) {
        history.push(consensus);
        history.sort((a, b) => a.epoch - b.epoch);
        if (options.persistConsensus) {
          void options.persistConsensus(consensus).catch(() => {
          });
        }
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
        void persistConsensus(updated).catch(() => {
        });
      }
    }
  };

  const pollMirror = async (): Promise<void> => {
    const url = `${mirrorBaseUrl}/api/v1/topics/${stateTopicId}/messages?order=asc&limit=50${
      lastTimestamp ? `&timestamp=gt:${lastTimestamp}` : ''
    }`;
    const response = await fetch(url);
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as {
      messages: {
        consensus_timestamp: string;
        sequence_number: number;
        message: string;
      }[];
    };
    const messages = body.messages ?? [];
    for (const entry of messages) {
      const ts = entry.consensus_timestamp;
      if (lastTimestamp && ts && ts <= lastTimestamp) {
        continue;
      }
      lastTimestamp = ts;
      try {
        const decoded = Buffer.from(entry.message, 'base64').toString('utf8');
        const payload = JSON.parse(decoded) as unknown;

        const payloadEpoch = getEpochFromPayload(payload);
        const targetEpoch =
          payloadEpoch ??
          (metaQueue.length > 0 ? metaQueue[0] : undefined);

        if (typeof targetEpoch === 'number') {
          applyMeta(targetEpoch, {
            consensusTimestamp: ts,
            sequenceNumber: entry.sequence_number,
          });
        }

        if (isProofPayload(payload)) {
          ingestProof({
            ...payload,
            hcsMessage: `hcs://17/${stateTopicId}`,
            consensusTimestamp: ts,
            sequenceNumber: entry.sequence_number,
          });
        }
      } catch {
        logger.warn('[mirror] message parse failed');
      }
    }
  };

  const startPolling = () => {
    pollTimer = setInterval(() => {
      void pollMirror();
    }, pollIntervalMs);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  startPolling();

  return {
    app: serverApp,
    getLatest: () => history[history.length - 1] ?? null,
    waitForConsensus: (timeoutMs: number) =>
      new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const latest = history[history.length - 1];
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
