'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaBars, FaTimes, FaSearch } from 'react-icons/fa';
import NavLink from './nav-link';
import NavDropdown from './nav-dropdown';
import Logo from './logo';
import Search from './search';

type NavItem = {
  type: 'link' | 'dropdown';
  label: string;
  to?: string;
  href?: string;
  items?: Array<{ label: string; to?: string; href?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { type: 'link', label: 'Standards', href: 'https://hol.org/docs/standards/' },
  {
    type: 'dropdown',
    label: 'Tools',
    items: [
      { label: 'Standards SDK', href: 'https://hol.org/docs/libraries/standards-sdk' },
      { label: 'Conversational Agent', href: 'https://hol.org/docs/libraries/conversational-agent' },
      { label: 'Standards Agent Kit', href: 'https://hol.org/docs/standards/hcs-10' },
      { label: 'Hashnet MCP', href: 'https://hol.org/mcp' },
      { label: 'Explore All', href: 'https://hol.org/tools' },
    ],
  },
  {
    type: 'dropdown',
    label: 'Events',
    items: [
      { label: 'Patchwork', href: 'https://hol.org/patchwork' },
      { label: 'Africa Hackathon', href: 'https://hol.org/hackathon' },
      { label: 'OpenConvAI Hackathon', href: 'https://hol.org/hedera-ai-agents-hackathon' },
    ],
  },
  { type: 'link', label: 'DAO', href: 'https://hol.org/dao/tasks' },
  {
    type: 'dropdown',
    label: 'Registry',
    items: [
      { label: 'Browse Agents', href: 'https://hol.org/registry/search' },
      { label: 'Register Agent', href: 'https://hol.org/registry/register' },
      { label: 'API Docs', href: 'https://hol.org/registry/docs' },
    ],
  },
  { type: 'link', label: 'Blog', href: 'https://hol.org/blog' },
];

export default function Navbar() {
  const [isDark, setIsDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});

  const toggleItem = useCallback((index: number) => {
    setExpandedItems((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  }, []);

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handleMobileSearch = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (mobileSearchQuery.trim()) {
        window.open(`https://hol.org/search?q=${encodeURIComponent(mobileSearchQuery.trim())}`, '_blank');
      }
    },
    [mobileSearchQuery],
  );

  const applyThemePreference = useCallback((mode: boolean) => {
    if (typeof document === 'undefined') return;
    const targets: Array<HTMLElement | null> = [document.documentElement, document.body];
    targets.forEach((node) => {
      if (!node) return;
      node.classList.toggle('dark', mode);
      node.setAttribute('data-theme', mode ? 'dark' : 'light');
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('darkMode');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
    const nextMode = stored ? stored === 'true' : prefersDark;
    setIsDark(nextMode);
    applyThemePreference(nextMode);
  }, [applyThemePreference]);

  const handleDarkModeToggle = useCallback(() => {
    const newMode = !isDark;
    setIsDark(newMode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('darkMode', String(newMode));
    }
    applyThemePreference(newMode);
  }, [isDark, applyThemePreference]);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-[50]"
      style={{
        background: 'linear-gradient(135deg, rgba(85, 153, 254, 0.95) 0%, rgba(63, 65, 116, 0.95) 100%)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        isolation: 'isolate',
      }}
    >
      <div className="px-6">
        <div className="flex items-center justify-between w-full h-[64px] gap-6 flex-nowrap overflow-visible max-md:gap-3 max-[768px]:gap-2">
        <div className="flex items-center gap-6 flex-shrink-0 h-full max-md:gap-3 max-[768px]:gap-2">
            <button
              type="button"
              onClick={toggleMobileMenu}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-md text-white/90 transition-all duration-200 hover:bg-white/10 focus:outline-none outline-none border-none cursor-pointer bg-transparent"
              aria-label="Toggle mobile menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <FaTimes className="w-5 h-5" /> : <FaBars className="w-5 h-5" />}
            </button>
            <Logo />
            <div className="hidden sm:flex items-center gap-2">
              <div className="h-4 w-px bg-white/30" />
              <span className="text-white/90 font-mono text-sm font-medium">Flora Appnet</span>
            </div>
            <div className="flex items-center gap-3 transition-all duration-300 whitespace-nowrap h-full max-md:hidden">
              {NAV_ITEMS.map((item, index) =>
                item.type === 'dropdown' ? (
                  <NavDropdown key={index} label={item.label} items={item.items || []} />
                ) : (
                  <NavLink key={index} to={item.to} href={item.href} label={item.label} external={Boolean(item.href)} />
                ),
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink min-w-0 h-full ml-auto max-md:gap-2">
            <div className="hidden md:flex items-center h-full">
              <Search />
            </div>
            <button
              type="button"
              onClick={handleDarkModeToggle}
              className="flex items-center justify-center w-9 h-9 rounded-md text-white/90 transition-all duration-200 hover:bg-white/10 focus:outline-none outline-none border-none cursor-pointer bg-transparent"
              aria-label="Toggle dark mode"
            >
              {isDark ? (
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="w-6 h-6">
                  <path
                    fill="currentColor"
                    d="M9.37,5.51C9.19,6.15,9.1,6.82,9.1,7.5c0,4.08,3.32,7.4,7.4,7.4c0.68,0,1.35-0.09,1.99-0.27C17.45,17.19,14.93,19,12,19 c-3.86,0-7-3.14-7-7C5,9.07,6.81,6.55,9.37,5.51z M12,3c-4.97,0-9,4.03-9,9s4.03,9,9,9s9-4.03,9-9c0-0.46-0.04-0.92-0.1-1.36 c-0.98,1.37-2.58,2.26-4.4,2.26c-2.98,0-5.4-2.42-5.4-5.4c0-1.81,0.89-3.42,2.26-4.4C12.92,3.04,12.46,3,12,3L12,3z"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="w-6 h-6">
                  <path
                    fill="currentColor"
                    d="M12,9c1.65,0,3,1.35,3,3s-1.35,3-3,3s-3-1.35-3-3S10.35,9,12,9 M12,7c-2.76,0-5,2.24-5,5s2.24,5,5,5s5-2.24,5-5 S14.76,7,12,7L12,7z M2,13l2,0c0.55,0,1-0.45,1-1s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S1.45,13,2,13z M20,13l2,0c0.55,0,1-0.45,1-1 s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S19.45,13,20,13z M11,2v2c0,0.55,0.45,1,1,1s1-0.45,1-1V2c0-0.55-0.45-1-1-1S11,1.45,11,2z M11,20v2c0,0.55,0.45,1,1,1s1-0.45,1-1v-2c0-0.55-0.45-1-1-1C11.45,19,11,19.45,11,20z M5.99,4.58c-0.39-0.39-1.03-0.39-1.41,0 c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0s0.39-1.03,0-1.41L5.99,4.58z M18.36,16.95 c-0.39-0.39-1.03-0.39-1.41,0c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0c0.39-0.39,0.39-1.03,0-1.41 L18.36,16.95z M19.42,5.99c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06c-0.39,0.39-0.39,1.03,0,1.41 s1.03,0.39,1.41,0L19.42,5.99z M7.05,18.36c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06 c-0.39,0.39-0.39,1.03,0,1.41s1.03,0.39,1.41,0L7.05,18.36z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div
          className="md:hidden border-t border-white/20 bg-white/[0.08] backdrop-blur-lg"
        >
          <div className="px-4 py-3 flex flex-col gap-1">
            <form onSubmit={handleMobileSearch} className="mb-3">
              <div className="relative">
                <input
                  type="text"
                  value={mobileSearchQuery}
                  onChange={(e) => setMobileSearchQuery(e.target.value)}
                  placeholder="Search adapters..."
                  className="w-full h-10 pl-4 pr-10 rounded-md bg-white/10 border border-white/20 text-white/95 placeholder:text-white/50 font-mono text-sm focus:outline-none focus:border-white/40 transition-colors"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                >
                  <FaSearch className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {NAV_ITEMS.map((item, index) => {
              if (item.type === 'dropdown') {
                const isExpanded = expandedItems[index];
                return (
                  <div key={index}>
                    <button
                      onClick={() => toggleItem(index)}
                      className="w-full text-left px-3 py-1 text-white/50 font-mono text-xs font-semibold uppercase tracking-wider flex items-center gap-1 bg-transparent border-none cursor-pointer hover:text-white/70 transition-colors"
                    >
                      {item.label}
                      <svg
                        className={`w-3 h-3 text-white/50 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      {item.items?.map((subItem, subIndex) => {
                        const linkClass =
                          'block px-3 py-2 pl-6 rounded-md text-white/95 font-mono text-[14px] no-underline hover:no-underline transition-all duration-150 hover:bg-white/10 hover:text-white';

                        if (subItem.href) {
                          return (
                            <a
                              key={subIndex}
                              href={subItem.href}
                              className={linkClass}
                              onClick={closeMobileMenu}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {subItem.label}
                            </a>
                          );
                        }

                        return (
                          <a
                            key={subIndex}
                            href={subItem.to || '/'}
                            className={linkClass}
                            onClick={closeMobileMenu}
                          >
                            {subItem.label}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const linkClass =
                'block px-3 py-2 rounded-md text-white/95 font-mono text-[14px] no-underline hover:no-underline transition-all duration-150 hover:bg-white/10 hover:text-white';

              if (item.href) {
                return (
                  <a
                    key={index}
                    href={item.href}
                    className={linkClass}
                    onClick={closeMobileMenu}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.label}
                  </a>
                );
              }

              return (
                <a key={index} href={item.to || '/'} className={linkClass} onClick={closeMobileMenu}>
                  {item.label}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
