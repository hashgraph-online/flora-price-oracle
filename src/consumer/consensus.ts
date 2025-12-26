import { canonicalize } from '../lib/canonicalize.js';
import { sha384 } from '../lib/hash.js';
import type { AdapterRecord } from '../adapters/types.js';
import type { ConsensusEntry, ProofPayload } from './types.js';
import { sortAccountIds } from './leader.js';

const isAccountId = (value: string): boolean => /^\d+\.\d+\.\d+$/.test(value.trim());

export type ConsensusResult = {
  entry: ConsensusEntry;
  proofs: ProofPayload[];
};

export const normalizeRecords = (records: AdapterRecord[]): AdapterRecord[] => {
  return [...records].sort((a, b) => {
    if (a.adapterId === b.adapterId) {
      return a.entityId.localeCompare(b.entityId);
    }
    return a.adapterId.localeCompare(b.adapterId);
  });
};

export const aggregateConsensus = (
  epoch: number,
  proofs: ProofPayload[],
  quorum: number,
  thresholdFingerprint: string,
  participants?: string[],
): ConsensusResult | null => {
  if (proofs.length < quorum) return null;

  const proofsByHash = new Map<string, ProofPayload[]>();
  for (const proof of proofs) {
    const hash = proof.stateHash;
    if (!hash) continue;
    const bucket = proofsByHash.get(hash);
    if (bucket) {
      bucket.push(proof);
    } else {
      proofsByHash.set(hash, [proof]);
    }
  }

  let chosenHash: string | null = null;
  let matching: ProofPayload[] = [];
  for (const [hash, bucket] of proofsByHash.entries()) {
    if (bucket.length > matching.length) {
      chosenHash = hash;
      matching = bucket;
    }
  }

  if (!chosenHash || matching.length < quorum) return null;

  const first = matching[0];
  const stateHash = sha384(
    canonicalize({
      records: normalizeRecords(first.records),
      thresholdFingerprint,
      adapterFingerprints: first.adapterFingerprints,
      registryTopicId: first.registryTopicId,
    })
  );
  if (stateHash !== chosenHash) return null;

  const prices = matching
    .flatMap((proof) => proof.records.map((record) => record.payload.price))
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));
  if (prices.length === 0) return null;

  const medianPrice = (): number => {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const proofParticipants = matching.flatMap((proof) => proof.participants ?? []);
  const proofAccountIds = proofParticipants.filter(isAccountId);
  let participantPool: string[] = [];
  if (participants && participants.length > 0) {
    participantPool = participants;
  } else if (proofAccountIds.length > 0) {
    participantPool = proofAccountIds;
  } else {
    participantPool = matching.map((proof) => proof.petalAccountId);
  }
  const participantIds = sortAccountIds(participantPool);
  const sources = matching.flatMap((proof) =>
    proof.records.map((record) => ({
      source: record.adapterId,
      price: record.payload.price as number,
    }))
  );

  const normalizedPrice = Number(medianPrice().toFixed(8));

  return {
    entry: {
      epoch,
      stateHash,
      price: normalizedPrice,
      timestamp: first.timestamp,
      participants: participantIds,
      sources: sources.map((entry) => ({
        source: entry.source,
        price: Number((entry.price ?? 0).toFixed(8)),
      })),
      hcsMessage: first.hcsMessage,
      consensusTimestamp:
        matching.map((p) => p.consensusTimestamp).find((v) => Boolean(v)) ??
        first.consensusTimestamp,
      sequenceNumber:
        matching.map((p) => p.sequenceNumber).find((v) => v !== undefined) ??
        first.sequenceNumber,
    },
    proofs: matching,
  };
};
