'use client';

import { Check, Copy, CornerDownLeft, Eye, Sparkles, Volume2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { bind, unbind } from 'wanakana';

import { Ruby } from '@/components/Ruby';
import { GrammarEditPanel, type GrammarEditPatch } from '@/components/review/GrammarEditPanel';
import type { FontStyle } from '@/components/review/types';
import { playSentenceAudio } from '@/lib/client/audio';
import { overlapPercent } from '@/lib/overlap';
import type { GrammarView, SentenceView } from '@/lib/types';

/**
 * The inside of a grammar card.
 *
 * The prompt is a Vietnamese sentence and the pattern it should be said with;
 * the task is to produce the Japanese. The pattern is on the front on purpose:
 * "tôi lỡ làm mất ví" can be said correctly without 〜てしまう, and a card that
 * accepted that would be testing translation, not the grammar point.
 *
 * Nothing is matched. A sentence has too many right answers — word order,
 * は or が, plain or polite — for an exact comparison to mean anything, and a
 * looser one is not on offer anywhere in this app. So typing here is a scratch
 * pad: what you wrote is put beside the model sentence and you grade yourself,
 * as you would on a flip card.
 */
export function GrammarCard({
  grammar,
  sentence,
  isRevealed,
  typing,
  saving,
  editing,
  fontStyle,
  setFontStyle,
  onSubmit,
  onEditSave,
  onEditCancel,
}: {
  grammar: GrammarView;
  /** The example this showing asks — see `pickSentence`. */
  sentence: SentenceView;
  isRevealed: boolean;
  typing: boolean;
  saving: boolean;
  editing: boolean;
  fontStyle: FontStyle;
  setFontStyle: (style: FontStyle) => void;
  /** Done writing: reveal the answer. */
  onSubmit: () => void;
  onEditSave: (patch: GrammarEditPatch) => void;
  onEditCancel: () => void;
}) {
  /** What was written, kept to put beside the model answer. Never judged. */
  const [written, setWritten] = useState('');

  const overlap = overlapPercent(written, sentence);

  const jpFont =
    fontStyle === 'mincho'
      ? 'font-jp-serif font-medium tracking-wide'
      : 'font-jp-sans font-semibold tracking-tight';

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {grammar.jlpt && (
            <span className="px-2.5 py-0.5 rounded-md bg-[var(--brand-subtle)] border border-[var(--brand-border)]/50 text-[var(--brand)] text-xs font-semibold">
              {grammar.jlpt}
            </span>
          )}
          <span className="text-xs text-[var(--text-muted)] font-medium">Ngữ pháp</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFontStyle(fontStyle === 'mincho' ? 'gothic' : 'mincho');
            }}
            className="px-2 py-0.5 rounded-md text-[11px] font-medium border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 hover:bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1 transition-colors"
            title="Đổi phông chữ tiếng Nhật (Mincho Serif / Gothic Sans)"
          >
            <span
              className={
                fontStyle === 'mincho' ? 'font-jp-serif font-bold text-[var(--brand)]' : 'font-jp-sans'
              }
            >
              {fontStyle === 'mincho' ? '明朝 (Serif)' : 'ゴシック (Sans)'}
            </span>
          </button>

          {/* The sentence spoken before you have produced it is the answer, out loud. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playSentenceAudio(sentence);
            }}
            disabled={!isRevealed}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--brand)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            title={isRevealed ? 'Nghe câu mẫu' : 'Nghe câu mẫu sau khi trả lời'}
          >
            <Volume2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-fit flex-1 flex-col justify-center py-6 text-center">
        {/* Steps up to make room for the field, as in `WordCard`. */}
        <motion.div
          layout
          transition={{ layout: { type: 'spring', stiffness: 240, damping: 30, mass: 0.8 } }}
        >
          <span className="text-[11px] text-[var(--text-muted)] block font-medium">
            {typing ? 'Viết câu này bằng tiếng Nhật' : 'Nói câu này bằng tiếng Nhật'}
          </span>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold leading-snug text-[var(--text-primary)]">
            {sentence.vi}
          </p>
          <div className="mt-3">
            <span
              className={`inline-block rounded-full border border-[var(--brand-border)] bg-[var(--brand-subtle)] px-3 py-1 text-sm text-[var(--brand)] ${jpFont}`}
            >
              {grammar.pattern}
            </span>
          </div>
        </motion.div>

        <AnimatePresence mode="popLayout" initial={false}>
          {!isRevealed &&
            (typing ? (
              <motion.div
                key="typing"
                initial={{ opacity: 0, clipPath: 'inset(0% 44% 0% 44%)' }}
                animate={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
                exit={{ opacity: 0, clipPath: 'inset(0% 44% 0% 44%)' }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <ScratchInput
                  disabled={saving}
                  onSubmit={(text) => {
                    setWritten(text);
                    onSubmit();
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="mt-8 text-xs text-[var(--text-muted)] flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-[var(--brand)]" />
                <span>Nói hoặc nghĩ câu trả lời, rồi chạm / bấm Phím cách để xem</span>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isRevealed && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 6 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: 6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="border-t border-[var(--border-subtle)] pt-5 space-y-3.5 overflow-hidden text-left"
          >
            {written.trim() && (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-[var(--text-muted)]">Bạn viết</span>
                  {/* A glance, not a grade — see `overlapPercent`. */}
                  {overlap !== null && (
                    <span
                      className={`rounded-full border px-1.5 text-[10px] font-semibold ${overlapTone(overlap)}`}
                      title="Tỉ lệ ký tự trùng với câu mẫu — chỉ để tham khảo, không chấm điểm"
                    >
                      Giống {overlap}%
                    </span>
                  )}
                  {overlap !== null && overlap < 100 && (
                    <CopyAttemptButton
                      text={[
                        `Tiếng Việt: ${sentence.vi}`,
                        `Bạn viết: ${written.trim()}`,
                        `Câu mẫu: ${sentence.jp}`,
                      ].join('\n')}
                    />
                  )}
                </div>
                <p className={`mt-0.5 text-xl sm:text-2xl text-[var(--text-secondary)] ${jpFont}`}>{written}</p>
              </div>
            )}

            <div>
              <span className="block text-[11px] font-medium text-[var(--text-muted)]">Câu mẫu</span>
              <div className="mt-0.5 flex items-start justify-between gap-2">
                <Ruby text={sentence.jpRuby} className={`text-xl sm:text-2xl text-[var(--text-primary)] ${jpFont}`} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playSentenceAudio(sentence);
                  }}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--brand)] shrink-0 cursor-pointer"
                  title="Nghe câu mẫu"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-muted)]/70 border border-[var(--border-subtle)] p-3 space-y-1">
              <p className="text-sm">
                <span className={`text-[var(--brand)] ${jpFont}`}>{grammar.pattern}</span>
                <span className="text-[var(--text-muted)]"> — </span>
                <span className="font-semibold text-[var(--text-primary)]">{grammar.meaning}</span>
              </p>
              {grammar.formation && (
                <p className="font-jp-sans text-xs text-[var(--text-secondary)]">{grammar.formation}</p>
              )}
            </div>

            {grammar.note && (
              <div>
                <span className="text-[11px] text-[var(--text-muted)] block font-medium">Ghi chú</span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                  {grammar.note}
                </p>
              </div>
            )}

            {editing && (
              <GrammarEditPanel
                grammar={grammar}
                saving={saving}
                onCancel={onEditCancel}
                onSave={onEditSave}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Green, amber, red — the same palette the verdict and the rating row use. */
function overlapTone(percent: number): string {
  if (percent >= 80) {
    return 'border-[var(--brand-border)] bg-[var(--brand-subtle)] text-[var(--brand)]';
  }
  if (percent >= 50) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400';
}

/**
 * Copies the prompt, the attempt and the model sentence together, to take a
 * near miss somewhere that can explain it. All three are on the card already,
 * so a failed copy (no clipboard outside a secure context) still leaves them
 * selectable.
 */
function CopyAttemptButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  const Icon = status === 'copied' ? Check : status === 'failed' ? X : Copy;
  const tone =
    status === 'copied'
      ? 'text-[var(--brand)]'
      : status === 'failed'
        ? 'text-[var(--danger)]'
        : 'text-[var(--text-muted)] hover:text-[var(--brand)]';
  const label =
    status === 'copied'
      ? 'Đã sao chép'
      : status === 'failed'
        ? 'Không sao chép được — hãy chọn thủ công'
        : 'Sao chép câu tiếng Việt, câu bạn viết và câu mẫu';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      className={`ml-auto shrink-0 cursor-pointer p-1 transition-colors ${tone}`}
      title={label}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Where the attempt is written:`AnswerInput`'s field and buttons, so the two
 * kinds of card do not read as two different typing modes. What differs is
 * underneath — nothing is checked, so the primary button just turns the card
 * over, and there are no tries to spend.
 *
 * Romaji becomes kana as you type and an IME works as well; kanji are welcome,
 * the field is never compared with anything.
 *
 * Space is left alone, unlike the word card's field where it gives up. A word
 * never contains one, a sentence can, and an IME converts with it.
 */
function ScratchInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
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

  /** Turn the card over with whatever is written, which may be nothing. */
  const reveal = () => {
    if (disabled) return;
    onSubmit(inputRef.current?.value ?? '');
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
          aria-label="Câu tiếng Nhật"
          onInput={(e) => setHasText(e.currentTarget.value.trim().length > 0)}
          onKeyDown={(e) => {
            // Enter also confirms an IME conversion; that one is not a submit.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (hasText) reveal();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          // Smaller than the word card's field: a sentence runs out of room
          // at text-2xl after about seventeen characters.
          className="font-jp-serif w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-3 text-center text-xl tracking-wide text-[var(--text-primary)] outline-none focus:border-[var(--brand)] disabled:opacity-60"
        />
        {/* An overlay rather than ::placeholder, for the reason `AnswerInput` gives. */}
        {!hasText && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-4 right-4 flex items-center justify-center"
          >
            <span className="min-w-0 truncate text-sm text-[var(--text-muted)]">
              Viết câu tiếng Nhật…
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || !hasText}
          onClick={(e) => {
            e.stopPropagation();
            reveal();
          }}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CornerDownLeft className="h-4 w-4" />
          <span>Xem đáp án</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            reveal();
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-3.5 py-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Hiện câu mẫu ngay, không cần viết"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Chưa nhớ ra</span>
        </button>
      </div>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Không chấm tự động — so với câu mẫu rồi tự chấm điểm.
      </p>
    </div>
  );
}
