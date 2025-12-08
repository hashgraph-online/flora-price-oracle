import { ReactNode } from 'react';
import { cn } from '../lib/utils';

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('card', className)}>{children}</div>
);

export const CardHeader = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('px-4 py-3 border-b border-gray-200/60', className)}>{children}</div>
);

export const CardTitle = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('text-base font-semibold text-brand-dark', className)}>{children}</div>
);

export const CardContent = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('px-4 py-3 space-y-2', className)}>{children}</div>
);
