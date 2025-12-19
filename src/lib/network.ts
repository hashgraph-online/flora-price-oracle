import type { NetworkType } from "@hashgraphonline/standards-sdk";

const isNetworkType = (value: string): value is NetworkType =>
  value === "mainnet" || value === "testnet";

export const resolveNetwork = (value?: string | null): NetworkType => {
  const normalized = value?.trim().toLowerCase();
  if (normalized && isNetworkType(normalized)) {
    return normalized;
  }
  return "testnet";
};
