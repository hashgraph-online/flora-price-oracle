# @hol-org/adapter-coingecko

| ![](https://raw.githubusercontent.com/hashgraph-online/standards-sdk/main/Hashgraph-Online.png) | HOL Flora adapter for HBAR→USD pricing sourced from Coingecko, ready for HCS-21 adapter registries. Built and maintained by Hashgraph Online.<br><br>[📚 Standards SDK Docs](https://hol.org/docs/libraries/standards-sdk/)<br>[📖 HCS Standards](https://hol.org/docs/standards) |
| :-- | :-- |

## Install

```bash
npm install @hol-org/adapter-coingecko
```

## Usage

```ts
import adapter from "@hol-org/adapter-coingecko";

const record = await adapter.discoverPrice();
// { entityId: "HBAR-USD", adapterId: "coingecko", payload: { price, source: "coingecko" }, timestamp }
```

## Links

- Homepage: https://github.com/hashgraph-online/flora-price-oracle
- Issues: https://github.com/hashgraph-online/flora-price-oracle/issues
- Publisher: Hashgraph Online (https://hol.org)
- Security: https://github.com/hashgraph-online/standards-sdk/blob/main/SECURITY.md
- Maintainers: https://github.com/hashgraph-online/standards-sdk/blob/main/MAINTAINERS.md

## License

Apache-2.0
