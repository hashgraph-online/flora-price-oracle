import fetch from "node-fetch";
import type { ProofPayload } from "./types.js";
import type { ILogger } from "@hashgraphonline/standards-sdk";

type MirrorMessage = {
  consensus_timestamp: string;
  sequence_number: number;
  message: string;
};

export const createStateTopicPoller = (params: {
  mirrorBaseUrl: string;
  stateTopicId: string;
  pollIntervalMs: number;
  logger: ILogger;
  initialLastTimestamp?: string;
  getEpochFromPayload: (payload: unknown) => number | undefined;
  getFallbackEpoch: () => number | undefined;
  applyMeta: (epoch: number, meta: { consensusTimestamp?: string; sequenceNumber?: number }) => void;
  ingestProof: (proof: ProofPayload) => void;
  isProofPayload: (payload: unknown) => payload is ProofPayload;
}): { start: () => void; stop: () => void } => {
  let pollTimer: NodeJS.Timeout | null = null;
  let lastTimestamp = params.initialLastTimestamp ?? "0";

  const pollMirror = async (): Promise<void> => {
    try {
      const url = `${params.mirrorBaseUrl}/api/v1/topics/${params.stateTopicId}/messages?order=asc&limit=50${
        lastTimestamp ? `&timestamp=gt:${lastTimestamp}` : ""
      }`;
      const response = await fetch(url);
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { messages?: MirrorMessage[] };
      const messages = body.messages ?? [];
      for (const entry of messages) {
        const ts = entry.consensus_timestamp;
        if (lastTimestamp && ts && ts <= lastTimestamp) {
          continue;
        }
        lastTimestamp = ts;
        try {
          const decoded = Buffer.from(entry.message, "base64").toString("utf8");
          const payload = JSON.parse(decoded) as unknown;
          const payloadEpoch = params.getEpochFromPayload(payload);
          const targetEpoch = payloadEpoch ?? params.getFallbackEpoch();
          if (typeof targetEpoch === "number") {
            params.applyMeta(targetEpoch, {
              consensusTimestamp: ts,
              sequenceNumber: entry.sequence_number,
            });
          }
          if (params.isProofPayload(payload)) {
            params.ingestProof({
              ...payload,
              hcsMessage: `hcs://17/${params.stateTopicId}`,
              consensusTimestamp: ts,
              sequenceNumber: entry.sequence_number,
            });
          }
        } catch {
          params.logger.warn("[mirror] message parse failed");
        }
      }
    } catch (error) {
      params.logger.warn("[mirror] poll failed", { error });
    }
  };

  const start = () => {
    pollTimer = setInterval(() => {
      void pollMirror();
    }, params.pollIntervalMs);
  };

  const stop = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  start();

  return { start, stop };
};
