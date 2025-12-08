# @hol-org/adapter-hedera-rate

| ![](https://raw.githubusercontent.com/hashgraph-online/standards-sdk/main/Hashgraph-Online.png) | HOL Flora adapter that pulls HBAR exchange rates from Hedera's mirror node API, emitting HCS-21 compatible records. Built and maintained by Hashgraph Online.<br><br>[📚 Standards SDK Docs](https://hol.org/docs/libraries/standards-sdk/)<br>[📖 HCS Standards](https://hol.org/docs/standards) |
| :-- | :-- |

## Install

```bash
npm install @hol-org/adapter-hedera-rate
```

## Usage

```ts
import adapter from "@hol-org/adapter-hedera-rate";

const record = await adapter.discoverPrice();
// { entityId: "HBAR-USD", adapterId: "hedera-rate", payload: { price, source: "hedera", mirror: <url> }, timestamp }
```

## Links

- Homepage: https://github.com/hashgraph-online/flora-price-oracle
- Issues: https://github.com/hashgraph-online/flora-price-oracle/issues
- Publisher: Hashgraph Online (https://hol.org)
- Security: https://github.com/hashgraph-online/standards-sdk/blob/main/SECURITY.md
- Maintainers: https://github.com/hashgraph-online/standards-sdk/blob/main/MAINTAINERS.md

## License

Apache-2.0
