import type { JSONValue } from "../lib/canonicalize.js";

export interface AdapterRecord extends Record<string, JSONValue> {
  adapterId: string;
  entityId: string;
  payload: Record<string, JSONValue>;
  timestamp: string;
  sourceFingerprint: string;
}

export interface PriceAdapter {
  readonly id: string;
  readonly entity: string;
  readonly source: string;
  discoverPrice(): Promise<AdapterRecord>;
}
