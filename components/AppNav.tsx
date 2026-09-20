'use client';

import { BarChart2, BookMarked, Grid, Layers, PlusCircle, Repeat, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The prototype's ModernNavigation, rebuilt on the router. The active-tab
 * spring indicator and the badge slot are kept; the tab id becomes an href.
 */
const TABS = [
  { href: '/', label: 'Ôn tập', icon: Layers },
  // Luyện tập is the drill, Ôn tập the scheduled review. It carries no badge:
  // the badge means work that has come due, and practice never is.
  { href: '/practice', label: 'Luyện tập', icon: Repeat },
  { href: '/add', label: 'Thêm từ', icon: PlusCircle },
  { href: '/words', label: 'Kho từ', icon: BookMarked },
  { href: '/kanji', label: 'Hán tự', icon: Grid },
  { href: '/stats', label: 'Thống kê', icon: BarChart2 },
  { href: '/settings', label: 'Cài đặt', icon: Settings },
] as const;

/**
 * `bar` is the phone/tablet tab strip along the bottom of the sheet; `sidebar`
 * is the desktop rail down the left of the window.
 *
 * Both variants are mounted at once and shown by breakpoint, so their
 * indicators need different `layoutId`s — two elements sharing one would make
 * motion treat the hidden rail and the visible strip as the same box and
 * animate the indicator between them.
 */
type Variant = 'bar' | 'sidebar';

export function AppNav({
  dueCount = 0,
  variant = 'bar',
  className = '',
}: {
  dueCount?: number;
  variant?: Variant;
  className?: string;
}) {
  const pathname = usePathname();
  if (pathname === '/signin') return null;

  const sidebar = variant === 'sidebar';

  return (
    <nav
      className={
        sidebar
          ? `mr-4 h-full w-[13.5rem] shrink-0 flex-col gap-1 rounded-[32px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-3 shadow-xs ${className}`
          : `w-full rounded-2xl border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-1 py-1.5 backdrop-blur-md sm:py-2 ${className}`
      }
      aria-label="Điều hướng chính"
    >
      <div
        className={
          sidebar ? 'flex flex-col gap-1' : 'mx-auto flex items-center justify-between'
        }
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);

          return (
            <motion.div
              key={tab.href}
              whileTap={{ scale: sidebar ? 0.98 : 0.92 }}
              className={sidebar ? 'w-full' : undefined}
            >
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex select-none transition-colors ${
                  sidebar
                    ? 'w-full items-center gap-3 rounded-xl px-3 py-2.5'
                    : 'flex-col items-center rounded-xl px-1.5 py-1.5 sm:px-2'
                } ${
                  isActive
                    ? 'font-bold text-[var(--bamboo)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId={`activeTabIndicator-${variant}`}
                    className="absolute inset-0 -z-10 rounded-xl border border-[var(--bamboo-border)]/60 bg-[var(--bamboo-subtle)]"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  />
                )}
                <div className="relative z-10 shrink-0">
                  <Icon
                    className={`h-5 w-5 transition-transform ${
                      isActive ? 'scale-105 stroke-[2.5]' : 'stroke-[1.75]'
                    }`}
                  />
                  {tab.href === '/' && dueCount > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--bamboo)] px-1 text-[9px] font-bold leading-none text-white shadow-xs">
                      {dueCount}
                    </span>
                  )}
                </div>
                <span
                  className={`z-10 whitespace-nowrap tracking-tight ${
                    sidebar ? 'text-sm' : 'mt-1 text-[10px] sm:text-[11px]'
                  }`}
                >
                  {tab.label}
                </span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </nav>
  );
}
