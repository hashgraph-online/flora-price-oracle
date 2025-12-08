import "dotenv/config";
import { HCS21Client } from "../../standards-sdk/dist/es/standards-sdk.es.js";
import type { AdapterDeclaration } from "../src/adapters/declarations.js";

const buildDeclaration = (adapterId: string, pkgName: string, manifest: string, stopic: string): AdapterDeclaration => {
  return {
    p: "hcs-21",
    op: "register",
    adapter_id: adapterId,
    entity: "HBAR-USD",
    package: {
      registry: "npm",
      name: pkgName,
      version: "1.0.0",
      integrity: "sha384-demo",
    },
    manifest,
    config: {
      type: "flora",
      flora: {
        account: process.env.HEDERA_ACCOUNT_ID ?? "0.0.placeholder",
        threshold: process.env.THRESHOLD_FINGERPRINT ?? "demo-threshold",
        ctopic: process.env.CTOPIC_ID ?? "0.0.0",
        ttopic: process.env.TTOPIC_ID ?? "0.0.0",
        stopic,
      },
    },
    state_model: "hcs17:sha384",
  };
};

const main = async (): Promise<void> => {
  const client = new HCS21Client({
    network: (process.env.HEDERA_NETWORK as "testnet" | "mainnet" | "previewnet") ?? "testnet",
    operatorId: process.env.HEDERA_ACCOUNT_ID ?? "",
    operatorKey: process.env.HEDERA_PRIVATE_KEY ?? "",
    mirrorNodeUrl: process.env.MIRROR_BASE_URL,
  });

  const registryTopic =
    process.env.ADAPTER_REGISTRY_TOPIC_ID?.trim() && process.env.ADAPTER_REGISTRY_TOPIC_ID.trim().length > 0
      ? process.env.ADAPTER_REGISTRY_TOPIC_ID.trim()
      : await client.createRegistryTopic({ ttl: 3600, indexed: 0, type: 0 });

  const manifestPointer = (process.env.ADAPTER_MANIFEST_POINTER ?? `hcs://1/${process.env.STATE_TOPIC_ID ?? registryTopic}`).trim();
  // eslint-disable-next-line no-console
  console.log(`Using manifest pointer: ${manifestPointer}`);

  const declarations: AdapterDeclaration[] = [
    buildDeclaration("binance", "@hol-org/adapter-binance", manifestPointer, process.env.STATE_TOPIC_ID ?? registryTopic),
    buildDeclaration("coingecko", "@hol-org/adapter-coingecko", manifestPointer, process.env.STATE_TOPIC_ID ?? registryTopic),
  ];

  for (const decl of declarations) {
    const result = await client.publishDeclaration({
      topicId: registryTopic,
      declaration: decl,
    });
    // eslint-disable-next-line no-console
    console.log(`Published ${decl.adapter_id} (seq=${result.sequenceNumber ?? "?"}) to ${registryTopic}`);
  }
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
