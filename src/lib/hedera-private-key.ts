import { PrivateKey } from "@hashgraph/sdk";
import type { HederaKeyType } from "./operator-key-type.js";

export const parsePrivateKey = (
  value: string,
  keyType?: HederaKeyType,
): PrivateKey => {
  const trimmed = value.trim();
  if (PrivateKey.isDerKey(trimmed)) {
    return PrivateKey.fromStringDer(trimmed);
  }
  if (keyType === "ed25519") {
    return PrivateKey.fromStringED25519(trimmed);
  }
  return PrivateKey.fromStringECDSA(trimmed);
};
