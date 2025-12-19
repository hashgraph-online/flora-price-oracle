import {
  HCS15Client,
  HCS11Client,
  ProfileType,
  Logger,
  AIAgentType,
  AIAgentCapability,
  type NetworkType,
  type HCS11Profile,
} from '@hashgraphonline/standards-sdk';
import {
  AccountBalanceQuery,
  AccountId,
  Hbar,
  TransferTransaction,
} from "@hashgraph/sdk";
import { getState, setSecureState, getSecureState, setState } from './persistence.js';
import { buildHederaClient } from "../lib/hedera-client.js";
import type { HederaKeyType } from "../lib/operator-key-type.js";

const logger = Logger.getInstance({ module: 'flora-consumer' });

const clampToPositiveNumber = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

const ensurePetalFunding = async (params: {
  hederaClient: ReturnType<typeof buildHederaClient>;
  operatorId: string;
  petalAccountId: string;
  minHbarBalance: number;
  targetHbarBalance: number;
}): Promise<void> => {
  const minBalance = clampToPositiveNumber(params.minHbarBalance);
  const targetBalance = clampToPositiveNumber(params.targetHbarBalance);
  if (minBalance === 0) return;

  const minTinybars = new Hbar(minBalance).toTinybars();
  const targetTinybars = new Hbar(Math.max(minBalance, targetBalance)).toTinybars();

  const balance = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(params.petalAccountId))
    .execute(params.hederaClient);

  const currentTinybars = balance.hbars.toTinybars();
  if (currentTinybars.greaterThanOrEqual(minTinybars)) return;

  const deltaTinybars = targetTinybars.subtract(currentTinybars);
  if (deltaTinybars.lessThanOrEqual(0)) return;

  const operator = AccountId.fromString(params.operatorId);
  const recipient = AccountId.fromString(params.petalAccountId);

  await new TransferTransaction()
    .addHbarTransfer(operator, Hbar.fromTinybars(deltaTinybars.negate()))
    .addHbarTransfer(recipient, Hbar.fromTinybars(deltaTinybars))
    .execute(params.hederaClient);

  logger.info("Funded petal account", {
    petalAccountId: params.petalAccountId,
    targetHbarBalance: Math.max(minBalance, targetBalance),
  });
};

export const provisionPetalAccounts = async (
  petalIds: string[],
  hcs15: HCS15Client,
  network: NetworkType,
  funding?: {
    operatorId: string;
    operatorKey: string;
    operatorKeyType?: HederaKeyType;
    minHbarBalance?: number;
    targetHbarBalance?: number;
  }
): Promise<Record<string, { accountId: string; privateKey: string }>> => {
  const results: Record<string, { accountId: string; privateKey: string }> = {};
  const hederaClient = funding
    ? buildHederaClient({
        network,
        operatorId: funding.operatorId,
        operatorKey: funding.operatorKey,
        operatorKeyType: funding.operatorKeyType,
      })
    : null;
  const minHbarBalance = funding?.minHbarBalance ?? 1;
  const targetHbarBalance = funding?.targetHbarBalance ?? 2;

  for (const petalId of petalIds) {
    const accountKey = `petal_account_${petalId}`;
    const privKeyKey = `petal_private_key_${petalId}`;
    const profileKey = `petal_profile_topic_${petalId}`;
    const cachedAccount = await getState(accountKey);
    const cachedPriv = await getSecureState(privKeyKey);
    if (cachedAccount && cachedPriv) {
      results[petalId] = { accountId: cachedAccount, privateKey: cachedPriv };
      if (hederaClient && funding) {
        await ensurePetalFunding({
          hederaClient,
          operatorId: funding.operatorId,
          petalAccountId: cachedAccount,
          minHbarBalance,
          targetHbarBalance,
        }).catch((error: unknown) => {
          logger.warn("Failed to fund cached petal account", {
            petalId,
            petalAccountId: cachedAccount,
            error,
          });
        });
      }
      continue;
    }

    const base = await hcs15.createBaseAccount({ accountMemo: `flora-base-${petalId}` });
    const petal = await hcs15.createPetalAccount({
      basePrivateKey: base.privateKey,
      accountMemo: `flora-petal-${petalId}`,
    });

    await setState(accountKey, petal.accountId);
    await setSecureState(privKeyKey, base.privateKey.toStringRaw());

    const hcs11 = new HCS11Client({
      network,
      auth: { operatorId: petal.accountId, privateKey: base.privateKey.toStringRaw() },
    });

    const profile: HCS11Profile = {
      version: '1.0',
      type: ProfileType.AI_AGENT,
      display_name: `Flora Petal ${petalId}`,
      aiAgent: {
        type: AIAgentType.AUTONOMOUS,
        capabilities: [AIAgentCapability.DATA_INTEGRATION],
        model: 'flora-petal',
        creator: 'HOL',
      },
      properties: { petalId },
      base_account: base.accountId,
    };

    void (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const inscription = await hcs11.createAndInscribeProfile(profile, true, {
          waitForConfirmation: true,
        });
        if (inscription?.profileTopicId) {
          await setState(profileKey, inscription.profileTopicId);
        }
      } catch (error) {
        logger.warn(`[petal ${petalId}] HCS-11 profile inscription skipped`, error);
      }
    })();

    results[petalId] = { accountId: petal.accountId, privateKey: base.privateKey.toStringRaw() };

    if (hederaClient && funding) {
      await ensurePetalFunding({
        hederaClient,
        operatorId: funding.operatorId,
        petalAccountId: petal.accountId,
        minHbarBalance,
        targetHbarBalance,
      }).catch((error: unknown) => {
        logger.warn("Failed to fund petal account", {
          petalId,
          petalAccountId: petal.accountId,
          error,
        });
      });
    }
  }
  return results;
};
