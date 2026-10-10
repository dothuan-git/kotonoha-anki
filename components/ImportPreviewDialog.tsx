'use client';

import { ChevronLeft, ChevronRight, Undo2, Volume2, X } from 'lucide-react';
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useDragControls,
  type Variants,
} from 'motion/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { Ruby } from '@/components/Ruby';
import { playSentenceAudio, playWordAudio } from '@/lib/client/audio';
import type { PreviewDetail, PreviewRow, RowStatus } from '@/lib/import';
import { formatPos } from '@/lib/types';

type Sentence = { jpRuby: string; vi: string };

/** -1 came from the row before, 1 from the row after, 0 opened fresh. */
export type Direction = -1 | 0 | 1;

const STATUS_TONE: Record<RowStatus, { label: string; className: string }> = {
  ok: {
    label: 'Sẽ nhập',
    className: 'bg-[var(--brand-subtle)] text-[var(--brand)] border-[var(--brand-border)]',
  },
  duplicate: {
    label: 'Bỏ qua',
    className: 'bg-[var(--warning-subtle)] text-[var(--warning)] border-[var(--warning)]/30',
  },
  excluded: {
    label: 'Đã bỏ',
    className: 'bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border-subtle)]',
  },
  invalid: {
    label: 'Lỗi',
    className: 'bg-[var(--danger-subtle)] text-[var(--danger)] border-[var(--danger)]/30',
  },
};

const SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const;

/** A sheet from the bottom on a phone, a card that settles in on anything wider. */
const panel: Variants = {
  hidden: (wide: boolean) => (wide ? { opacity: 0, scale: 0.95, y: 18 } : { y: '100%' }),
  shown: { opacity: 1, scale: 1, y: 0, transition: SPRING },
  gone: (wide: boolean) =>
    wide
      ? { opacity: 0, scale: 0.97, y: 10, transition: { duration: 0.15, ease: 'easeIn' } }
      : { y: '100%', transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
};

/** The row's content slides the way you moved, and its parts arrive in order. */
const content: Variants = {
  enter: (dir: Direction) => ({ opacity: 0, x: dir * 36 }),
  center: {
    opacity: 1,
    x: 0,
    transition: { ...SPRING, staggerChildren: 0.035, delayChildren: 0.04 },
  },
  leave: (dir: Direction) => ({
    opacity: 0,
    x: dir * -36,
    transition: { duration: 0.14, ease: 'easeIn' },
  }),
};

const part: Variants = {
  enter: { opacity: 0, y: 8 },
  center: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * One previewed row in full — what the file says about it, laid out the way
 * its card will show it, before anything is written.
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
  const wide = useMediaQuery('(min-width: 640px)');
  const drag = useDragControls();
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
        <AnimatePresence custom={wide} onExitComplete={() => ref.current?.close()}>
          {open && row?.detail && (
            <div
              key="layer"
              className="flex h-full w-full items-end justify-center sm:items-center sm:p-4"
            >
              <motion.div
                aria-hidden
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
              />

              <motion.section
                custom={wide}
                variants={panel}
                initial="hidden"
                animate="shown"
                exit="gone"
                drag={wide ? false : 'y'}
                dragListener={false}
                dragControls={drag}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 600) onClose();
                }}
                // The wash of brand colour sits on the panel, behind the
                // header too, so it has no seam where the header ends.
                className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] bg-[linear-gradient(to_bottom,var(--brand-subtle),var(--bg-surface)_15rem)] text-[var(--text-primary)] shadow-2xl sm:max-h-[85dvh] sm:w-[min(34rem,100%)] sm:rounded-3xl"
              >
                <Header
                  status={row.status}
                  line={row.index + 1}
                  onClose={onClose}
                  onGrab={(e) => {
                    if (!wide) drag.start(e);
                  }}
                />

                <ScrollBody>
                  {/* Not `initial={false}`: the parts arrive in order on open too. */}
                  <AnimatePresence mode="popLayout" custom={direction}>
                    <motion.div
                      key={row.index}
                      custom={direction}
                      variants={content}
                      initial="enter"
                      animate="center"
                      exit="leave"
                    >
                      <Detail row={row} detail={row.detail} />
                    </motion.div>
                  </AnimatePresence>
                </ScrollBody>

                <Footer
                  status={row.status}
                  position={position}
                  onPrev={onPrev}
                  onNext={onNext}
                  onToggle={onToggle}
                />
              </motion.section>
            </div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </dialog>
  );
}

function Header({
  status,
  line,
  onClose,
  onGrab,
}: {
  status: RowStatus;
  line: number;
  onClose: () => void;
  onGrab: (e: PointerEvent) => void;
}) {
  const tone = STATUS_TONE[status];

  return (
    <header
      onPointerDown={onGrab}
      className="relative shrink-0 touch-none px-5 pt-3 pb-2 sm:touch-auto sm:pt-4"
    >
      {/* The handle a sheet is pulled down by. Phones only. */}
      <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.16 }}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone.className}`}
            >
              {tone.label}
            </motion.span>
          </AnimatePresence>
          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">Dòng {line}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="cursor-pointer rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

/**
 * The scrolling middle. Its height follows the row inside it, so moving to a
 * shorter or longer row resizes the panel smoothly instead of in a jump.
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
      transition={SPRING}
      className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
    >
      {/* `relative`, for the row popped out of the flow while it leaves. */}
      <div ref={inner} className="relative px-5 pb-5">
        {children}
      </div>
    </motion.div>
  );
}

function Footer({
  status,
  position,
  onPrev,
  onNext,
  onToggle,
}: {
  status: RowStatus;
  position: { current: number; total: number } | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onToggle: (() => void) | null;
}) {
  const dropped = status === 'excluded';

  return (
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-1">
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

      {onToggle && (
        <motion.button
          type="button"
          onClick={onToggle}
          whileTap={{ scale: 0.96 }}
          className={`flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
            dropped
              ? 'bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]'
              : 'text-[var(--danger)] hover:bg-[var(--danger-subtle)]'
          }`}
        >
          {dropped ? <Undo2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          {dropped ? 'Nhập lại' : 'Bỏ khỏi lần nhập'}
        </motion.button>
      )}
    </footer>
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
      className="cursor-pointer rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--brand)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]"
    >
      {children}
    </button>
  );
}

function Detail({ row, detail }: { row: PreviewRow; detail: PreviewDetail }) {
  return (
    <div className="space-y-4">
      {detail.kind === 'word' ? <WordHero row={row} detail={detail} /> : <GrammarHero row={row} detail={detail} />}

      {row.reason && (
        <motion.p
          variants={part}
          className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-subtle)] px-3 py-2 text-xs font-medium text-[var(--warning)]"
        >
          {row.reason}
        </motion.p>
      )}

      {detail.kind === 'word' ? (
        detail.sentence && (
          <Section label="Câu ví dụ">
            <SentenceCard sentence={detail.sentence} />
          </Section>
        )
      ) : (
        <Section label="Câu ví dụ — thẻ hỏi bằng câu tiếng Việt">
          <ol className="space-y-2">
            {detail.sentences.map((sentence, i) => (
              <li key={i}>
                <SentenceCard sentence={sentence} number={i + 1} vietnameseFirst />
              </li>
            ))}
          </ol>
        </Section>
      )}

      {detail.note && (
        <Section label="Ghi chú">
          <p className="border-l-2 border-[var(--brand-border)] pl-3 text-sm leading-relaxed text-[var(--text-secondary)]">
            {detail.note}
          </p>
        </Section>
      )}
    </div>
  );
}

/** The front of the word card: the word, its reading, and what it means. */
function WordHero({ row, detail }: { row: PreviewRow; detail: Extract<PreviewDetail, { kind: 'word' }> }) {
  const hanViet = Object.entries(detail.hanViet)
    .filter(([, readings]) => readings.length > 0)
    .map(([kanji, readings]) => `${kanji} ${readings.join('/').toUpperCase()}`)
    .join(' · ');

  return (
    <motion.div
      variants={part}
      className="pt-1 text-center"
    >
      <Chips>
        <Chip>{formatPos(detail.pos, detail.transitivity)}</Chip>
        {detail.jlpt && <Chip strong>{detail.jlpt}</Chip>}
      </Chips>
      <h2 className="mt-3 font-jp-serif text-5xl font-medium tracking-wide text-[var(--text-primary)] sm:text-6xl">
        {row.headword}
      </h2>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        <span className="font-jp-serif text-xl font-semibold tracking-wide text-[var(--brand)]">
          {row.reading}
        </span>
        <SpeakButton label="Nghe cách đọc" onClick={() => playWordAudio({ reading: row.reading })} />
      </div>
      <p className="mt-1.5 text-base font-semibold leading-snug text-[var(--text-primary)]">
        {row.meaning}
      </p>
      {hanViet && (
        <span className="mt-3 inline-block rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
          Hán Việt: {hanViet}
        </span>
      )}
    </motion.div>
  );
}

/** The pattern, what it means, and how it attaches — as a row of pieces. */
function GrammarHero({
  row,
  detail,
}: {
  row: PreviewRow;
  detail: Extract<PreviewDetail, { kind: 'grammar' }>;
}) {
  const pieces = detail.formation
    ?.split('+')
    .map((piece) => piece.trim())
    .filter(Boolean);

  return (
    <motion.div
      variants={part}
      className="pt-1 text-center"
    >
      {detail.jlpt && (
        <Chips>
          <Chip strong>{detail.jlpt}</Chip>
        </Chips>
      )}
      <h2 className="mt-3 font-jp-serif text-4xl font-semibold tracking-wide text-[var(--text-primary)] sm:text-5xl">
        {row.headword}
      </h2>
      <p className="mt-2 text-base font-semibold leading-snug text-[var(--brand)]">{row.meaning}</p>
      {pieces && pieces.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 font-jp-sans text-sm">
          {pieces.map((piece, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[var(--text-muted)]">+</span>}
              <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-2 py-0.5 text-[var(--text-primary)] shadow-xs">
                {piece}
              </span>
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function SentenceCard({
  sentence,
  number,
  vietnameseFirst = false,
}: {
  sentence: Sentence;
  number?: number;
  /** A grammar card asks with the Vietnamese, so that is what leads. */
  vietnameseFirst?: boolean;
}) {
  const japanese = (
    <Ruby
      text={sentence.jpRuby}
      className="font-jp-sans text-base font-medium leading-relaxed text-[var(--text-primary)]"
    />
  );
  const vietnamese = (
    <p
      className={
        vietnameseFirst
          ? 'text-sm font-semibold text-[var(--text-primary)]'
          : 'mt-1 text-xs text-[var(--text-secondary)]'
      }
    >
      {sentence.vi}
    </p>
  );

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/60 p-3">
      {number !== undefined && (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-subtle)] text-[10px] font-bold text-[var(--brand)]">
          {number}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {vietnameseFirst ? (
          <>
            {vietnamese}
            <div className="mt-2 border-t border-dashed border-[var(--border-subtle)] pt-2.5">
              {japanese}
            </div>
          </>
        ) : (
          <>
            {japanese}
            {vietnamese}
          </>
        )}
      </div>
      <SpeakButton label="Nghe câu" onClick={() => playSentenceAudio(sentence)} />
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <motion.section variants={part}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </h3>
      {children}
    </motion.section>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-1.5">{children}</div>;
}

function Chip({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        strong
          ? 'bg-[var(--brand)] text-white'
          : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </span>
  );
}

function SpeakButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      aria-label={label}
      title={label}
      className="shrink-0 cursor-pointer rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--brand-subtle)] hover:text-[var(--brand)]"
    >
      <Volume2 className="h-4 w-4" />
    </motion.button>
  );
}

/** Whether a media query matches, kept current. False on the server. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
