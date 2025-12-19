import fetch from "node-fetch";

export type HederaKeyType = "ed25519" | "ecdsa";

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

export const resolveOperatorKeyType = async (params: {
  mirrorBaseUrl: string;
  accountId: string;
}): Promise<HederaKeyType> => {
  const mirrorBaseUrl = normalizeBaseUrl(params.mirrorBaseUrl);
  const url = `${mirrorBaseUrl}/api/v1/accounts/${params.accountId}`;
  const response = await fetch(url);
  if (!response.ok) {
    return "ecdsa";
  }
  const body = (await response.json()) as { key?: { _type?: string } };
  const keyType = body.key?._type ?? "";
  if (keyType.includes("ED25519")) {
    return "ed25519";
  }
  if (keyType.includes("ECDSA")) {
    return "ecdsa";
  }
  return "ecdsa";
};

