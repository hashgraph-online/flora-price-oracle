import { HCS17Client, HCS16Client, FloraTopicType } from "@hashgraphonline/standards-sdk";

const resolveNetwork = (): string => process.env.HEDERA_NETWORK ?? "testnet";

const resolveOperator = (): { accountId: string; privateKey: string } => {
  const accountId = process.env.HEDERA_ACCOUNT_ID ?? process.env.TESTNET_HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY ?? process.env.TESTNET_HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("Hedera operator credentials are required (HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY)");
  }
  return { accountId, privateKey };
};

/**
 * Create topics strictly via standards-sdk (HCS-16/HCS-17 memos).
 * - For HCS-17 memo format: hcs-17:0:<ttl>
 * - For HCS-16 memo format: hcs-16:<accountId>:<topicTypeEnum>
 */
export const ensureTopic = async (topicId?: string, memo?: string): Promise<string> => {
  if (topicId) {
    return topicId;
  }
  const { accountId, privateKey } = resolveOperator();
  const network = resolveNetwork();
  if (!memo) {
    throw new Error("Memo required to create topic via standards-sdk");
  }

  const hcs17Match = memo.match(/^hcs-17:(\d+):(\d+)$/);
  if (hcs17Match) {
    const ttl = Number(hcs17Match[2]);
    const client = new HCS17Client({
      network,
      operatorId: accountId,
      operatorKey: privateKey,
      mirrorNodeUrl: process.env.MIRROR_BASE_URL ?? "https://testnet.mirrornode.hedera.com",
    });
    return await client.createStateTopic({ ttl });
  }

  const hcs16Match = memo.match(/^hcs-16:([0-9.]+):(\d)$/);
  if (hcs16Match) {
    const floraAccountId = hcs16Match[1];
    const topicType = Number(hcs16Match[2]) as FloraTopicType;
    const floraClient = new HCS16Client({
      network,
      operatorId: accountId,
      operatorKey: privateKey,
    });
    return await floraClient.createFloraTopic({ floraAccountId, topicType });
  }

  throw new Error("Unsupported memo format; only HCS-16 and HCS-17 topic creation is allowed.");
};
