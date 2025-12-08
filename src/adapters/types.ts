export interface AdapterRecord {
  adapterId: string;
  entityId: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sourceFingerprint: string;
}

export interface PriceAdapter {
  readonly id: string;
  readonly entity: string;
  readonly source: string;
  discoverPrice(): Promise<AdapterRecord>;
}
