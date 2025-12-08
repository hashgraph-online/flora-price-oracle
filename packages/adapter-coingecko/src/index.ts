import crypto from "node:crypto";

type AdapterRecord = {
  adapterId: string;
  entityId: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sourceFingerprint: string;
};

export class CoingeckoAdapter {
  readonly id = "coingecko";
  readonly entity = "HBAR-USD";
  readonly source = "kraken";
  private lastPrice: number | null = null;
  private lastFetchedMs = 0;

  private sha384(input: string): string {
    return crypto.createHash("sha384").update(input).digest("hex");
  }

  async discoverPrice(): Promise<AdapterRecord> {
    const now = Date.now();
    if (this.lastPrice !== null && now - this.lastFetchedMs < 15000) {
      const payload = { price: this.lastPrice, source: this.source, slug: "hedera-hashgraph" };
      return {
        adapterId: this.id,
        entityId: this.entity,
        payload,
        timestamp: new Date().toISOString(),
        sourceFingerprint: this.sha384(JSON.stringify(payload)),
      };
    }

    const response = await fetch("https://api.kraken.com/0/public/Ticker?pair=HBARUSD");
    if (!response.ok) {
      throw new Error(`Kraken request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { result?: Record<string, { c?: [string, string?, string?, string?] }> };
    const ticker = data.result?.HBARUSD ?? Object.values(data.result ?? {})[0];
    const priceStr = ticker?.c?.[0];
    const price = priceStr ? Number(priceStr) : NaN;
    if (!Number.isFinite(price)) {
      throw new Error("Kraken returned an invalid price");
    }
    const normalized = Number(price.toFixed(8));
    this.lastPrice = normalized;
    this.lastFetchedMs = now;
    const payload = {
      price: normalized,
      source: this.source,
      slug: "kraken-hbarusd",
    };

    return {
      adapterId: this.id,
      entityId: this.entity,
      payload,
      timestamp: new Date().toISOString(),
      sourceFingerprint: this.sha384(JSON.stringify(payload)),
    };
  }
}
