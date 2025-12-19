'use client';

import type { ReactNode } from 'react';
import { Typography } from './ui';

export type FloraMember = {
  label: string;
  accountId?: string;
  keyType?: string;
  publicKey?: string;
};

const monospace = (value?: string): ReactNode => {
  if (!value) return '—';
  return (
    <span className="font-mono text-xs break-all text-gray-700 dark:text-gray-200">
      {value}
    </span>
  );
};

export const FloraMembers = ({ members }: { members: FloraMember[] }) => {
  const visible = members.filter((member) => member.accountId);
  if (visible.length === 0) {
    return (
      <div className="text-center py-6">
        <Typography variant="body2" color="muted">
          Awaiting member accounts...
        </Typography>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((member) => (
        <div
          key={member.label}
          className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white/60 dark:bg-gray-900/40 p-4 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <Typography variant="body1" className="font-semibold text-brand-dark dark:text-white">
              {member.label}
            </Typography>
            {member.accountId ? (
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                {member.accountId}
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <Typography variant="caption" color="muted">
                Key type
              </Typography>
              <span className="text-xs text-gray-700 dark:text-gray-200">
                {member.keyType ?? '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <Typography variant="caption" color="muted">
                Public key
              </Typography>
              <div className="max-w-[70%] text-right">{monospace(member.publicKey)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

