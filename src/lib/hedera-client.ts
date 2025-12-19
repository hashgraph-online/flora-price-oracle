import type { NetworkType } from "@hashgraphonline/standards-sdk";
import { AccountId, Client, PrivateKey } from "@hashgraph/sdk";
import type { HederaKeyType } from "./operator-key-type.js";

export const buildHederaClient = (params: {
  network: NetworkType;
  operatorId: string;
  operatorKey: string;
  operatorKeyType?: HederaKeyType;
}): Client => {
  const client =
    params.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();

  const operatorPrivateKey =
    params.operatorKeyType === "ed25519"
      ? PrivateKey.fromStringED25519(params.operatorKey)
      : PrivateKey.fromStringECDSA(params.operatorKey);

  client.setOperator(AccountId.fromString(params.operatorId), operatorPrivateKey);
  return client;
};

