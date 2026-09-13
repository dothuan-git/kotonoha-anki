'use client';

import { CornerDownLeft, Eye } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { bind, unbind } from 'wanakana';

import { checkAnswer } from '@/lib/answer';
import { MAX_ANSWER_ATTEMPTS } from '@/lib/types';

/**
 * The typed answer field.
 *
 * Two questions type into it. `word` asks for the word itself from the meaning
 * alone, and takes the kanji or the kana, since both are the word. `reading`
 * asks only for the reading, because the headword is on screen — accepting the
 * headword there would be marking the card's own prompt correct. `expect` says
 * which, and it reaches `checkAnswer` rather than being decided here.
 *
 * Three tries. A wrong answer does not reveal anything and does not write
 * anything: it says so, clears the field and waits. Only the third one gives
 * up and shows the answer. This is not a loosening of the matcher — every
 * attempt is judged exactly as strictly as before — it is an admission that
 * one slipped finger and one genuinely forgotten word look identical to a
 * comparison, and only the person typing can tell them apart.
 *
 * Romaji becomes kana as you type, so the card never needs an IME — the same
 * `wanakana.bind` the add form uses, and for the same reason the input is
 * uncontrolled: bind writes kana straight into the node, and a controlled
 * `value` fights it mid-word.
 */
/** What each question asks for, shown until something is typed. */
const PROMPT: Record<'word' | 'reading', string> = {
  word: 'akeru → あける hoặc 開ける',
  reading: 'ひらがな',
};

export function AnswerInput({
  word,
  expect = 'word',
  disabled,
  onAnswer,
}: {
  word: { headword: string; reading: string };
  /** What the card is asking to be typed. */
  expect?: 'word' | 'reading';
  disabled: boolean;
  /**
   * The card is done being typed at: the answer was right, the tries ran out,
   * or you gave up. A wrong answer with tries left never reaches this.
   */
  onAnswer: (attempt: { input: string; correct: boolean; attempts: number }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);
  /** Wrong answers so far. The field is remounted per card, so this is per card. */
  const [used, setUsed] = useState(0);
  const [missed, setMissed] = useState<string | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    bind(el, { IMEMode: 'toHiragana' });
    el.focus();
    return () => unbind(el);
  }, []);

  const remaining = MAX_ANSWER_ATTEMPTS - used;

  const submit = () => {
    const el = inputRef.current;
    const input = el?.value ?? '';
    if (!input.trim() || disabled) return;

    if (checkAnswer(input, word, expect)) {
      onAnswer({ input, correct: true, attempts: used + 1 });
      return;
    }

    const spent = used + 1;
    setUsed(spent);
    if (spent >= MAX_ANSWER_ATTEMPTS) {
      onAnswer({ input, correct: false, attempts: spent });
      return;
    }

    // Another go. The attempt is shown back rather than silently wiped —
    // without it you cannot tell which of your three tries you are on, or
    // what you actually typed the last time.
    setMissed(input);
    setHasText(false);
    if (el) {
      el.value = '';
      el.focus();
    }
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
          aria-label={expect === 'reading' ? 'Cách đọc' : 'Đáp án tiếng Nhật'}
          onInput={(e) => setHasText(e.currentTarget.value.trim().length > 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className={`font-jp-serif w-full rounded-xl border bg-[var(--bg-surface)] px-4 py-3 text-center text-2xl tracking-wide text-[var(--text-primary)] outline-none focus:border-[var(--bamboo)] disabled:opacity-60 ${
            missed ? 'border-red-500/40' : 'border-[var(--border-strong)]'
          }`}
        />
        {/*
          Overlay rather than ::placeholder, for the reason the add form
          already records: a placeholder smaller than the input's own font
          sits on the input's baseline, which reads as bottom-aligned. The
          word prompt is 14px inside a 24px field, so it sat visibly low —
          the reading prompt only got away with it by being 20px. Flex
          centering is the only reliable fix. `aria-label` carries the
          accessible name now that the attribute is gone.
        */}
        {!hasText && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-4 right-4 flex items-center justify-center"
          >
            <span
              className={`min-w-0 truncate text-[var(--text-muted)] ${
                expect === 'reading' ? 'font-jp-sans text-xl tracking-wide' : 'text-sm'
              }`}
            >
              {PROMPT[expect]}
            </span>
          </span>
        )}
      </div>

      {/* What was wrong, and how many goes are left. Nothing has been written. */}
      {missed && (
        <p
          aria-live="polite"
          className="text-center text-xs text-[var(--text-secondary)]"
        >
          <span className="font-jp-serif text-red-600 line-through dark:text-red-400">
            {missed}
          </span>
          <span className="ml-2">
            chưa đúng — còn {remaining} lượt
          </span>
        </p>
      )}

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
          Giving up, which spends every remaining try at once. Without it the
          only way to see the answer is to type three wrong ones, and a word
          you know you have forgotten should not require theatre.
        */}
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onAnswer({
              input: inputRef.current?.value ?? '',
              correct: false,
              attempts: MAX_ANSWER_ATTEMPTS,
            });
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-3.5 py-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Hiện đáp án ngay, không dùng hết lượt gõ"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Chưa nhớ ra</span>
        </button>
      </div>
    </div>
  );
}
