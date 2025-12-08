'use client';

import React, { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  gradient?: boolean;
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className,
  gradient = false,
  hoverEffect = true,
  ...props
}) => {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/20 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl shadow-lg transition-all duration-300',
        gradient && 'bg-gradient-to-br from-white/80 to-white/40 dark:from-gray-800/80 dark:to-gray-900/40',
        hoverEffect && 'hover:shadow-xl hover:border-brand-blue/30',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
