import type { AdapterRecord } from '../adapters/types.js';
import type { NetworkType } from '@hashgraphonline/standards-sdk';

export type ProofPayload = {
  epoch: number;
  stateHash: string;
  thresholdFingerprint: string;
  petalId: string;
  petalAccountId: string;
  petalStateTopicId: string;
  floraAccountId: string;
  participants: string[];
  records: AdapterRecord[];
  timestamp: string;
  adapterFingerprints: Record<string, string>;
  registryTopicId: string;
  hcsMessage?: string;
  consensusTimestamp?: string;
  sequenceNumber?: number;
};

export type ConsensusEntry = {
  epoch: number;
  stateHash: string;
  price: number;
  timestamp: string;
  participants: string[];
  sources: { source: string; price: number }[];
  hcsMessage?: string;
  consensusTimestamp?: string;
  sequenceNumber?: number;
};

export type ConsumerConfig = {
  quorum: number;
  expectedPetals: number;
  port: number;
  thresholdFingerprint: string;
  petalAccountsById?: Record<string, string>;
  floraAccountId: string;
  stateTopicId: string;
  coordinationTopicId: string;
  transactionTopicId: string;
  network: NetworkType;
  mirrorBaseUrl: string;
  pollIntervalMs: number;
  adapterCategoryTopicId: string;
  adapterDiscoveryTopicId: string;
  adapterTopics: Record<
    string,
    { versionTopicId: string; declarationTopicId: string; manifestPointer: string }
  >;
  adapterRegistryMetadataPointer: string;
};

export type PetalAdapterState = {
  petalId: string;
  accountId?: string;
  publicKey?: string;
  keyType?: string;
  stateTopicId?: string;
  epoch: number;
  timestamp: string;
  adapters: string[];
  fingerprints: Record<string, string>;
};

export type ConsumerHandle = {
  stop: () => void;
  getLatest: () => ConsensusEntry | null;
  waitForConsensus: (timeoutMs: number) => Promise<ConsensusEntry | null>;
};
