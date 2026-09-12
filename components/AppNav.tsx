'use client';

import { BarChart2, BookMarked, Grid, Layers, PlusCircle, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The prototype's ModernNavigation, rebuilt on the router. The active-tab
 * spring indicator and the badge slot are kept; the tab id becomes an href.
 */
const TABS = [
  { href: '/', label: 'Ôn tập', icon: Layers },
  { href: '/add', label: 'Thêm từ', icon: PlusCircle },
  { href: '/words', label: 'Kho từ', icon: BookMarked },
  { href: '/kanji', label: 'Hán tự', icon: Grid },
  { href: '/stats', label: 'Thống kê', icon: BarChart2 },
  { href: '/settings', label: 'Cài đặt', icon: Settings },
] as const;

export function AppNav({ dueCount = 0 }: { dueCount?: number }) {
  const pathname = usePathname();
  if (pathname === '/signin') return null;

  return (
    <nav className="w-full rounded-2xl border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-1 py-1.5 backdrop-blur-md sm:py-2">
      <div className="mx-auto flex items-center justify-between">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);

          return (
            <motion.div key={tab.href} whileTap={{ scale: 0.92 }}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex select-none flex-col items-center rounded-xl px-1.5 py-1.5 transition-colors sm:px-2 ${
                  isActive
                    ? 'font-bold text-[var(--bamboo)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 -z-10 rounded-xl border border-[var(--bamboo-border)]/60 bg-[var(--bamboo-subtle)]"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  />
                )}
                <div className="relative z-10">
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
                <span className="z-10 mt-1 whitespace-nowrap text-[10px] tracking-tight sm:text-[11px]">
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
