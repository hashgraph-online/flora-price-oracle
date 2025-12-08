'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaCube, FaHistory, FaProjectDiagram } from 'react-icons/fa';
import { Button } from './button';
import { HeroSection } from './hero-section';
import { Typography, GlassCard, StatusBadge } from './ui';
import { cn } from '../lib/utils';

type PriceEntry = {
  epoch: number;
  stateHash?: string;
  price: number;
  timestamp: string;
  participants: string[];
  sources: { source: string; price: number }[];
  hcsMessage?: string;
  consensusTimestamp?: string;
  sequenceNumber?: number;
};

type HistoryResponse = { items: PriceEntry[] };

type AdapterPetal = {
  petalId: string;
  epoch: number;
  timestamp: string;
  adapters: string[];
  fingerprints: Record<string, string>;
};

type AdapterResponse = {
  petals: AdapterPetal[];
  aggregate: {
    adapters: string[];
    fingerprints: Record<string, string>;
    registry: {
      discoveryTopicId: string;
      categoryTopicId: string;
      adapterTopics: Record<
        string,
        {
          versionTopicId: string;
          declarationTopicId: string;
          manifestPointer?: string;
        }
      >;
    };
  };
  topics: {
    state: string;
    coordination: string;
    transaction: string;
    registryCategory: string;
    registryDiscovery: string;
  };
  metadata: {
    registryPointer: string;
    network: string;
  };
};

const formatUsd = (value?: number) => (Number.isFinite(value ?? NaN) ? `$${Number(value).toFixed(8)}` : '—');

const formatTime = (value?: string) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const parseHcsPointer = (pointer?: string) => {
  if (!pointer) return null;
  const parts = pointer.replace('hcs://', '').split('/');
  if (parts.length < 2) return null;
  const [, topic, ts] = parts;
  return { topic, ts };
};

const topicLink = (pointer?: string, consensusTs?: string, sequence?: number, network = 'testnet') => {
  const parsed = parseHcsPointer(pointer);
  if (!parsed) return null;
  if (consensusTs) {
    return `https://hashscan.io/${network}/transaction/${consensusTs}/message`;
  }
  if (sequence !== undefined) {
    return `https://hashscan.io/${network}/topic/${parsed.topic}/${sequence}`;
  }
  return `https://${network}.mirrornode.hedera.com/api/v1/topics/${parsed.topic}/messages`;
};

const packageLink = (id: string): string | null => {
  const match = /^npm\/(.+?)(?:@([\w.-]+))?$/i.exec(id.trim());
  if (!match) return null;
  const [, pkg, version] = match;
  const pkgPath = pkg; // npm supports scoped names with slash intact
  if (version) {
    return `https://www.npmjs.com/package/${pkgPath}/v/${encodeURIComponent(version)}`;
  }
  return `https://www.npmjs.com/package/${pkgPath}`;
};

const HBarChip = ({ text }: { text: string }) => {
  const href = packageLink(text);
  const content = (
    <span className='px-3 py-1.5 rounded-full text-xs font-medium bg-brand-blue/5 text-brand-blue border border-brand-blue/20 hover:bg-brand-blue/10 transition-colors'>
      {text}
    </span>
  );
  return href ? (
    <a href={href} target='_blank' rel='noreferrer'>
      {content}
    </a>
  ) : (
    content
  );
};

export default function Dashboard({ apiBase }: { apiBase: string }) {
  const [latest, setLatest] = useState<PriceEntry | null>(null);
  const [history, setHistory] = useState<PriceEntry[]>([]);
  const [adapters, setAdapters] = useState<AdapterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = useMemo(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(apiBase.replace(/\/$/, ''));
      const port = url.port || '3000';
      return `${window.location.protocol}//${window.location.hostname}:${port}`;
    }
    return apiBase.replace(/\/$/, '');
  }, [apiBase]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [latestRes, histRes, adaptersRes] = await Promise.all([
          fetch(`${baseUrl}/price/latest`),
          fetch(`${baseUrl}/price/history?limit=15`),
          fetch(`${baseUrl}/adapters`),
        ]);
        if (!latestRes.ok || !histRes.ok || !adaptersRes.ok) {
          throw new Error('Failed to fetch Flora data');
        }
        const latestJson = (await latestRes.json()) as PriceEntry;
        const histJson = (await histRes.json()) as HistoryResponse;
        const adaptersJson = (await adaptersRes.json()) as AdapterResponse;
        if (!mounted) return;
        setLatest(latestJson);
        setHistory(histJson.items ?? []);
        setAdapters(adaptersJson);
        setError(null);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load data');
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [baseUrl]);

  const hcsUrl = topicLink(latest?.hcsMessage, latest?.consensusTimestamp, latest?.sequenceNumber);

  const metrics = {
    petals: adapters?.petals.length ?? 0,
    adapters: adapters?.aggregate.adapters.length ?? 0,
  };

  const registryLinks = useMemo(() => {
    if (!adapters) return null;
    const { topics, metadata } = adapters;
    const net = metadata?.network ?? 'testnet';
    const linkForTopic = (topicId?: string, seq?: number) =>
      topicId ? `https://hashscan.io/${net}/topic/${topicId}${seq ? `/${seq}` : ''}` : null;
    const metadataPointer = metadata?.registryPointer;
    const metadataLink = metadataPointer?.startsWith('hcs://1/')
      ? `https://hashscan.io/${net}/topic/${metadataPointer.replace('hcs://1/', '')}`
      : metadataPointer?.startsWith('http')
      ? metadataPointer
      : null;
    const adapterTopicEntries =
      adapters.aggregate.registry?.adapterTopics
        ? Object.entries(adapters.aggregate.registry.adapterTopics).map(([id, info]) => ({
            adapterId: id,
            versionTopic: info.versionTopicId,
            declarationTopic: info.declarationTopicId,
            manifestPointer: info.manifestPointer,
          }))
        : [];
    return {
      network: net,
      metadataLink,
      entries: [
        {
          label: 'Discovery (HCS-2 type=1)',
          value: topics.registryDiscovery,
          href: linkForTopic(topics.registryDiscovery),
          subtitle: 'Registry-of-registries pointer',
        },
        {
          label: 'Category (HCS-21 type=2)',
          value: topics.registryCategory,
          href: linkForTopic(topics.registryCategory),
          subtitle: 'Adapter category index',
        },
        {
          label: 'State topic',
          value: topics.state,
          href: linkForTopic(topics.state),
          subtitle: 'HCS-17 price proofs',
        },
        {
          label: 'Coordination topic',
          value: topics.coordination,
          href: linkForTopic(topics.coordination),
          subtitle: 'HCS-16 membership/config channel',
        },
        {
          label: 'Transaction topic',
          value: topics.transaction,
          href: linkForTopic(topics.transaction),
          subtitle: 'HCS-16 adapter lifecycle feed',
        },
      ].filter((entry) => Boolean(entry.value)),
      adapterTopicEntries,
    };
  }, [adapters]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      <HeroSection metrics={metrics} />

      <div className='max-w-7xl mx-auto px-6 pb-20 space-y-12 -mt-10 relative z-20'>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl shadow-sm animate-slide-down">
            <Typography variant="body2" className="font-semibold">{error}</Typography>
          </div>
        )}

        {/* Key Metrics Grid */}
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-brand-green/10 rounded-lg text-brand-green">
                <FaCube />
              </div>
              <Typography variant="h4" className="text-lg">Latest Price</Typography>
            </div>
            
            <div className='flex items-end justify-between'>
              <div>
                <Typography variant="h2" className="text-4xl mb-1">{formatUsd(latest?.price)}</Typography>
                <Typography variant="body2" color="muted">HBAR / USD</Typography>
              </div>
              <div className='text-right'>
                <Typography variant="caption" color="muted" className="block mb-1">Epoch</Typography>
                <Typography variant="h3" className="text-xl">{latest?.epoch ?? '—'}</Typography>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-brand-purple/10 rounded-lg text-brand-purple">
                <FaHistory />
              </div>
              <Typography variant="h4" className="text-lg">Consensus</Typography>
            </div>
            
            <div className="space-y-4">
              <div>
                <Typography variant="caption" color="muted" className="block mb-1">Timestamp</Typography>
                <Typography variant="body1" className="font-mono">{formatTime(latest?.timestamp)}</Typography>
              </div>
              <div>
                <Typography variant="caption" color="muted" className="block mb-1">Participants</Typography>
                <div className="flex items-center gap-2">
                  <Typography variant="h3" className="text-xl">{latest?.participants?.length ?? 0}</Typography>
                  <Typography variant="body2" color="muted">active petals</Typography>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-brand-blue/10 rounded-lg text-brand-blue">
                <FaProjectDiagram />
              </div>
              <Typography variant="h4" className="text-lg">Verifiability</Typography>
            </div>
            
            <div className='space-y-4'>
              <div>
                <Typography variant="caption" color="muted" className="block mb-1">State Hash</Typography>
                <Typography variant="body2" className="font-mono text-xs break-all bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-100 dark:border-gray-700">
                  {latest?.stateHash ?? 'Awaiting state hash...'}
                </Typography>
              </div>
              
              {hcsUrl ? (
                <Button 
                  onClick={() => window.open(hcsUrl, '_blank')}
                  className="w-full bg-brand-blue/10 hover:bg-brand-blue/20 text-brand-blue border border-brand-blue/20"
                >
                  View HCS‑17 Message
                </Button>
              ) : (
                <div className="w-full py-2 text-center text-sm text-gray-400 border border-gray-100 rounded bg-gray-50">
                  HCS pointer pending
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-8'>
          {/* History Table */}
          <GlassCard className='lg:col-span-2 p-0 overflow-hidden'>
            <div className="p-6 border-b border-gray-100 dark:border-gray-800">
              <Typography variant="h3">Recent Consensus</Typography>
              <Typography variant="body2" color="muted">Latest price updates and consensus events</Typography>
            </div>
            
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='text-left bg-gray-50/50 dark:bg-gray-800/50'>
                    <th className='py-3 px-6 font-medium text-gray-500 uppercase tracking-wider text-xs'>Epoch</th>
                    <th className='py-3 px-6 font-medium text-gray-500 uppercase tracking-wider text-xs'>Price</th>
                    <th className='py-3 px-6 font-medium text-gray-500 uppercase tracking-wider text-xs'>Participants</th>
                    <th className='py-3 px-6 font-medium text-gray-500 uppercase tracking-wider text-xs'>HCS-17</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
                  {history.map((item) => {
                    const link = topicLink(item.hcsMessage, item.consensusTimestamp, item.sequenceNumber);
                    return (
                      <tr key={item.epoch} className='group hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors'>
                        <td className='py-4 px-6 font-semibold text-brand-dark dark:text-white'>{item.epoch}</td>
                        <td className='py-4 px-6 font-mono text-gray-700 dark:text-gray-300'>{formatUsd(item.price)}</td>
                        <td className='py-4 px-6 text-gray-600 dark:text-gray-400'>{item.participants.length}</td>
                        <td className='py-4 px-6'>
                          {link ? (
                            <a 
                              className='inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/20 transition-colors' 
                              href={link} 
                              target='_blank' 
                              rel='noreferrer'
                            >
                              View tx
                            </a>
                          ) : (
                            <span className='text-xs text-gray-400 italic'>pending</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {history.length === 0 && (
                    <tr>
                      <td className='py-8 text-center text-gray-500' colSpan={4}>
                        Waiting for first consensus...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>

          {/* Petals List */}
          <div className='space-y-8'>
            <GlassCard className="p-6 h-fit">
              <div className="mb-6">
                <Typography variant="h3">Petals & Adapters</Typography>
                <Typography variant="body2" color="muted">Active network participants</Typography>
              </div>
              
              <div className='space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar'>
                {adapters?.petals.map((petal) => (
                  <div key={petal.petalId} className='group bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 hover:border-brand-blue/30 hover:shadow-md transition-all'>
                    <div className='flex items-center justify-between mb-2'>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                        <span className='font-bold text-sm text-brand-dark dark:text-white'>{petal.petalId}</span>
                      </div>
                      <span className='text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded'>
                        epoch {petal.epoch}
                      </span>
                    </div>
                    
                    <div className='text-xs text-gray-500 mb-3 flex items-center gap-1'>
                      <span className="opacity-50">Last seen:</span>
                      {formatTime(petal.timestamp)}
                    </div>
                    
                    <div className='flex flex-wrap gap-2'>
                      {petal.adapters.map((id) => (
                        <HBarChip key={id} text={id} />
                      ))}
                    </div>
                  </div>
                ))}
                {!adapters && (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin mx-auto mb-2"></div>
                    <Typography variant="body2" color="muted">Loading petals...</Typography>
                  </div>
                )}
              </div>
            </GlassCard>

            {registryLinks && (
              <GlassCard className='p-6 space-y-4'>
                <div>
                  <Typography variant='h3'>Adapter Registry Topics</Typography>
                  <Typography variant='body2' color='muted'>Live onboarding metadata via HCS-2 / HCS-21</Typography>
                </div>
                <div className='space-y-4'>
                  {registryLinks.entries.map(({ label, value, href, subtitle }) => (
                    <div key={label} className='flex flex-col gap-1 border-b border-gray-100 dark:border-gray-800 pb-3 last:border-b-0 last:pb-0'>
                      <div className='flex items-center justify-between gap-2'>
                        <Typography variant='caption' color='muted'>{label}</Typography>
                        {subtitle && <span className='text-[10px] uppercase tracking-wide text-gray-600 dark:text-gray-300'>{subtitle}</span>}
                      </div>
                      {href ? (
                        <a className='font-mono text-xs text-brand-blue hover:underline break-all' href={href} target='_blank' rel='noreferrer'>
                          {value}
                        </a>
                      ) : (
                        <Typography variant='body2' className='font-mono text-xs text-gray-600 dark:text-gray-400'>{value}</Typography>
                      )}
                    </div>
                  ))}
                  {registryLinks.metadataLink && (
                    <div className='flex flex-col gap-1'>
                      <Typography variant='caption' color='muted'>Registry metadata (HCS-1)</Typography>
                      <a className='font-mono text-xs text-brand-blue hover:underline break-all' href={registryLinks.metadataLink} target='_blank' rel='noreferrer'>
                        {registryLinks.metadataLink}
                      </a>
                    </div>
                  )}
                  {registryLinks.adapterTopicEntries?.length ? (
                    <div className='space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800'>
                      <Typography variant='caption' color='muted'>Per-adapter topics</Typography>
                      <div className='space-y-2'>
                        {registryLinks.adapterTopicEntries.map((entry) => (
                          <div key={entry.adapterId} className='rounded-lg border border-gray-100 dark:border-gray-800 p-2 space-y-1'>
                            <Typography variant='body2' className='font-semibold text-brand-dark'>{entry.adapterId}</Typography>
                            <div className='flex flex-col gap-1 text-xs text-gray-700 dark:text-gray-300'>
                              <span>
                                Version pointer:{' '}
                                {entry.versionTopic ? (
                                  <a className='text-brand-blue hover:underline break-all' href={`https://hashscan.io/${registryLinks.network}/topic/${entry.versionTopic}`} target='_blank' rel='noreferrer'>
                                    {entry.versionTopic}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </span>
                              <span>
                                Declaration topic:{' '}
                                {entry.declarationTopic ? (
                                  <a className='text-brand-blue hover:underline break-all' href={`https://hashscan.io/${registryLinks.network}/topic/${entry.declarationTopic}`} target='_blank' rel='noreferrer'>
                                    {entry.declarationTopic}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </span>
                              {entry.manifestPointer && (
                                <span>
                                  Manifest:{' '}
                                  <a className='text-brand-blue hover:underline break-all' href={`https://hashscan.io/${registryLinks.network}/topic/${entry.manifestPointer.replace('hcs://1/', '')}`} target='_blank' rel='noreferrer'>
                                    {entry.manifestPointer}
                                  </a>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </GlassCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
