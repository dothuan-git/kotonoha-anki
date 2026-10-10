'use client';

import { CornerDownLeft, PenLine, Sparkles, Volume2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { bind, unbind } from 'wanakana';

import { Ruby } from '@/components/Ruby';
import { GrammarEditPanel, type GrammarEditPatch } from '@/components/review/GrammarEditPanel';
import type { FontStyle } from '@/components/review/types';
import { playSentenceAudio } from '@/lib/client/audio';
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
        <span className="text-[11px] text-[var(--text-muted)] block font-medium">
          Nói câu này bằng tiếng Nhật
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
                <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Bạn viết
                </span>
                <p className={`mt-0.5 text-lg text-[var(--text-secondary)] ${jpFont}`}>{written}</p>
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

/**
 * Where the attempt is written. Romaji becomes kana as you type, as in the
 * word card's answer field, and an IME works as well — kanji are welcome, the
 * field is never compared with anything.
 */
function ScratchInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    bind(el, { IMEMode: 'toHiragana' });
    el.focus();
    return () => unbind(el);
  }, []);

  const submit = () => {
    if (disabled) return;
    onSubmit(inputRef.current?.value ?? '');
  };

  return (
    <div className="mx-auto mt-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <PenLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Viết câu tiếng Nhật…"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="font-jp-sans w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] py-2.5 pl-9 pr-3 text-base text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="rounded-xl bg-[var(--brand)] p-2.5 text-white hover:bg-[var(--brand-hover)] cursor-pointer disabled:opacity-60"
          aria-label="Xem đáp án"
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        Không chấm tự động — so với câu mẫu rồi tự chấm điểm.
      </p>
    </div>
  );
}
