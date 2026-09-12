'use client';

import { Undo2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { RATING_LABELS, UNDO_WINDOW_MS } from '@/lib/types';

/**
 * The ten-second undo, as the prototype drew it.
 *
 * The countdown is cosmetic. The window is enforced on the server against
 * `reviewed_at`, so a tab left open overnight cannot delete a log row from
 * yesterday no matter what this component believes the time is.
 */
export function UndoToast({
  headword,
  rating,
  expiresAt,
  busy,
  onUndo,
  onExpire,
}: {
  headword: string;
  rating: 1 | 2 | 3 | 4;
  expiresAt: number;
  busy: boolean;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsLeft(expiresAt));

  useEffect(() => {
    setRemaining(secondsLeft(expiresAt));
    const tick = setInterval(() => {
      const left = secondsLeft(expiresAt);
      setRemaining(left);
      if (left <= 0) onExpire();
    }, 250);
    return () => clearInterval(tick);
  }, [expiresAt, onExpire]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 0.18 }}
      className="mt-2 w-full overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/70 px-3 py-2 text-xs">
        <span className="truncate text-[var(--text-secondary)]">
          <span className="font-jp-serif font-semibold text-[var(--text-primary)]">{headword}</span>
          {' · '}
          {RATING_LABELS[rating - 1]}
        </span>
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-[var(--bamboo)] transition-colors hover:bg-[var(--bamboo-subtle)] disabled:opacity-50"
        >
          <Undo2 className="h-3.5 w-3.5" />
          <span>Hoàn tác</span>
          <span className="font-normal tabular-nums opacity-60">{remaining}s</span>
        </button>
      </div>
    </motion.div>
  );
}

function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}
