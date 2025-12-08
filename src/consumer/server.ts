import express from 'express';
import fetch from 'node-fetch';
import { aggregateConsensus } from './consensus.js';
import type {
  ProofPayload,
  ConsensusEntry,
  ConsumerConfig,
  PetalAdapterState,
  ConsumerHandle,
} from './types.js';

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
  const {
    quorum,
    expectedPetals,
    port,
    thresholdFingerprint,
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

  if (!stateTopicId) {
    throw new Error('STATE_TOPIC_ID is required for consumer');
  }

  if (!coordinationTopicId || !transactionTopicId) {
    throw new Error('Coordination and transaction topics are required for consumer');
  }

  const serverApp = express();
  const persistConsensus = options.persistConsensus;
  serverApp.use((req, res, next) => {
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

  serverApp.post('/proof', (req, res) => {
    const proof = req.body as ProofPayload;
    // lightweight debug log for ingestion visibility
    // eslint-disable-next-line no-console
    console.log(
      `[proof] received epoch=${proof?.epoch} petal=${
        proof?.petalId
      } participants=${proof?.participants?.length ?? 0}`
    );

    if (proof.thresholdFingerprint !== thresholdFingerprint) {
      // eslint-disable-next-line no-console
      console.warn('[proof] rejected: threshold mismatch');
      return res.status(400).json({ error: 'Invalid threshold fingerprint' });
    }
    if (proof.registryTopicId !== adapterCategoryTopicId) {
      // eslint-disable-next-line no-console
      console.warn('[proof] rejected: registry topic mismatch');
      return res.status(400).json({ error: 'Unexpected registry topic' });
    }
    if (!proof.participants || proof.participants.length !== expectedPetals) {
      // eslint-disable-next-line no-console
      console.warn('[proof] rejected: participants mismatch');
      return res.status(400).json({ error: 'Unexpected participants' });
    }

    ingestProof(proof);

    return res.json({ status: 'accepted' });
  });

  serverApp.get('/price/latest', (_req, res) => {
    const latest = history[history.length - 1];
    if (!latest) {
      return res.status(404).json({ error: 'No consensus yet' });
    }
    return res.json({
      ...latest,
      hcsMessage: latest.hcsMessage ?? `hcs://17/${stateTopicId}`,
    });
  });

  serverApp.get('/price/history', (_req, res) => {
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

  serverApp.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  serverApp.get('/adapters', (_req, res) => {
    const petals = Array.from(petalAdapters.values()).sort((a, b) =>
      a.petalId.localeCompare(b.petalId)
    );
    const aggregateFingerprints: Record<string, string> = {};
    const aggregateAdapters = new Set<string>();
    petals.forEach((entry) => {
      entry.adapters.forEach((adapterId) => aggregateAdapters.add(adapterId));
      Object.entries(entry.fingerprints).forEach(([id, fp]) => {
        aggregateFingerprints[id] = fp;
      });
    });
    res.json({
      petals,
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
        },
    });
  });

  let pollTimer: NodeJS.Timeout | null = null;
  let lastTimestamp = options.initialLastTimestamp ?? '0';

  const ingestProof = (proof: ProofPayload) => {
    const meta = metaByEpoch.get(proof.epoch);
    const hcsPointer = `hcs://17/${stateTopicId}`;
    const enriched: ProofPayload = {
      ...proof,
      hcsMessage: proof.hcsMessage ?? hcsPointer,
      consensusTimestamp: meta?.consensusTimestamp ?? proof.consensusTimestamp,
      sequenceNumber: meta?.sequenceNumber ?? proof.sequenceNumber,
    };

    // handle chunked payloads
    // @ts-ignore: partial chunk typing for brevity
    if (enriched.chunk_id && enriched.total_chunks && enriched.data) {
      const key = `${enriched.petalId}-${enriched.epoch}`;
      const existing = chunkBuffer.get(key) ?? {
        total: enriched.total_chunks,
        parts: new Array(enriched.total_chunks),
      };
      existing.parts[enriched.chunk_id - 1] = enriched.data as unknown as string;
      chunkBuffer.set(key, existing);
      if (existing.parts.every((part) => part !== undefined)) {
        const assembled = existing.parts.join('');
        try {
          const parsed = JSON.parse(assembled) as ProofPayload;
          chunkBuffer.delete(key);
          ingestProof(parsed);
          return;
        } catch {
          // ignore malformed chunk assembly
        }
      }
      return;
    }

    const adapterIds = Object.keys(enriched.adapterFingerprints ?? {}).sort();
    petalAdapters.set(enriched.petalId, {
      petalId: enriched.petalId,
      accountId: enriched.accountId,
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
            // persistence failure is non-fatal for demo
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
          // persistence failure is non-fatal for demo
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
        const payload = JSON.parse(decoded) as Partial<ProofPayload> & {
          epoch?: number;
        };

        const targetEpoch =
          typeof payload.epoch === 'number'
            ? payload.epoch
            : metaQueue.length > 0
            ? metaQueue[0]
            : undefined;

        if (typeof targetEpoch === 'number') {
          applyMeta(targetEpoch, {
            consensusTimestamp: ts,
            sequenceNumber: entry.sequence_number,
          });
        }

        if (
          payload.records &&
          Array.isArray(payload.records) &&
          payload.records.length > 0
        ) {
          ingestProof({
            ...(payload as ProofPayload),
            hcsMessage: `hcs://17/${stateTopicId}`,
            consensusTimestamp: ts,
            sequenceNumber: entry.sequence_number,
          });
        }
      } catch {
        // ignore malformed entries
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
