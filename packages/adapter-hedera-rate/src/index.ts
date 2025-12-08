import crypto from "node:crypto";

type AdapterRecord = {
  adapterId: string;
  entityId: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sourceFingerprint: string;
};

type ExchangeRate = {
  current_rate?: { cent_equivalent?: number; hbar_equivalent?: number };
  next_rate?: { cent_equivalent?: number; hbar_equivalent?: number };
};

const computeUsd = (rate?: { cent_equivalent?: number; hbar_equivalent?: number }): number | null => {
  const cents = rate?.cent_equivalent;
  const hbar = rate?.hbar_equivalent;
  if (!cents || !hbar || hbar === 0) return null;
  return cents / hbar / 100;
};

export class HederaRateAdapter {
  readonly id = "hedera-rate";
  readonly entity = "HBAR-USD";
  readonly source = "hedera";

  private sha384(input: string): string {
    return crypto.createHash("sha384").update(input).digest("hex");
  }

  async discoverPrice(): Promise<AdapterRecord> {
    const mirrorBase = process.env.MIRROR_BASE_URL ?? "https://testnet.mirrornode.hedera.com";
    const response = await fetch(`${mirrorBase}/api/v1/network/exchangerate`);
    if (!response.ok) {
      throw new Error(`Mirror exchange rate failed with status ${response.status}`);
    }
    const data = (await response.json()) as ExchangeRate;
    const price = computeUsd(data.current_rate) ?? computeUsd(data.next_rate);
    if (!Number.isFinite(price)) {
      throw new Error("Mirror returned invalid exchange rate");
    }
    const normalized = Number(price.toFixed(8));
    const payload = { price: normalized, source: this.source, mirror: mirrorBase };
    return {
      adapterId: this.id,
      entityId: this.entity,
      payload,
      timestamp: new Date().toISOString(),
      sourceFingerprint: this.sha384(JSON.stringify(payload)),
    };
  }
}
