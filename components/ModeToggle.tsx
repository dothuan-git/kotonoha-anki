'use client';

import { motion } from 'motion/react';

import { useStudyMode } from '@/components/StudyMode';
import type { CardKind } from '@/lib/types';

const MODES: readonly { mode: CardKind; glyph: string; label: string }[] = [
  { mode: 'word', glyph: '語', label: 'Từ vựng' },
  { mode: 'grammar', glyph: '文', label: 'Ngữ pháp' },
];

/**
 * The switch between the two tab sets — and the two palettes.
 *
 * The mode you are not in carries its own due count, because a badge you can
 * only see from inside a mode is a badge you never see: grammar reviews would
 * pile up unnoticed behind a vocabulary nav.
 */
export function ModeToggle() {
  const { mode, due, switchTo } = useStudyMode();

  return (
    <div
      role="radiogroup"
      aria-label="Chế độ học"
      className="relative flex shrink-0 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)]/70 p-0.5"
    >
      {MODES.map((option) => {
        const active = option.mode === mode;
        const waiting = due[option.mode];
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => switchTo(option.mode)}
            title={
              active
                ? `Đang ở chế độ ${option.label.toLowerCase()}`
                : `Chuyển sang ${option.label.toLowerCase()}`
            }
            className={`relative flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'font-semibold text-[var(--brand)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {active && (
              <motion.span
                layoutId="mode-toggle-indicator"
                className="absolute inset-0 -z-0 rounded-full border border-[var(--brand-border)]/70 bg-[var(--bg-surface)] shadow-xs"
                transition={{ type: 'spring', stiffness: 450, damping: 32 }}
              />
            )}
            <span className="relative font-jp-serif text-sm leading-none">{option.glyph}</span>
            <span className="relative hidden sm:inline">{option.label}</span>
            {!active && waiting > 0 && (
              <span className="relative flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--text-muted)] px-1 text-[9px] font-bold leading-none text-[var(--bg-surface)]">
                {waiting}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
