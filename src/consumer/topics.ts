import {
  HCS17Client,
  HCS16Client,
  FloraTopicType,
  type NetworkType,
} from '@hashgraphonline/standards-sdk';
import { getState, setState } from './persistence.js';

const mirrorNodeUrl = process.env.MIRROR_BASE_URL ?? 'https://testnet.mirrornode.hedera.com';

export const resolveFloraTopics = async (
  operatorId: string,
  operatorKey: string,
  network: NetworkType
): Promise<{ stateTopicId: string; coordinationTopicId: string; transactionTopicId: string }> => {
  const persistedStateTopic = await getState('state_topic_id');
  const persistedCoordTopic = await getState('coordination_topic_id');
  const persistedTxnTopic = await getState('transaction_topic_id');

  const stateTopicId =
    (process.env.STATE_TOPIC_ID && process.env.STATE_TOPIC_ID.trim().length > 0
      ? process.env.STATE_TOPIC_ID
      : persistedStateTopic) ||
    (await new HCS17Client({
      network,
      operatorId,
      operatorKey,
      mirrorNodeUrl,
    }).createStateTopic());

  const floraClient = new HCS16Client({ network, operatorId, operatorKey });

  const coordinationTopicId =
    (process.env.CTOPIC_ID && process.env.CTOPIC_ID.trim().length > 0
      ? process.env.CTOPIC_ID
      : persistedCoordTopic) ||
    (await floraClient.createFloraTopic({ floraAccountId: operatorId, topicType: FloraTopicType.COMMUNICATION }));

  const transactionTopicId =
    (process.env.TTOPIC_ID && process.env.TTOPIC_ID.trim().length > 0
      ? process.env.TTOPIC_ID
      : persistedTxnTopic) ||
    (await floraClient.createFloraTopic({ floraAccountId: operatorId, topicType: FloraTopicType.TRANSACTION }));

  await setState('state_topic_id', stateTopicId);
  await setState('coordination_topic_id', coordinationTopicId);
  await setState('transaction_topic_id', transactionTopicId);

  return { stateTopicId, coordinationTopicId, transactionTopicId };
};
