import fetch from "node-fetch";

export type AccountKeyInfo = { keyType: string; publicKey: string };

const normalizeMirrorBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -"/api/v1".length) : trimmed;
};

export const createAccountKeyFetcher = (params: {
  mirrorBaseUrl: string;
  ttlMs?: number;
}): ((accountId: string) => Promise<AccountKeyInfo | null>) => {
  const cache = new Map<
    string,
    { fetchedAt: number; keyType: string; publicKey: string }
  >();
  const ttlMs = params.ttlMs ?? 5 * 60 * 1000;
  const base = normalizeMirrorBaseUrl(params.mirrorBaseUrl);

  return async (accountId: string): Promise<AccountKeyInfo | null> => {
    const cached = cache.get(accountId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < ttlMs) {
      return { keyType: cached.keyType, publicKey: cached.publicKey };
    }
    const url = `${base}/api/v1/accounts/${accountId}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const body = (await response.json()) as {
        key?: { _type?: string; key?: string };
      };
      const keyType = body.key?._type;
      const publicKey = body.key?.key;
      if (typeof keyType !== "string" || typeof publicKey !== "string") {
        return null;
      }
      cache.set(accountId, { fetchedAt: now, keyType, publicKey });
      return { keyType, publicKey };
    } catch {
      return null;
    }
  };
};
