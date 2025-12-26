import { Logger, type NetworkType } from "@hashgraphonline/standards-sdk";
import { AccountId, TopicMessageSubmitTransaction, TransactionId } from "@hashgraph/sdk";
import { buildHederaClient } from "../lib/hedera-client.js";
import { parsePrivateKey } from "../lib/hedera-private-key.js";
import type { HederaKeyType } from "../lib/operator-key-type.js";
import type { ConsensusEntry } from "./types.js";

const logger = Logger.getInstance({ module: "flora-consumer" });

export type PublishedConsensusMeta = {
  consensusTimestamp?: string;
  sequenceNumber?: number;
  hcsMessage?: string;
};

type Hcs17StateHashConsensusMessage = {
  p: "hcs-17";
  op: "state_hash";
  m: string;
  account_id: string;
  state_hash: string;
  topics: string[];
  epoch: number;
  price: number;
  threshold_fingerprint: string;
  participants: string[];
};

export const publishConsensusToStateTopic = async (params: {
  network: NetworkType;
  publisherAccountId: string;
  publisherPrivateKey: string;
  publisherKeyType?: HederaKeyType;
  floraAccountId: string;
  stateTopicId: string;
  topics: string[];
  entry: ConsensusEntry;
  thresholdFingerprint: string;
}): Promise<PublishedConsensusMeta> => {
  const hederaClient = buildHederaClient({
    network: params.network,
    operatorId: params.publisherAccountId,
    operatorKey: params.publisherPrivateKey,
    operatorKeyType: params.publisherKeyType,
  });

  const topicList = Array.from(
    new Set(
      [params.stateTopicId, ...params.topics]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const message: Hcs17StateHashConsensusMessage = {
    p: "hcs-17",
    op: "state_hash",
    m: `hcs17:${params.entry.epoch}`,
    account_id: params.floraAccountId,
    state_hash: params.entry.stateHash,
    topics: topicList,
    epoch: params.entry.epoch,
    price: params.entry.price,
    threshold_fingerprint: params.thresholdFingerprint,
    participants: params.entry.participants,
  };

  const tx = new TopicMessageSubmitTransaction()
    .setTransactionId(TransactionId.generate(AccountId.fromString(params.publisherAccountId)))
    .setTopicId(params.stateTopicId)
    .setMessage(JSON.stringify(message))
    .setTransactionMemo("hcs-16:op:2:2");

  const frozen = await tx.freezeWith(hederaClient);
  const signed = await frozen.sign(
    parsePrivateKey(params.publisherPrivateKey, params.publisherKeyType),
  );
  const resp = await signed.execute(hederaClient);
  const receipt = await resp.getReceipt(hederaClient);
  const record = await resp.getRecord(hederaClient).catch(() => null);

  const consensusTimestamp = record?.consensusTimestamp?.toString();
  const sequenceNumber = receipt.topicSequenceNumber
    ? Number(receipt.topicSequenceNumber)
    : undefined;

  if (!consensusTimestamp) {
    logger.warn("Published consensus entry but consensus timestamp unavailable", {
      epoch: params.entry.epoch,
    });
  }

  return {
    consensusTimestamp,
    sequenceNumber,
    hcsMessage: `hcs://17/${params.stateTopicId}`,
  };
};
