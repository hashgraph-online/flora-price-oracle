import { BinanceAdapter } from "@hol-org/adapter-binance";
import { CoingeckoAdapter } from "@hol-org/adapter-coingecko";
import { HederaRateAdapter } from "@hol-org/adapter-hedera-rate";
import type { PriceAdapter } from "./types.js";

const ADAPTER_BUILDERS: Record<string, () => PriceAdapter> = {
  binance: () => new BinanceAdapter(),
  coingecko: () => new CoingeckoAdapter(),
  hedera: () => new HederaRateAdapter(),
  "hedera-rate": () => new HederaRateAdapter(),
};

export type Hcs21RegistryEntry = {
  adapter_id: string;
  entity: string;
  hash: string;
};

export const loadAdaptersFromRegistry = (
  entries: Hcs21RegistryEntry[],
  entityFilter: string,
): { adapters: PriceAdapter[]; fingerprints: Record<string, string> } => {
  const adapters: PriceAdapter[] = [];
  const fingerprints: Record<string, string> = {};
  const seen = new Set<string>();

  const resolveBuilder = (adapterId: string): (() => PriceAdapter) | undefined => {
    const key = adapterId.toLowerCase();
    if (key.includes("binance")) return ADAPTER_BUILDERS.binance;
    if (key.includes("coingecko")) return ADAPTER_BUILDERS.coingecko;
    if (key.includes("hedera")) return ADAPTER_BUILDERS.hedera;
    return ADAPTER_BUILDERS[adapterId];
  };

  entries
    .filter((entry) => entry.entity === entityFilter)
    .forEach((entry) => {
      if (seen.has(entry.adapter_id)) {
        return;
      }
      const builder = resolveBuilder(entry.adapter_id);
      if (!builder) {
        return;
      }
      adapters.push(builder());
      fingerprints[entry.adapter_id] = entry.hash;
      seen.add(entry.adapter_id);
    });

  return { adapters, fingerprints };
};
