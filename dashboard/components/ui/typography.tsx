'use client';

'use client';

import React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'h1' | 'h2' | 'h3' | 'h4' | 'body1' | 'body2' | 'caption';
type Color = 'default' | 'muted' | 'brand' | 'white' | 'gray';

interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  variant?: Variant;
  color?: Color;
  gradient?: boolean;
  as?: React.ElementType;
  children: React.ReactNode;
}

export const Typography: React.FC<TypographyProps> = ({
  variant = 'body1',
  color = 'default',
  gradient = false,
  as,
  className,
  children,
  ...props
}) => {
  const tag = as || (variant.startsWith('h') ? variant : 'p');
  const Component = tag as React.ElementType;

  const variants = {
    h1: 'text-4xl lg:text-5xl font-mono font-black leading-tight tracking-tight',
    h2: 'text-3xl lg:text-4xl font-mono font-bold leading-tight tracking-tight',
    h3: 'text-2xl font-mono font-bold leading-snug',
    h4: 'text-xl font-mono font-bold leading-snug',
    body1: 'text-base leading-relaxed',
    body2: 'text-sm leading-relaxed',
    caption: 'text-xs uppercase tracking-wider font-medium',
  };

  const colors = {
    default: 'text-brand-dark dark:text-white',
    muted: 'text-gray-600 dark:text-gray-400',
    brand: 'text-brand-blue',
    white: 'text-white',
    gray: 'text-gray-500',
  };

  const gradientClass = gradient
    ? 'bg-gradient-to-r from-brand-blue via-brand-purple to-brand-green bg-clip-text text-transparent'
    : '';

  return (
    <Component
      className={cn(
        variants[variant],
        !gradient && colors[color],
        gradientClass,
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
};
