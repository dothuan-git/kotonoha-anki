'use client';

import { ChevronLeft, ChevronRight, Volume2, X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, type Variants } from 'motion/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Ruby } from '@/components/Ruby';
import { playSentenceAudio, playWordAudio } from '@/lib/client/audio';
import type { PreviewDetail, PreviewRow, RowStatus } from '@/lib/import';
import { formatPos } from '@/lib/types';

type Sentence = { jpRuby: string; vi: string };
type WordDetail = Extract<PreviewDetail, { kind: 'word' }>;
type GrammarDetail = Extract<PreviewDetail, { kind: 'grammar' }>;

/** -1 came from the row before, 1 from the row after, 0 opened fresh. */
export type Direction = -1 | 0 | 1;

const panel: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 34 } },
  gone: { opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' } },
};

/** The row's content slides a little the way you moved. */
const content: Variants = {
  enter: (dir: Direction) => ({ opacity: 0, x: dir * 20 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  leave: (dir: Direction) => ({
    opacity: 0,
    x: dir * -20,
    transition: { duration: 0.12, ease: 'easeIn' },
  }),
};

/**
 * One previewed row in full — what the file says about it, laid out as its
 * review card will show it, before anything is written.
 *
 * A native modal <dialog> underneath, for the focus trap, the inert page and
 * the top layer; the backdrop and the panel are drawn inside it so they can
 * animate out, and the dialog is closed only once they have.
 */
export function ImportPreviewDialog({
  row,
  direction,
  position,
  onClose,
  onPrev,
  onNext,
  onToggle,
}: {
  row: PreviewRow | null;
  direction: Direction;
  /** Where this row sits among the ones that open, for "3 / 40". */
  position: { current: number; total: number } | null;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** Strike the row off, or put it back. Absent when it cannot be. */
  onToggle: (() => void) | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = Boolean(row?.detail);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog || dialog.open) return;
    dialog.showModal();
    // The dialog rather than its first button, so opening does not ring the
    // close button; arrows and Escape work from here, Tab moves inside.
    dialog.focus();
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    // Escape is taken here, not from `cancel`: Chrome ignores preventDefault on
    // `cancel` without a fresh user gesture, and the panel would vanish
    // instead of animating out.
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowLeft' && onPrev) {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowRight' && onNext) {
      e.preventDefault();
      onNext();
    }
  }

  return (
    <dialog
      ref={ref}
      // Any other close request (a phone's back gesture); animate out the same way.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A browser may close it regardless; keep the state in step.
      onClose={() => {
        if (open) onClose();
      }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      aria-label={row ? `Chi tiết ${row.headword}` : undefined}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 outline-none backdrop:bg-transparent"
    >
      <MotionConfig reducedMotion="user">
        <AnimatePresence onExitComplete={() => ref.current?.close()}>
          {open && row?.detail && (
            <div key="layer" className="flex h-full w-full items-center justify-center p-4">
              <motion.div
                aria-hidden
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.16 } }}
                className="absolute inset-0 bg-black/30"
              />

              <motion.section
                variants={panel}
                initial="hidden"
                animate="shown"
                exit="gone"
                className="relative flex max-h-[85dvh] w-full max-w-md flex-col sm:max-w-xl lg:max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
              >
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Đóng"
                  className="absolute right-3 top-3 z-10 cursor-pointer rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] sm:right-4 sm:top-4"
                >
                  <X className="h-4 w-4" />
                </button>

                <ScrollBody>
                  <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                    <motion.div
                      key={row.index}
                      custom={direction}
                      variants={content}
                      initial="enter"
                      animate="center"
                      exit="leave"
                    >
                      {/* A struck-off row stays readable, but reads as set aside. */}
                      <div
                        className={`transition-opacity ${row.status === 'excluded' ? 'opacity-45' : ''}`}
                      >
                        {row.detail.kind === 'word' ? (
                          <WordFace row={row} detail={row.detail} />
                        ) : (
                          <GrammarFace row={row} detail={row.detail} />
                        )}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </ScrollBody>

                <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-2.5 sm:px-7">
                  <div className="-ml-1.5 flex items-center">
                    <NavButton label="Mục trước (←)" onClick={onPrev}>
                      <ChevronLeft className="h-4 w-4" />
                    </NavButton>
                    {position && (
                      <span className="min-w-12 text-center text-xs tabular-nums text-[var(--text-muted)]">
                        {position.current} / {position.total}
                      </span>
                    )}
                    <NavButton label="Mục sau (→)" onClick={onNext}>
                      <ChevronRight className="h-4 w-4" />
                    </NavButton>
                  </div>
                  <RowAction status={row.status} reason={row.reason} onToggle={onToggle} />
                </footer>
              </motion.section>
            </div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </dialog>
  );
}

/**
 * The scrolling middle. Its height follows the row inside it, so stepping to
 * a shorter or longer row resizes the panel smoothly instead of in a jump.
 */
function ScrollBody({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
    >
      {/* `relative`, for the row popped out of the flow while it leaves. */}
      <div ref={inner} className="relative p-5 sm:p-7">
        {children}
      </div>
    </motion.div>
  );
}

/** What happens to this row, said once, at the bottom. */
function RowAction({
  status,
  reason,
  onToggle,
}: {
  status: RowStatus;
  reason?: string;
  onToggle: (() => void) | null;
}) {
  if (status === 'duplicate' || status === 'invalid') {
    return <span className="text-right text-xs text-[var(--warning)]">{reason}</span>;
  }
  if (!onToggle) return null;

  return status === 'excluded' ? (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="text-[var(--text-muted)]">Đã bỏ ·</span>
      <button
        type="button"
        onClick={onToggle}
        className="cursor-pointer font-semibold text-[var(--brand)] hover:underline"
      >
        Nhập lại
      </button>
    </span>
  ) : (
    <button
      type="button"
      onClick={onToggle}
      className="-mr-2 cursor-pointer rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
    >
      Bỏ khỏi lần nhập
    </button>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick ?? undefined}
      disabled={!onClick}
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** The word card, turned over: front above the line, answer below it. */
function WordFace({ row, detail }: { row: PreviewRow; detail: WordDetail }) {
  const hanViet = Object.entries(detail.hanViet)
    .filter(([, readings]) => readings.length > 0)
    .map(([kanji, readings]) => `${kanji} ${readings.join('/').toUpperCase()}`)
    .join(' · ');

  return (
    <>
      <CardTop jlpt={detail.jlpt} label={formatPos(detail.pos, detail.transitivity)}>
        <SpeakButton label="Nghe phát âm" onClick={() => playWordAudio({ reading: row.reading })} />
      </CardTop>

      <div className="py-6 text-center">
        <h2 className="font-jp-serif text-5xl font-medium tracking-wide text-[var(--text-primary)] sm:text-6xl">
          {row.headword}
        </h2>
        {hanViet && (
          <span className="mt-3 inline-block rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
            Hán Việt: {hanViet}
          </span>
        )}
      </div>

      <div className="space-y-3.5 border-t border-[var(--border-subtle)] pt-5">
        <Field label="Cách đọc">
          <p className="font-jp-serif text-xl font-semibold tracking-wide text-[var(--brand)] sm:text-2xl">
            {row.reading}
          </p>
        </Field>
        <Field label="Nghĩa tiếng Việt">
          <p className="text-base font-semibold leading-snug">{row.meaning}</p>
        </Field>
        {detail.note && <Note text={detail.note} />}
        {detail.sentence && <SentenceBox sentence={detail.sentence} />}
      </div>
    </>
  );
}

/** The grammar card's answer side: the pattern, then what it means and how it is used. */
function GrammarFace({ row, detail }: { row: PreviewRow; detail: GrammarDetail }) {
  return (
    <>
      <CardTop jlpt={detail.jlpt} label="Ngữ pháp" />

      <div className="py-6 text-center">
        <h2 className="font-jp-serif text-4xl font-medium tracking-wide text-[var(--text-primary)] sm:text-5xl">
          {row.headword}
        </h2>
      </div>

      <div className="space-y-3.5 border-t border-[var(--border-subtle)] pt-5">
        <Field label="Nghĩa">
          <p className="text-base font-semibold leading-snug">{row.meaning}</p>
        </Field>
        {detail.formation && (
          <Field label="Cấu trúc">
            <p className="font-jp-sans text-sm text-[var(--text-secondary)]">{detail.formation}</p>
          </Field>
        )}
        {detail.note && <Note text={detail.note} />}
        {detail.sentences.map((sentence, i) => (
          <SentenceBox key={i} sentence={sentence} />
        ))}
      </div>
    </>
  );
}

/** The card's header line: level badge and kind on the left, controls on the right. */
function CardTop({
  jlpt,
  label,
  children,
}: {
  jlpt: string | null;
  label: string;
  children?: ReactNode;
}) {
  return (
    // Right padding leaves the close button its corner.
    <div className="flex items-center justify-between gap-2 pr-8">
      <div className="flex items-center gap-1.5">
        {jlpt && (
          <span className="rounded-md border border-[var(--brand-border)]/50 bg-[var(--brand-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--brand)]">
            {jlpt}
          </span>
        )}
        <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <Field label="Ghi chú">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{text}</p>
    </Field>
  );
}

function SentenceBox({ sentence }: { sentence: Sentence }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/70 p-3">
      <div className="min-w-0">
        <Ruby
          text={sentence.jpRuby}
          className="font-jp-sans text-sm font-medium leading-relaxed text-[var(--text-primary)] sm:text-base"
        />
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{sentence.vi}</p>
      </div>
      <button
        type="button"
        onClick={() => playSentenceAudio(sentence)}
        aria-label="Nghe câu ví dụ"
        title="Nghe câu ví dụ"
        className="shrink-0 cursor-pointer p-1 text-[var(--text-muted)] hover:text-[var(--brand)]"
      >
        <Volume2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SpeakButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--brand)]"
    >
      <Volume2 className="h-3.5 w-3.5" />
    </button>
  );
}
