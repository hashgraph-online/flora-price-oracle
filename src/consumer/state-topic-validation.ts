import { fetchWithTimeout } from "../lib/http.js";
import type { ProofPayload } from "./types.js";

type MirrorTopicMessage = {
  message?: string;
};

const normalizeMirrorBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -"/api/v1".length) : trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseStateHashPayload = (
  value: unknown,
): { stateHash: string; accountId: string; epoch?: number; memo?: string } | null => {
  if (!isRecord(value)) return null;
  if (value.p !== "hcs-17" || value.op !== "state_hash") return null;
  if (typeof value.state_hash !== "string") return null;
  if (typeof value.account_id !== "string") return null;
  const epoch =
    typeof value.epoch === "number" && Number.isFinite(value.epoch) ? value.epoch : undefined;
  const memo = typeof value.m === "string" ? value.m : undefined;
  return {
    stateHash: value.state_hash,
    accountId: value.account_id,
    epoch,
    memo,
  };
};

const decodeMirrorMessage = (entry: MirrorTopicMessage): unknown | null => {
  if (!entry.message) return null;
  try {
    const raw = Buffer.from(entry.message, "base64").toString("utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const fetchTopicMessages = async (
  mirrorBaseUrl: string,
  topicId: string,
  limit: number,
): Promise<MirrorTopicMessage[]> => {
  const base = normalizeMirrorBaseUrl(mirrorBaseUrl);
  const url = `${base}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`;
  const response = await fetchWithTimeout(url, {}, 5000);
  if (!response.ok) return [];
  const body = (await response.json()) as { messages?: MirrorTopicMessage[] };
  return Array.isArray(body.messages) ? body.messages : [];
};

const validateProofOnStateTopic = async (params: {
  mirrorBaseUrl: string;
  proof: ProofPayload;
  attempts: number;
  delayMs: number;
}): Promise<boolean> => {
  const { proof } = params;
  if (!proof.petalStateTopicId) return false;
  for (let attempt = 0; attempt < params.attempts; attempt += 1) {
    const messages = await fetchTopicMessages(
      params.mirrorBaseUrl,
      proof.petalStateTopicId,
      6,
    );
    for (const entry of messages) {
      const payload = decodeMirrorMessage(entry);
      const parsed = parseStateHashPayload(payload);
      if (!parsed) continue;
      if (parsed.stateHash !== proof.stateHash) continue;
      if (parsed.accountId !== proof.petalAccountId) continue;
      const memoMatch = parsed.memo === `hcs17:${proof.epoch}`;
      if (typeof parsed.epoch === "number") {
        if (parsed.epoch !== proof.epoch) continue;
      } else if (!memoMatch) {
        continue;
      }
      return true;
    }
    if (attempt < params.attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, params.delayMs));
    }
  }
  return false;
};

export const validateProofsOnStateTopics = async (params: {
  mirrorBaseUrl: string;
  proofs: ProofPayload[];
  attempts?: number;
  delayMs?: number;
}): Promise<{ valid: ProofPayload[]; invalid: ProofPayload[] }> => {
  const attempts = params.attempts ?? 6;
  const delayMs = params.delayMs ?? 2000;
  const valid: ProofPayload[] = [];
  const invalid: ProofPayload[] = [];

  for (const proof of params.proofs) {
    const ok = await validateProofOnStateTopic({
      mirrorBaseUrl: params.mirrorBaseUrl,
      proof,
      attempts,
      delayMs,
    });
    if (ok) {
      valid.push(proof);
    } else {
      invalid.push(proof);
    }
  }

  return { valid, invalid };
};
