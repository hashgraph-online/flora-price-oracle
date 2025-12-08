'use client';

'use client';

import React from 'react';
import { cn } from '../../lib/utils';

type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  className?: string;
  pulse?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  variant = 'neutral',
  className,
  pulse = false,
}) => {
  const variants = {
    success: 'bg-brand-green/10 text-brand-green border-brand-green/20',
    warning: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    error: 'bg-red-500/10 text-red-600 border-red-500/20',
    info: 'bg-brand-blue/10 text-brand-blue border-brand-blue/20',
    neutral: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono font-medium uppercase tracking-wide',
        variants[variant],
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", 
            variant === 'success' ? 'bg-brand-green' : 
            variant === 'warning' ? 'bg-yellow-500' : 
            variant === 'error' ? 'bg-red-500' : 
            variant === 'info' ? 'bg-brand-blue' : 'bg-gray-500'
          )}></span>
          <span className={cn("relative inline-flex rounded-full h-2 w-2",
            variant === 'success' ? 'bg-brand-green' : 
            variant === 'warning' ? 'bg-yellow-500' : 
            variant === 'error' ? 'bg-red-500' : 
            variant === 'info' ? 'bg-brand-blue' : 'bg-gray-500'
          )}></span>
        </span>
      )}
      {status}
    </div>
  );
};
