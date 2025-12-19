'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';

interface DropdownItem {
  label: string;
  to?: Route;
  href?: string;
  className?: string;
}

interface NavDropdownProps {
  label: string;
  items: DropdownItem[];
}

export default function NavDropdown({ label, items }: NavDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const isActive = items.some((item) => item.to && pathname?.startsWith(item.to));

  const handleMouseEnter = () => setIsOpen(true);
  const handleMouseLeave = () => setIsOpen(false);

  const toggleOpen = () => setIsOpen((prev) => !prev);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div
      ref={dropdownRef}
      className="relative flex items-center h-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className={`
          flex items-center px-3 py-1.5 gap-1 rounded-sm
          text-white/95 font-mono font-medium text-[15px]
          bg-transparent border-none cursor-pointer
          no-underline hover:no-underline
          transition-all duration-200
          hover:text-white hover:bg-white/10
          focus:outline-none outline-none
          ${isActive ? 'text-white bg-white/15' : ''}
        `.trim().replace(/\s+/g, ' ')}
      >
        {label}
        <svg
          className={`w-4 h-4 text-white transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
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

      {isOpen && (
        <div className="absolute top-full left-0 pt-1 -mt-1 z-50">
          <div className="min-w-[200px] bg-[#6289d5] rounded-sm shadow-lg overflow-hidden">
            {items.map((item, index) => {
              const linkClassName = `
                block px-4 py-2 text-white/95 font-mono text-[14px]
                no-underline hover:no-underline
                transition-all duration-150
                hover:bg-white/10 hover:text-white
                border-b border-white/10 last:border-b-0
                ${item.className || ''}
              `.trim().replace(/\s+/g, ' ');

              if (item.href) {
                return (
                  <a
                    key={index}
                    href={item.href}
                    className={linkClassName}
                    onClick={() => setIsOpen(false)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.label}
                  </a>
                );
              }

              return (
                <Link
                  key={index}
                  href={item.to || '/'}
                  className={linkClassName}
                  onClick={() => setIsOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
