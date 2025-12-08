'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLinkProps {
  to?: string;
  href?: string;
  label: string;
  external?: boolean;
}

export default function NavLink({ to, href, label, external }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = to ? pathname?.startsWith(to) : false;

  const className = `
    flex items-center px-3 py-1.5 rounded-sm
    text-white/95 font-mono font-medium text-[15px]
    no-underline hover:no-underline
    transition-all duration-200
    hover:text-white hover:bg-white/10
    ${isActive ? 'text-white bg-white/15' : ''}
  `.trim().replace(/\s+/g, ' ');

  if (href || external) {
    return (
      <a
        href={href || to}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
    );
  }

  return (
    <Link href={to || '/'} className={className}>
      {label}
    </Link>
  );
}
