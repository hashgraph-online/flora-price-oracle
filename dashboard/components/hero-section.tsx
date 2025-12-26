'use client';

import React from 'react';
import { FaNetworkWired, FaServer, FaLayerGroup } from 'react-icons/fa';
import { Typography, GlassCard, StatusBadge, AnimatedBackground } from './ui';
import { Button } from './button';
import { cn } from '../lib/utils';

type HeroMetrics = {
  petals: number;
  adapters: number;
};

type HeroSectionProps = {
  metrics: HeroMetrics;
  networkLabel?: string;
};

const formatNetworkLabel = (value?: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) return 'Testnet';
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
};

export const HeroSection: React.FC<HeroSectionProps> = ({ metrics, networkLabel }) => {
  const network = formatNetworkLabel(networkLabel);
  return (
    <section className="relative min-h-[500px] flex items-center justify-center overflow-hidden py-20">
      <AnimatedBackground />

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center [animation:fade-in-left_0.8s_ease-out]">
          <div className="space-y-6">
            <div className="space-y-2">
              <Typography variant="caption" color="brand" className="tracking-[0.2em]">
                Flora Appnet Demo
              </Typography>
              <Typography variant="h1">
                Flora{' '}
                <Typography as="span" variant="h1" gradient>
                  Price Oracle
                </Typography>
              </Typography>
            </div>

            <Typography variant="body1" color="muted" className="max-w-xl text-lg">
              Watch petals publish HBAR/USD consensus proofs (HCS-17) sourced from HCS-21 adapters and HCS-1 manifests—everything the Flora stack needs to stay auditable.
            </Typography>

            <div className="flex flex-wrap gap-4 pt-4">
              <Button
                onClick={() => window.scrollTo({ top: 600, behavior: 'smooth' })}
                className="bg-brand-blue hover:bg-brand-blue/90 text-white px-8 py-6 text-lg font-medium shadow-lg shadow-brand-blue/20 transition-all hover:scale-105"
              >
                View Live Data
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open('https://github.com/hashgraph-online/flora-price-oracle', '_blank')}
                className="px-8 py-6 text-lg font-medium"
              >
                Documentation
              </Button>
            </div>
          </div>

          <div className="relative [animation:fade-in-up_0.8s_ease-out]">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-blue/10 via-brand-purple/10 to-brand-green/10 rounded-full blur-3xl animate-pulse-slow" />
            
            <GlassCard className="p-6 relative">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-purple to-brand-blue flex items-center justify-center text-white shadow-lg shadow-brand-purple/20">
                    <FaNetworkWired className="text-xl" />
                  </div>
                  <div>
                    <Typography variant="h4">System Status</Typography>
                    <Typography variant="caption" color="muted">Flora {network}</Typography>
                  </div>
                </div>
                <StatusBadge status="OPERATIONAL" variant="success" pulse />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: FaServer, label: 'Active Petals', value: metrics.petals, color: 'text-brand-blue' },
                  { icon: FaLayerGroup, label: 'Adapters', value: metrics.adapters, color: 'text-brand-purple' },
                ].map((stat, i) => (
                  <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <stat.icon className={cn("w-4 h-4", stat.color)} />
                      <span className="text-xs font-medium text-gray-500">{stat.label}</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </section>
  );
};
