import crypto from "node:crypto";

type AdapterRecord = {
  adapterId: string;
  entityId: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sourceFingerprint: string;
};

const DEFAULT_ENDPOINT = "https://api.binance.us/api/v3/ticker/price?symbol=HBARUSD";

export class BinanceAdapter {
  readonly id = "binance";
  readonly entity = "HBAR-USD";
  readonly source = "binance";
  private lastPrice: number | null = null;
  private lastFetchedMs = 0;

  private sha384(input: string): string {
    return crypto.createHash("sha384").update(input).digest("hex");
  }

  async discoverPrice(): Promise<AdapterRecord> {
    const now = Date.now();
    if (this.lastPrice !== null && now - this.lastFetchedMs < 15000) {
      const payload = { price: this.lastPrice, source: this.source, symbol: "HBARUSD" };
      return {
        adapterId: this.id,
        entityId: this.entity,
        payload,
        timestamp: new Date().toISOString(),
        sourceFingerprint: this.sha384(JSON.stringify(payload)),
      };
    }

    const endpoint = process.env.BINANCE_TICKER_URL ?? DEFAULT_ENDPOINT;
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Binance ticker request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { price?: string };
    const price = data.price ? Number(data.price) : Number.NaN;
    if (!Number.isFinite(price)) {
      throw new Error("Binance returned an invalid price");
    }
    const normalized = Number(price.toFixed(8));
    this.lastPrice = normalized;
    this.lastFetchedMs = now;
    const payload = { price: normalized, source: this.source, symbol: "HBARUSD", endpoint };
    return {
      adapterId: this.id,
      entityId: this.entity,
      payload,
      timestamp: new Date().toISOString(),
      sourceFingerprint: this.sha384(JSON.stringify(payload)),
    };
  }
}
