import { HCS15Client, HCS11Client, ProfileType } from '@hashgraphonline/standards-sdk';
import { getState, setSecureState, getSecureState, setState } from './persistence.js';

export const provisionPetalAccounts = async (
  petalIds: string[],
  hcs15: HCS15Client,
  network: string
): Promise<Record<string, { accountId: string; privateKey: string }>> => {
  const results: Record<string, { accountId: string; privateKey: string }> = {};
  for (const petalId of petalIds) {
    const accountKey = `petal_account_${petalId}`;
    const privKeyKey = `petal_private_key_${petalId}`;
    const profileKey = `petal_profile_topic_${petalId}`;
    const cachedAccount = await getState(accountKey);
    const cachedPriv = await getSecureState(privKeyKey);
    const cachedProfile = await getState(profileKey);
    if (cachedAccount && cachedPriv) {
      results[petalId] = { accountId: cachedAccount, privateKey: cachedPriv };
      continue;
    }

    const base = await hcs15.createBaseAccount({ accountMemo: `flora-base-${petalId}` });
    const petal = await hcs15.createPetalAccount({
      basePrivateKey: base.privateKey,
      accountMemo: `flora-petal-${petalId}`,
    });

    await setState(accountKey, petal.accountId);
    await setSecureState(privKeyKey, base.privateKey.toStringRaw());

    // Create HCS-11 profile for petal
    const hcs11 = new HCS11Client({
      network,
      auth: { operatorId: petal.accountId, privateKey: base.privateKey.toStringRaw() },
    });

    const profile = {
      version: '1.0',
      type: ProfileType.AI_AGENT,
      display_name: `Flora Petal ${petalId}`,
      aiAgent: {
        type: 'generic',
        capabilities: ['data-consensus'],
        model: 'flora-petal',
        creator: 'HOL',
      },
      properties: { petalId },
    } as any;

    void (async () => {
      try {
        // allow mirror to index the new account before inscription
        await new Promise(resolve => setTimeout(resolve, 3000));
        const inscription = await hcs11.createAndInscribeProfile(profile, true, {
          waitForConfirmation: true,
          waitMaxAttempts: 5,
          waitIntervalMs: 2000,
        });
        if (inscription?.profileTopicId) {
          await setState(profileKey, inscription.profileTopicId);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(`[petal ${petalId}] HCS-11 profile inscription skipped`, error);
      }
    })();

    results[petalId] = { accountId: petal.accountId, privateKey: base.privateKey.toStringRaw() };
  }
  return results;
};
