'use client';

import React from 'react';

export const AnimatedBackground: React.FC = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
      <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-brand-blue/20 to-transparent rounded-full blur-3xl animate-pulse-slow" />
      <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-brand-purple/20 to-transparent rounded-full blur-3xl animate-pulse-slow delay-1000" />
    </div>
  );
};
