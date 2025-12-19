import type { AdapterRecord } from "../adapters/types.js";
import type { ProofPayload } from "./types.js";

export type ChunkedProofPayload = {
  epoch: number;
  petalId: string;
  petalAccountId: string;
  floraAccountId: string;
  chunk_id: number;
  total_chunks: number;
  data: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every(isString);

const isAdapterRecord = (value: unknown): value is AdapterRecord => {
  if (!isRecord(value)) return false;
  return (
    isString(value.adapterId) &&
    isString(value.entityId) &&
    isRecord(value.payload) &&
    isString(value.timestamp) &&
    isString(value.sourceFingerprint)
  );
};

export const isProofPayload = (value: unknown): value is ProofPayload => {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.epoch) &&
    isString(value.stateHash) &&
    isString(value.thresholdFingerprint) &&
    isString(value.petalId) &&
    isString(value.petalAccountId) &&
    isString(value.floraAccountId) &&
    isStringArray(value.participants) &&
    Array.isArray(value.records) &&
    value.records.every(isAdapterRecord) &&
    isString(value.timestamp) &&
    isStringRecord(value.adapterFingerprints) &&
    isString(value.registryTopicId)
  );
};

export const isChunkedProofPayload = (
  value: unknown,
): value is ChunkedProofPayload => {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.epoch) &&
    isString(value.petalId) &&
    isString(value.petalAccountId) &&
    isString(value.floraAccountId) &&
    isNumber(value.chunk_id) &&
    isNumber(value.total_chunks) &&
    isString(value.data)
  );
};

export const getEpochFromPayload = (value: unknown): number | undefined => {
  if (!isRecord(value)) return undefined;
  return isNumber(value.epoch) ? value.epoch : undefined;
};
