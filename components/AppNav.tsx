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

export function AppNav() {
  const pathname = usePathname();
  if (pathname === '/signin') return null;

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-2xl -translate-x-1/2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-2 py-1.5 backdrop-blur-md sm:py-2">
      <div className="mx-auto flex items-center justify-around">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);

          return (
            <motion.div key={tab.href} whileTap={{ scale: 0.92 }}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex select-none flex-col items-center rounded-xl px-2.5 py-1.5 transition-colors sm:px-3 ${
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
                <Icon
                  className={`z-10 h-5 w-5 transition-transform ${
                    isActive ? 'scale-105 stroke-[2.5]' : 'stroke-[1.75]'
                  }`}
                />
                <span className="z-10 mt-1 text-[11px] tracking-tight">{tab.label}</span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </nav>
  );
}
