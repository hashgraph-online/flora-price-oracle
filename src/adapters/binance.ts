import { sha384 } from "../lib/hash.js";
import { fetchWithTimeout } from "../lib/http.js";
import type { AdapterRecord, PriceAdapter } from "./types.js";

export class BinanceAdapter implements PriceAdapter {
  readonly id = "binance";
  readonly entity = "HBAR-USD";
  readonly source = "binance";

  discoverPrice = async (): Promise<AdapterRecord> => {
    const response = await fetchWithTimeout("https://api.binance.us/api/v3/ticker/price?symbol=HBARUSD", {}, 4_000);
    if (!response.ok) {
      throw new Error(`Binance request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { price?: string };
    const price = data.price ? Number(data.price) : NaN;
    if (!Number.isFinite(price)) {
      throw new Error("Binance returned an invalid price");
    }
    const payload = {
      price,
      source: this.source,
      symbol: "HBARUSD",
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
