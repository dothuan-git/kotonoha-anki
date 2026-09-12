'use client';

import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';

import { AppNav } from '@/components/AppNav';
import { KotonohaLogo } from '@/components/KotonohaLogo';

/**
 * The app frame, in three sizes.
 *
 * Phones (< sm) get the screen edge to edge: the washi bezel and its rounded
 * screen are a framing device for when there is page around them to frame
 * against, and on a 390px viewport they only cost ~40px of the line length
 * the word list is read at.
 *
 * Tablets (sm – lg) get the prototype's centred phone frame, widened: the
 * bezel returns, the tab strip stays at the bottom of the sheet.
 *
 * Desktop (lg +) moves navigation to a rail down the left of the window and
 * lets the sheet run to 1100px, which is where the screens' own `md:` and
 * `lg:` grid classes finally come into play — they were always there, capped
 * out of reach by the 420px frame.
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
    <div className="flex h-full max-h-full w-full min-h-0 justify-center sm:max-h-[900px]">
      <AppNav dueCount={dueCount} variant="sidebar" className="hidden lg:flex" />

      {/* The bezel. Borderless and square on phones so the screen inside it
          can reach the edges; the washi frame from sm up. */}
      <div className="flex h-full w-full min-h-0 max-w-full flex-col p-0 sm:max-w-2xl sm:rounded-[40px] md:max-w-3xl sm:border sm:border-[var(--border-strong)] sm:bg-[var(--bg-muted)]/60 sm:p-4 sm:shadow-md lg:max-w-[1100px]">
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--bg-surface)] px-3.5 pb-2 pt-1 sm:rounded-[32px] sm:border sm:border-[var(--border-subtle)] sm:p-4 sm:shadow-xs">
          {/* Redundant with AppHeader once the bezel is gone, so it belongs to
              the bezel: it is the sheet's own masthead, not the app's. */}
          <div className="mb-2 hidden shrink-0 select-none items-center justify-between border-b border-[var(--border-subtle)]/70 pb-2 sm:flex">
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

          {/* The rail replaces the strip on desktop rather than joining it. */}
          <div className="mt-3 shrink-0 pt-1 lg:hidden">
            <AppNav dueCount={dueCount} variant="bar" />
          </div>
        </div>
      </div>
    </div>
  );
}
