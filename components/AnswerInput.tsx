'use client';

import { CornerDownLeft, Eye } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { bind, unbind } from 'wanakana';

import { checkAnswer } from '@/lib/answer';

/**
 * The production card's answer field (§6).
 *
 * Romaji becomes kana as you type, so the card never needs an IME — the same
 * `wanakana.bind` the add form uses, and for the same reason the input is
 * uncontrolled: bind writes kana straight into the node, and a controlled
 * `value` fights it mid-word.
 *
 * Matching is `checkAnswer`, which is exact. The forgiveness lives one level
 * up, in "gõ nhầm".
 */
export function AnswerInput({
  word,
  disabled,
  onAnswer,
}: {
  word: { headword: string; reading: string };
  disabled: boolean;
  /** A typed attempt, already judged, or a giving-up with no text. */
  onAnswer: (attempt: { input: string; correct: boolean }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    bind(el, { IMEMode: 'toHiragana' });
    el.focus();
    return () => unbind(el);
  }, []);

  const submit = () => {
    const input = inputRef.current?.value ?? '';
    if (!input.trim() || disabled) return;
    onAnswer({ input, correct: checkAnswer(input, word) });
  };

  return (
    <div className="mt-6 space-y-2.5">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          aria-label="Đáp án tiếng Nhật"
          placeholder="akeru → あける"
          onInput={(e) => setHasText(e.currentTarget.value.trim().length > 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="font-jp-serif w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-3 text-center text-2xl tracking-wide text-[var(--text-primary)] outline-none placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-[var(--text-muted)] focus:border-[var(--bamboo)] disabled:opacity-60"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || !hasText}
          onClick={(e) => {
            e.stopPropagation();
            submit();
          }}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[var(--bamboo)] py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[var(--bamboo-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CornerDownLeft className="h-4 w-4" />
          <span>Kiểm tra</span>
        </button>
        {/*
          Without this the only way to see the answer is to type a wrong one,
          which logs a review you did not mean to grade. Giving up is a miss —
          it just should not require theatre.
        */}
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onAnswer({ input: inputRef.current?.value ?? '', correct: false });
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-3.5 py-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Hiện đáp án — tính là quên"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Chưa nhớ ra</span>
        </button>
      </div>
    </div>
  );
}
