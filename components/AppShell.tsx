'use client';

import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';

import { AppNav } from '@/components/AppNav';
import { KotonohaLogo } from '@/components/KotonohaLogo';

/**
 * The prototype's centred phone frame: a washi bezel around a rounded screen,
 * with the brand bar at the top and the nav nested at the bottom of the
 * screen rather than pinned to the browser window.
 *
 * The frame is a bounded flex column, not a tall div. The prototype could let
 * each screen size itself because every screen fitted — this app's /stats is
 * six charts and /words is the whole collection, and a nav that scrolled off
 * the bottom of those would be a nav you cannot reach. So the screen keeps
 * its chrome fixed and scrolls its content, which is what the `overflow-hidden`
 * on the design's inner screen was already describing.
 */
export function AppShell({
  children,
  dueCount,
}: {
  children: React.ReactNode;
  dueCount: number;
}) {
  const pathname = usePathname();

  // Sign-in is not part of the app yet — no frame, no brand bar, no nav.
  if (pathname === '/signin') return <>{children}</>;

  return (
    <div className="flex h-full max-h-[900px] w-full max-w-[420px] flex-col rounded-[40px] border border-[var(--border-strong)] bg-[var(--bg-muted)]/60 p-3 shadow-md sm:p-4">
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[32px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-xs sm:p-4">
        <div className="mb-2 flex shrink-0 select-none items-center justify-between border-b border-[var(--border-subtle)]/70 pb-2">
          <KotonohaLogo size="sm" showSubtitle={false} />
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)]/70 px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--bamboo)]" />
            <span className="font-medium">Sổ từ Washi</span>
          </div>
        </div>

        {/*
          The screen's scroll container. `min-h-0` is what lets it actually
          scroll: without it a flex child grows to its content instead of to
          its share of the frame, and the nav below gets pushed out of view.

          Keyed on the path so each navigation replays the enter animation.
          The prototype wrapped this in AnimatePresence for an exit too, which
          does not survive the move to the router — the exiting element and the
          entering one share one `children` prop, so the fade-out would already
          be showing the next page.
        */}
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pt-2"
        >
          {children}
        </motion.div>

        <div className="mt-3 shrink-0 pt-1">
          <AppNav dueCount={dueCount} />
        </div>
      </div>
    </div>
  );
}
