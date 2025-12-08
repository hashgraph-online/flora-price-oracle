import { sha384 } from "../lib/hash.js";
import { fetchWithTimeout } from "../lib/http.js";
import type { AdapterRecord, PriceAdapter } from "./types.js";

export class CoingeckoAdapter implements PriceAdapter {
  readonly id = "coingecko";
  readonly entity = "HBAR-USD";
  readonly source = "coingecko";

  discoverPrice = async (): Promise<AdapterRecord> => {
    const response = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd",
      {},
      4_000,
    );
    if (!response.ok) {
      throw new Error(`CoinGecko request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { "hedera-hashgraph"?: { usd?: number } };
    const price = data?.["hedera-hashgraph"]?.usd ?? NaN;
    if (!Number.isFinite(price)) {
      throw new Error("CoinGecko returned an invalid price");
    }
    const payload = {
      price,
      source: this.source,
      slug: "hedera-hashgraph",
    };

    return {
      adapterId: this.id,
      entityId: this.entity,
      payload,
      timestamp: new Date().toISOString(),
      sourceFingerprint: sha384(JSON.stringify(payload)),
    };
  };
}
