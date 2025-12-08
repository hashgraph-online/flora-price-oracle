import { sha384 } from "../lib/hash.js";
import type { AdapterRecord, PriceAdapter } from "./types.js";

export class MockAdapter implements PriceAdapter {
  readonly id: string;
  readonly entity = "HBAR-USD";
  readonly source = "mock";
  private readonly basePrice: number;

  constructor(id = "mock", basePrice = 0.0701) {
    this.id = id;
    this.basePrice = basePrice;
  }

  discoverPrice = async (): Promise<AdapterRecord> => {
    const price = Number(this.basePrice.toFixed(5));
    const payload = { price, source: this.source };

    return {
      adapterId: this.id,
      entityId: this.entity,
      payload,
      timestamp: new Date().toISOString(),
      sourceFingerprint: sha384(JSON.stringify(payload)),
    };
  };
}
