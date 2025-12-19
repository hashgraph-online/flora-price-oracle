declare module "@hol-org/adapter-binance" {
  import type { AdapterRecord } from "./types.js";

  export class BinanceAdapter {
    readonly id: string;
    readonly entity: string;
    readonly source: string;
    discoverPrice(): Promise<AdapterRecord>;
  }
}

declare module "@hol-org/adapter-coingecko" {
  import type { AdapterRecord } from "./types.js";

  export class CoingeckoAdapter {
    readonly id: string;
    readonly entity: string;
    readonly source: string;
    discoverPrice(): Promise<AdapterRecord>;
  }
}

declare module "@hol-org/adapter-hedera-rate" {
  import type { AdapterRecord } from "./types.js";

  export class HederaRateAdapter {
    readonly id: string;
    readonly entity: string;
    readonly source: string;
    discoverPrice(): Promise<AdapterRecord>;
  }
}
