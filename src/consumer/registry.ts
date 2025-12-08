import { createHash } from 'crypto';
import fetch from 'node-fetch';
import { HCS21Client } from '@hashgraphonline/standards-sdk';
import { getState, setState } from './persistence.js';

type AdapterManifestSpec = {
  keyPrefix: string;
  name: string;
  packageName: string;
  preferredVersion?: string;
};

const adapterManifests: AdapterManifestSpec[] = [
  {
    keyPrefix: 'adapter_manifest_pointer_binance',
    name: 'Binance Price Adapter',
    packageName: '@hol-org/adapter-binance',
  },
  {
    keyPrefix: 'adapter_manifest_pointer_coingecko',
    name: 'Coingecko Price Adapter',
    packageName: '@hol-org/adapter-coingecko',
  },
  {
    keyPrefix: 'adapter_manifest_pointer_hedera_rate',
    name: 'Hedera Rate Adapter',
    packageName: '@hol-org/adapter-hedera-rate',
  },
];

export type ResolvedAdapterManifest = {
  adapterId: string;
  name: string;
  packageName: string;
  version: string;
  integrity: string;
  manifestPointer: string;
};

const buildManifest = (params: {
  adapterId: string;
  name: string;
  packageName: string;
  integrity: string;
  version: string;
}): Record<string, unknown> => ({
  meta: {
    spec_version: '1.0',
    adapter_version: params.version,
    generated: new Date().toISOString(),
  },
  adapter: {
    name: params.name,
    id: params.adapterId,
    maintainers: [{ name: 'HOL', contact: 'ops@hashgraph.online' }],
    license: 'Apache-2.0',
  },
  package: {
    registry: 'npm',
    artifacts: [
      {
        url:
          `https://registry.npmjs.org/${encodeURIComponent(
            params.packageName
          )}/-/` +
          `${params.packageName.split('/').pop() ?? params.packageName}-${
            params.version
          }.tgz`,
        digest: params.integrity,
      },
    ],
  },
  runtime: {
    platforms: ['node>=20'],
    primary: 'node',
    entry: 'dist/index.js',
    dependencies: ['@hashgraphonline/standards-sdk@^0.1.141-canary.38'],
  },
  capabilities: {
    discovery: true,
    communication: false,
    protocols: ['price-feed'],
  },
  consensus: {
    state_model: 'hcs-21.generic@1',
    required_fields: ['entity_id', 'price', 'source', 'timestamp'],
    hashing: 'sha384',
  },
});

const fetchPackageIntegrity = async (
  packageName: string,
  preferredVersion?: string
): Promise<{ version: string; integrity: string }> => {
  const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(
    packageName
  )}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch npm metadata for ${packageName}`);
  }
  const meta = (await metaRes.json()) as {
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, { dist?: { tarball?: string } }>;
  };
  const version =
    preferredVersion && meta.versions?.[preferredVersion]
      ? preferredVersion
      : meta['dist-tags']?.latest;
  if (!version || !meta.versions?.[version]?.dist?.tarball) {
    throw new Error(
      `Missing tarball for ${packageName} (${version ?? 'unknown'})`
    );
  }
  const tarballUrl = meta.versions[version].dist?.tarball as string;
  const res = await fetch(tarballUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download tarball for ${packageName}@${version}`);
  }
  const hash = createHash('sha384');
  for await (const chunk of res.body as any) {
    hash.update(chunk);
  }
  return { version, integrity: hash.digest('hex') };
};

const TTL_REGISTRY = Number(process.env.ADAPTER_REGISTRY_TTL ?? '604800');
const TTL_VERSION = Number(process.env.ADAPTER_REGISTRY_VERSION_TTL ?? '604800');
const TTL_DISCOVERY = Number(process.env.ADAPTER_REGISTRY_DISCOVERY_TTL ?? '1209600');
const CATEGORY_MEMO = process.env.ADAPTER_REGISTRY_MEMO ?? 'adapter-registry:price-feeds';
const METADATA_STATE_KEY = 'adapter_registry_metadata_pointer';

type RegistryGraph = {
  categoryTopicId: string;
  discoveryTopicId: string;
  metadataPointer: string;
  adapterTopics: Record<
    string,
    { versionTopicId: string; declarationTopicId: string; manifestPointer: string }
  >;
};

const normalizeValue = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildRegistryMetadata = (operatorAccount: string) => ({
  version: '1.0.0',
  name: 'Flora Price Adapter Registry',
  description:
    'Reference adapter registry for Flora price-consensus networks (HBAR/USD).',
  operator: {
    account: operatorAccount,
    name: 'Hashgraph Online',
    contact: 'ops@hol.org',
  },
  entityTypes: ['price-feed'],
  categories: ['oracle'],
  tags: ['flora', 'adapter', 'price'],
  links: {
    docs: 'https://hol.org/standards/hcs-21',
    source: 'https://github.com/hashgraph-online/flora-price-oracle',
    website: 'https://hol.org',
  },
});

const ensureRegistryMetadataPointer = async (
  client: HCS21Client,
  operatorAccount: string,
): Promise<string> => {
  const envPointer = normalizeValue(process.env.ADAPTER_REGISTRY_METADATA_POINTER);
  if (envPointer) {
    await setState(METADATA_STATE_KEY, envPointer);
    return envPointer;
  }
  const cached = await getState(METADATA_STATE_KEY);
  if (cached) {
    return cached;
  }
  const metadataRecord = buildRegistryMetadata(operatorAccount);
  const inscription = await client.inscribeMetadata({
    document: metadataRecord,
    fileName: 'flora-registry-metadata.json',
    inscriptionOptions: {
      waitForConfirmation: true,
      waitMaxAttempts: 10,
      waitIntervalMs: 2000,
    },
  });
  await setState(METADATA_STATE_KEY, inscription.pointer);
  return inscription.pointer;
};

const ensureTopicId = async (
  stateKey: string,
  envValue: string | undefined,
  factory: () => Promise<string>,
): Promise<string> => {
  const fromEnv = normalizeValue(envValue);
  if (fromEnv) {
    await setState(stateKey, fromEnv);
    return fromEnv;
  }
  const cached = await getState(stateKey);
  if (cached) {
    return cached;
  }
  const created = await factory();
  await setState(stateKey, created);
  return created;
};

export const ensureRegistryGraph = async (
  client: HCS21Client,
  operatorAccount: string,
  manifests: ResolvedAdapterManifest[],
): Promise<RegistryGraph> => {
  const metadataPointer = await ensureRegistryMetadataPointer(
    client,
    operatorAccount,
  );

  const discoveryTopicId = await ensureTopicId(
    'adapter_registry_discovery_topic_id',
    process.env.ADAPTER_REGISTRY_DISCOVERY_TOPIC_ID,
    () =>
      client.createRegistryDiscoveryTopic({
        ttl: TTL_DISCOVERY,
        memoOverride: `hcs-21:0:${TTL_DISCOVERY}:1`,
      }),
  );

  const categoryTopicId = await ensureTopicId(
    'adapter_registry_category_topic_id',
    process.env.ADAPTER_CATEGORY_TOPIC_ID,
    () =>
      client.createAdapterCategoryTopic({
        ttl: TTL_REGISTRY,
        indexed: 0,
        metaTopicId: metadataPointer,
        transactionMemo: 'adapter-category',
      }),
  );

  await client.registerCategoryTopic({
    discoveryTopicId,
    categoryTopicId,
    metadata: metadataPointer,
    memo: CATEGORY_MEMO,
    transactionMemo: 'adapter-registry:category',
  });

  const adapterTopics: RegistryGraph['adapterTopics'] = {};

  for (const manifest of manifests) {
    const safeKey = manifest.adapterId.replace(/[^a-zA-Z0-9]+/g, '_');
    const versionTopicId = await ensureTopicId(
      `adapter_version_topic_id_${safeKey}`,
      process.env[`ADAPTER_VERSION_TOPIC_ID_${safeKey.toUpperCase()}`],
      () =>
        client.createAdapterVersionPointerTopic({
          ttl: TTL_VERSION,
          memoOverride: `hcs-2:1:${TTL_VERSION}`,
          transactionMemo: `adapter-version:${manifest.adapterId}`,
        }),
    );

    const declarationTopicId = await ensureTopicId(
      `adapter_declaration_topic_id_${safeKey}`,
      process.env[`ADAPTER_DECLARATION_TOPIC_ID_${safeKey.toUpperCase()}`],
      () =>
        client.createRegistryTopic({
          ttl: TTL_REGISTRY,
          indexed: 0,
          type: 0,
          metaTopicId: manifest.manifestPointer,
        }),
    );

    await client.publishCategoryEntry({
      categoryTopicId,
      adapterId: manifest.adapterId,
      versionTopicId,
      memo: `adapter:${manifest.adapterId}`,
      transactionMemo: `adapter-category-entry:${manifest.adapterId}`,
    });

    await client.publishVersionPointer({
      versionTopicId,
      declarationTopicId,
      memo: `adapter:${manifest.adapterId}`,
      transactionMemo: `adapter-version-pointer:${manifest.adapterId}`,
    });

    adapterTopics[manifest.adapterId] = {
      versionTopicId,
      declarationTopicId,
      manifestPointer: manifest.manifestPointer,
    };
  }

  return {
    categoryTopicId,
    discoveryTopicId,
    metadataPointer,
    adapterTopics,
  };
};

export const resolveManifestPointers = async (
  client: HCS21Client
): Promise<ResolvedAdapterManifest[]> => {
  const resolved: ResolvedAdapterManifest[] = [];

  const inscribeWithRetry = async (manifest: {
    adapterId: string;
    name: string;
    packageName: string;
    integrity: string;
    version: string;
    keyPrefix: string;
  }) => {
    const attemptInscription = async () => {
      return await client.inscribeMetadata({
        document: buildManifest(manifest),
        fileName: `${manifest.packageName}-manifest.json`,
        inscriptionOptions: {
          waitForConfirmation: true,
          waitMaxAttempts: 10,
          waitIntervalMs: 2000,
          connectionMode: 'auto',
          websocket: true,
        },
      });
    };

    let lastError: unknown;
    for (let i = 0; i < 3; i += 1) {
      try {
        return await attemptInscription();
      } catch (error) {
        lastError = error;
        // eslint-disable-next-line no-console
        console.warn(`[manifest] inscription attempt ${i + 1} failed`, error);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw lastError ?? new Error('Failed to inscribe manifest after retries');
  };

  for (const spec of adapterManifests) {
    const { version, integrity } = await fetchPackageIntegrity(
      spec.packageName,
      spec.preferredVersion
    );
    const adapterId = `npm/${spec.packageName}@${version}`;
    const stateKey = `${spec.keyPrefix}_${version}`;
    const cached = await getState(stateKey);
    if (cached) {
      resolved.push({
        adapterId,
        name: spec.name,
        packageName: spec.packageName,
        version,
        integrity,
        manifestPointer: cached,
      });
      continue;
    }
    const inscription = await inscribeWithRetry({
      adapterId,
      name: spec.name,
      packageName: spec.packageName,
      integrity,
      version,
      keyPrefix: spec.keyPrefix,
    });
    await setState(stateKey, inscription.pointer);
    resolved.push({
      adapterId,
      name: spec.name,
      packageName: spec.packageName,
      version,
      integrity,
      manifestPointer: inscription.pointer,
    });
  }
  return resolved;
};

export const publishDeclarations = async (
  client: HCS21Client,
  graph: RegistryGraph,
  manifestPointers: ResolvedAdapterManifest[],
  params: { floraAccount: string; threshold: string; stateTopic: string; coordinationTopic: string; transactionTopic: string }
) => {
  const { floraAccount, threshold, stateTopic, coordinationTopic, transactionTopic } = params;
  if (!floraAccount || !stateTopic || !coordinationTopic || !transactionTopic) {
    throw new Error('HEDERA_ACCOUNT_ID and topic IDs are required to publish adapter declarations');
  }

  for (const manifest of manifestPointers) {
    const topics = graph.adapterTopics[manifest.adapterId];
    if (!topics) {
      // eslint-disable-next-line no-console
      console.warn(`[registry] missing topics for ${manifest.adapterId}, skipping declaration`);
      continue;
    }
    const declaration = {
      p: 'hcs-21',
      op: 'register' as const,
      adapter_id: manifest.adapterId,
      entity: 'HBAR-USD',
      package: {
        registry: 'npm',
        name: manifest.packageName,
        version: manifest.version,
        integrity: manifest.integrity,
      },
      manifest: manifest.manifestPointer,
      config: {
        type: 'flora',
        account: floraAccount,
        threshold,
        ctopic: coordinationTopic,
        ttopic: transactionTopic,
        stopic: stateTopic,
      },
      state_model: 'hcs17:sha384',
    };

    await client.publishDeclaration({
      topicId: topics.declarationTopicId,
      declaration,
    });
  }
};
