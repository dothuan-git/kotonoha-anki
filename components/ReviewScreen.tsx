'use client';

import {
  Check,
  CheckCircle2,
  Keyboard,
  Pencil,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { AnswerInput } from '@/components/AnswerInput';
import { ReviewEditPanel, type ReviewEdit } from '@/components/ReviewEditPanel';
import { Ruby } from '@/components/Ruby';
import { UndoToast } from '@/components/UndoToast';
import { rateCard, undoReview } from '@/lib/actions/review';
import { updateWord } from '@/lib/actions/words';
import { playJapaneseAudio } from '@/lib/client/audio';
import { STUDY_TIME_ZONE } from '@/lib/fsrs/day';
import { formatDueIn } from '@/lib/fsrs/format';
import {
  RATING_LABELS,
  UNDO_WINDOW_MS,
  formatHanViet,
  formatPos,
  type DailyCounts,
  type ReviewItem,
  type SessionView,
  type WordView,
} from '@/lib/types';

type Rating = 1 | 2 | 3 | 4;

/** How many other cards a learning card waits behind before it comes round again. */
const LEARNING_GAP = 2;

/** The prototype's rating row, unchanged. */
const RATING_STYLES: Record<Rating, string> = {
  1: 'border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20',
  2: 'border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
  3: 'border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-[var(--bamboo)] hover:opacity-90',
  4: 'bg-[var(--bamboo)] text-white hover:opacity-90 shadow-xs',
};

const ALL_RATINGS = [1, 2, 3, 4] as const;

interface Answered {
  /** `review_logs.id` — what undo deletes. */
  logId: string;
  item: ReviewItem;
  rating: Rating;
}

/** A typed answer, already judged by §6's matcher. */
interface Attempt {
  input: string;
  correct: boolean;
}

/** The rating still inside §5's undo window. At most one; a new rating replaces it. */
interface Undoable {
  logId: string;
  item: ReviewItem;
  rating: Rating;
  expiresAt: number;
}

/**
 * The prototype's ReviewScreen, rebuilt on the real scheduler.
 *
 * Layout, copy and animation follow the prototype; what changed underneath is
 * that the deck is no longer a fixed array. The server builds the day once
 * (§4 — the caps are the whole day, there is no "study more"), each rating
 * goes back as a server action that returns the authoritative state, and a
 * card put back by a learning step re-enters the queue a couple of cards later
 * rather than advancing an index that only moves forward.
 *
 * Phase 3 added the second direction. A `production` card hides the headword
 * and asks you to type it; the answer goes through §6's exact matcher, a wrong
 * one can only be graded Quên, and "gõ nhầm" throws the attempt away without
 * writing a log at all.
 */
export function ReviewScreen({ session }: { session: SessionView }) {
  const [queue, setQueue] = useState<ReviewItem[]>(session.items);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [counts, setCounts] = useState<DailyCounts>(session.counts);
  const [isRevealed, setIsRevealed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  /** Bumped by "gõ nhầm" to remount the answer field with an empty value. */
  const [attemptSeq, setAttemptSeq] = useState(0);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const [editing, setEditing] = useState(false);
  const [fontStyle, setFontStyle] = useState<'mincho' | 'gothic'>('mincho');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const currentWord = queue[0];
  const isProduction = currentWord?.cardType === 'production';

  const handleReveal = useCallback(() => {
    if (!currentWord || isProduction) return;
    setIsRevealed(true);
    playJapaneseAudio(currentWord.word.headword);
  }, [currentWord, isProduction]);

  /** A production card's answer arrives already judged; revealing is what follows. */
  const handleAnswer = useCallback(
    (result: Attempt) => {
      setAttempt(result);
      setIsRevealed(true);
      if (currentWord) playJapaneseAudio(currentWord.word.headword);
    },
    [currentWord],
  );

  /**
   * §6's escape hatch. The attempt is discarded and nothing is written — no
   * log, no rating, no state change — so a slipped finger costs a retype
   * rather than a card.
   */
  const handleMistype = useCallback(() => {
    setAttempt(null);
    setIsRevealed(false);
    setAttemptSeq((n) => n + 1);
  }, []);

  const handleRate = useCallback(
    (rating: Rating) => {
      const item = queue[0];
      if (!item) return;
      // A wrong production answer is a miss (§6); the buttons that would
      // grade it as anything else are not rendered, and not reachable by key.
      if (item.cardType === 'production' && attempt && !attempt.correct && rating !== 1) return;

      // Generated here so a retried submit lands on the same row instead of
      // logging the review twice (§3) — and so undo knows which row to delete.
      const logId = crypto.randomUUID();

      setError(null);
      setNotice(null);
      setIsRevealed(false);
      setAttempt(null);
      setEditing(false);
      setQueue((q) => q.slice(1));
      setAnswered((a) => [...a, { logId, item, rating }]);

      startTransition(async () => {
        const result = await rateCard({ logId, cardId: item.cardId, rating });

        if (!result.ok) {
          setError(result.error);
          setAnswered((a) => a.filter((x) => x.logId !== logId));
          setQueue((q) => [item, ...q]);
          return;
        }

        setCounts(result.data.counts);
        setUndoable({ logId, item, rating, expiresAt: Date.now() + UNDO_WINDOW_MS });
        if (result.data.unlockedProduction) {
          setNotice(`Đã mở thẻ gõ cho ${item.word.headword} — sẽ xuất hiện ở phiên sau.`);
        }
        if (result.data.repeat) {
          const updated: ReviewItem = {
            ...item,
            isNew: false,
            state: result.data.state,
            previews: result.data.previews,
          };
          setQueue((q) => [...q.slice(0, LEARNING_GAP), updated, ...q.slice(LEARNING_GAP)]);
        }
      });
    },
    [queue, attempt],
  );

  /**
   * §5's undo: the server deletes that one log row and refolds the card, and
   * what comes back is the state the shorter log implies. The card goes back
   * in front of you carrying it, rather than the values it had before — those
   * were a different card's worth of history.
   */
  const handleUndo = useCallback(() => {
    const last = undoable;
    if (!last) return;
    setUndoable(null);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await undoReview(last.logId);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setCounts(result.data.counts);
      setAnswered((a) => a.filter((x) => x.logId !== last.logId));
      setIsRevealed(false);
      setAttempt(null);
      setEditing(false);
      setQueue((q) => [
        { ...last.item, state: result.data.state, previews: result.data.previews },
        // A learning step may have put this card back further down; the undone
        // review is the reason it is there, so that copy goes too.
        ...q.filter((i) => i.cardId !== last.item.cardId),
      ]);
    });
  }, [undoable]);

  /** Edit mid-review (§13). Server first: a failed save must not leave a lie on screen. */
  const handleEditSave = useCallback(
    (patch: ReviewEdit) => {
      const item = queue[0];
      if (!item) return;
      const wordId = item.word.id;

      startTransition(async () => {
        const result = await updateWord({ id: wordId, ...patch });
        if (!result.ok) {
          setError(result.error);
          return;
        }

        const apply = (w: WordView): WordView => (w.id === wordId ? { ...w, ...patch } : w);
        setQueue((q) => q.map((i) => ({ ...i, word: apply(i.word) })));
        setAnswered((a) => a.map((x) => ({ ...x, item: { ...x.item, word: apply(x.item.word) } })));
        setEditing(false);
      });
    },
    [queue],
  );

  // Keyboard shortcut support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.code === 'Space' && !isRevealed) {
        e.preventDefault();
        handleReveal();
      } else if (isRevealed) {
        if (e.key === '1') handleRate(1);
        if (e.key === '2') handleRate(2);
        if (e.key === '3') handleRate(3);
        if (e.key === '4') handleRate(4);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRevealed, handleReveal, handleRate]);

  if (!currentWord) {
    // The queue can be momentarily empty while the last rating is in flight: a
    // learning step puts that card straight back. Showing the finished screen
    // here would flash "done" and then take it away again.
    if (saving) {
      return (
        <div className="w-full max-w-lg mx-auto py-16 px-6 text-center text-sm text-[var(--text-muted)]">
          Đang lưu…
        </div>
      );
    }
    return answered.length > 0 ? (
      <Finished
        title="Phiên ôn tập đã hoàn thành"
        body={summarise(answered, counts, session)}
        session={session}
      />
    ) : (
      <Finished title={emptyTitle(session)} body={emptyBody(session)} session={session} />
    );
  }

  const { word } = currentWord;
  const total = answered.length + queue.length;
  const done = answered.length;
  const hanViet = formatHanViet(word.kanji);
  // The answer side of a production card stays hidden until it is answered —
  // headword, Hán Việt and furigana all give it away.
  const showAnswerSide = !isProduction || isRevealed;
  const wrongAnswer = isProduction && attempt !== null && !attempt.correct;

  return (
    <div className="w-full flex flex-col justify-between min-h-[580px] p-2">
      {/* Top Session Progress Bar & Controls */}
      <div className="w-full flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
        {/* Progress pill */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--text-primary)]">
            {done + 1} / {total}
          </span>
          <div className="w-24 h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--bamboo)] rounded-full transition-all duration-300"
              style={{ width: `${((done + 1) / total) * 100}%` }}
            />
          </div>
        </div>

        {/* Card mode & per-card controls */}
        <div className="flex items-center gap-2">
          {/*
            The prototype made this a toggle. It is not a preference any more:
            recognition and production are two cards on the same word (§4), the
            queue decides which one is in front of you, and the label says
            which it is.
          */}
          <span
            className="px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] text-xs font-medium flex items-center gap-1.5 text-[var(--text-secondary)]"
            title={
              isProduction
                ? 'Thẻ gõ — nhớ lại từ tiếng Nhật từ nghĩa tiếng Việt'
                : 'Thẻ lật — nhận mặt từ'
            }
          >
            {isProduction ? (
              <Keyboard className="w-3.5 h-3.5" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            <span>{isProduction ? 'Thẻ gõ' : 'Thẻ lật'}</span>
          </span>

          {/* Editing before the answer is on screen would give a production card away. */}
          {isRevealed && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                editing
                  ? 'border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-[var(--bamboo)]'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--bamboo)]'
              }`}
              title="Sửa từ này"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => playJapaneseAudio(word.headword)}
            disabled={!showAnswerSide}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--bamboo)] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={showAnswerSide ? 'Nghe phát âm' : 'Nghe phát âm sau khi trả lời'}
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* The prototype's toast slot: undo (§5), then anything a write had to say. */}
      <AnimatePresence>
        {undoable && (
          <UndoToast
            key={undoable.logId}
            headword={undoable.item.word.headword}
            rating={undoable.rating}
            expiresAt={undoable.expiresAt}
            busy={saving}
            onUndo={handleUndo}
            onExpire={() => setUndoable(null)}
          />
        )}
        {notice && (
          <motion.div
            key="notice"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full mt-2 py-2 px-3 rounded-lg bg-[var(--bamboo-subtle)] border border-[var(--bamboo-border)] text-xs text-[var(--bamboo)] overflow-hidden"
          >
            {notice}
          </motion.div>
        )}
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full mt-2 py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-400 overflow-hidden"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Flashcard with Page-turn / Card Slide Animation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${currentWord.cardId}-${done}`}
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={!isRevealed && !isProduction ? handleReveal : undefined}
          className={`w-full mt-3 flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 sm:p-7 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-colors ${
            !isRevealed && !isProduction ? 'cursor-pointer hover:border-[var(--bamboo)]/50' : ''
          }`}
        >
          {/* Card Header Tags */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {word.jlpt && (
                <span className="px-2.5 py-0.5 rounded-md bg-[var(--bamboo-subtle)] border border-[var(--bamboo-border)]/50 text-[var(--bamboo)] text-xs font-semibold">
                  {word.jlpt}
                </span>
              )}
              <span className="text-xs text-[var(--text-muted)] font-medium">
                {formatPos(word.pos, word.transitivity)}
              </span>
            </div>

            {/* Dedicated Japanese Font Toggle (Mincho Serif vs Gothic Sans) */}
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
                  fontStyle === 'mincho'
                    ? 'font-jp-serif font-bold text-[var(--bamboo)]'
                    : 'font-jp-sans'
                }
              >
                {fontStyle === 'mincho' ? '明朝 (Serif)' : 'ゴシック (Sans)'}
              </span>
            </button>
          </div>

          {/* Center: the prompt — the headword, or the meaning to produce it from */}
          <div className="py-6 text-center">
            {showAnswerSide ? (
              <>
                <h1
                  className={`text-5xl sm:text-6xl text-[var(--text-primary)] select-all transition-all ${
                    fontStyle === 'mincho'
                      ? 'font-jp-serif font-medium sm:font-semibold tracking-wide'
                      : 'font-jp-sans font-bold tracking-tight'
                  }`}
                >
                  {word.headword}
                </h1>

                {/* Hán Việt reading tag */}
                {hanViet !== '—' && (
                  <div className="mt-3">
                    <span className="inline-block px-3 py-1 rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)] text-xs font-semibold tracking-wide border border-[var(--border-subtle)]">
                      Hán Việt: {hanViet}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                  Nghĩa tiếng Việt
                </span>
                <p className="mt-1.5 text-3xl sm:text-4xl font-bold leading-snug text-[var(--text-primary)]">
                  {word.meaning}
                </p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">Gõ từ tiếng Nhật tương ứng</p>
              </>
            )}

            {/* Click to reveal prompt */}
            {!isRevealed &&
              (isProduction ? (
                <AnswerInput
                  key={`${currentWord.cardId}-${attemptSeq}`}
                  word={word}
                  disabled={saving}
                  onAnswer={handleAnswer}
                />
              ) : (
                <div className="mt-8 text-xs text-[var(--text-muted)] flex items-center justify-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[var(--bamboo)]" />
                  <span>Chạm hoặc bấm Phím cách để xem đáp án</span>
                </div>
              ))}
          </div>

          {/* Revealed Content: Meaning, Furigana & Example Sentence */}
          <AnimatePresence>
            {isRevealed && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: 6 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: 6 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="border-t border-[var(--border-subtle)] pt-5 space-y-3.5 overflow-hidden"
              >
                {attempt && <Verdict attempt={attempt} />}

                {/* Reading + Sound */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                      Cách đọc
                    </span>
                    <span className="font-jp-serif text-xl sm:text-2xl font-semibold text-[var(--bamboo)] tracking-wide">
                      {word.reading}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playJapaneseAudio(word.reading);
                    }}
                    className="p-2 rounded-xl bg-[var(--bg-muted)] hover:bg-[var(--bamboo-subtle)] hover:text-[var(--bamboo)] text-[var(--text-secondary)] cursor-pointer transition-colors"
                    title="Nghe cách đọc"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Vietnamese Meaning */}
                <div>
                  <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                    Nghĩa tiếng Việt
                  </span>
                  <p className="text-base font-semibold text-[var(--text-primary)] mt-0.5 leading-snug">
                    {word.meaning}
                  </p>
                </div>

                {word.note && (
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                      Ghi chú
                    </span>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                      {word.note}
                    </p>
                  </div>
                )}

                {/* Example Sentence with Furigana */}
                {word.sentences.map((sentence) => (
                  <div
                    key={sentence.id}
                    className="p-3 rounded-xl bg-[var(--bg-muted)]/70 border border-[var(--border-subtle)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Ruby
                          text={sentence.jpRuby}
                          className="font-jp-sans text-sm sm:text-base font-medium text-[var(--text-primary)] leading-relaxed"
                        />
                        <p className="text-xs text-[var(--text-secondary)] mt-1">{sentence.vi}</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playJapaneseAudio(sentence.jp);
                        }}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--bamboo)] shrink-0 cursor-pointer"
                        title="Nghe câu ví dụ"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {editing && (
                  <ReviewEditPanel
                    word={word}
                    saving={saving}
                    onCancel={() => setEditing(false)}
                    onSave={handleEditSave}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* Bottom Rating Controls with Spring Press Animations */}
      <div className="mt-3 pt-1">
        {!isRevealed ? (
          isProduction ? (
            // The answer field carries its own submit; a reveal button here
            // would be a way around typing.
            <p className="py-3.5 text-center text-xs text-[var(--text-muted)]">
              Gõ đáp án rồi bấm Enter
            </p>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleReveal}
              className="w-full py-3.5 rounded-xl bg-[var(--bamboo)] hover:bg-[var(--bamboo-hover)] text-white text-sm font-semibold tracking-wide transition-colors cursor-pointer shadow-xs"
            >
              Hiện đáp án (Phím cách)
            </motion.button>
          )
        ) : wrongAnswer ? (
          /* §6: a near miss is a miss, so Quên is the only grade on offer.
             The other button writes nothing at all. */
          <div className="grid grid-cols-2 gap-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRate(1)}
              className={`py-2.5 px-2 rounded-xl font-semibold text-xs sm:text-sm transition-colors cursor-pointer flex flex-col items-center ${RATING_STYLES[1]}`}
            >
              <span>{RATING_LABELS[0]}</span>
              <span className="text-[10px] opacity-70 font-normal mt-0.5">
                {currentWord.previews[1]}
              </span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleMistype}
              title="Bỏ qua lần gõ này, không ghi vào lịch sử ôn tập"
              className="py-2.5 px-2 rounded-xl font-semibold text-xs sm:text-sm border border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer flex flex-col items-center"
            >
              <span>Gõ nhầm</span>
              <span className="text-[10px] opacity-70 font-normal mt-0.5">không tính</span>
            </motion.button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {ALL_RATINGS.map((rating) => (
              <motion.button
                key={rating}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleRate(rating)}
                className={`py-2.5 px-2 rounded-xl font-semibold text-xs sm:text-sm transition-colors cursor-pointer flex flex-col items-center ${RATING_STYLES[rating]}`}
              >
                <span>{RATING_LABELS[rating - 1]}</span>
                {/* The prototype's caption. `currentWord.previews[rating]` holds
                    what this rating actually schedules ("10 phút", "2 ngày") if
                    that is ever worth more than the keyboard hint. */}
                <span className="text-[10px] opacity-70 font-normal mt-0.5">Phím {rating}</span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What you typed, against what the card wanted.
 *
 * A wrong answer shows the attempt back verbatim — without it you cannot tell
 * a mistype from a genuinely wrong reading, which is exactly the judgement
 * "gõ nhầm" asks you to make.
 */
function Verdict({ attempt }: { attempt: Attempt }) {
  if (attempt.correct) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] px-3 py-2 text-sm font-semibold text-[var(--bamboo)]">
        <Check className="h-4 w-4 shrink-0" />
        <span>Chính xác</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
      <X className="h-4 w-4 shrink-0" />
      <span className="font-semibold">Chưa đúng</span>
      {attempt.input.trim() && (
        <span className="font-jp-serif truncate opacity-80">— bạn gõ: {attempt.input}</span>
      )}
    </div>
  );
}

/**
 * The prototype's completion screen. Its "Ôn tập lại từ đầu" button is gone:
 * it replayed the same deck, which against a real scheduler means re-rating
 * cards already answered today, and §4 rules out a "study more" escape hatch
 * in as many words.
 */
function Finished({
  title,
  body,
  session,
}: {
  title: string;
  body: string;
  session: SessionView;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 25 }}
      className="w-full max-w-lg mx-auto py-16 px-6 text-center"
    >
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.1 }}
        className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shadow-xs"
      >
        <CheckCircle2 className="w-8 h-8" />
      </motion.div>
      <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed max-w-sm mx-auto">
        {body}
      </p>

      <p className="mt-4 text-xs text-[var(--text-secondary)]">
        Hạn mức mới lúc {formatRollover(new Date(session.nextDayStart))} ngày mai.
      </p>

      <div className="mt-8 flex items-center justify-center gap-3">
        <Link
          href="/add"
          className="px-5 py-2.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-page)] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-2 shadow-xs"
        >
          <Sparkles className="w-4 h-4" />
          <span>Thêm từ vựng</span>
        </Link>
      </div>
    </motion.div>
  );
}

function summarise(answered: Answered[], counts: DailyCounts, session: SessionView): string {
  const cards = new Set(answered.map((a) => a.item.cardId)).size;
  const forgotten = answered.filter((a) => a.rating === 1).length;
  const forgot = forgotten > 0 ? `, ${forgotten} lượt quên` : '';
  return (
    `${cards} thẻ, ${answered.length} lượt chấm${forgot}. ` +
    `Hôm nay đã học ${counts.newCards}/${session.limits.newPerDay} từ mới và ` +
    `${counts.reviewCards}/${session.limits.reviewsPerDay} lượt ôn.`
  );
}

function emptyTitle(session: SessionView): string {
  return session.totalCards === 0 ? 'Chưa có thẻ nào' : 'Không còn thẻ đến hạn';
}

/** Three different reasons for an empty queue, and it matters which. */
function emptyBody(session: SessionView): string {
  if (session.totalCards === 0) {
    return 'Chưa có thẻ nào trong sổ. Thêm từ đầu tiên và nó sẽ xuất hiện ở đây ngay.';
  }
  if (session.heldBack.newCards + session.heldBack.reviewCards > 0) {
    return (
      `Đã đủ hạn mức hôm nay. Còn ${session.heldBack.reviewCards} thẻ đến hạn và ` +
      `${session.heldBack.newCards} từ mới chờ sang ngày mai.`
    );
  }
  if (session.nextDue) {
    const due = formatDueIn(new Date(session.now), new Date(session.nextDue));
    return `Bạn đã ôn tập xong các từ vựng đến hạn hôm nay. Thẻ gần nhất ${due}.`;
  }
  return 'Bạn đã ôn tập xong các từ vựng đến hạn hôm nay.';
}

/**
 * The study day rolls over in a fixed zone, so the time is stated in that zone
 * — otherwise the server renders its own clock and the client corrects it on
 * hydration.
 */
function formatRollover(date: Date): string {
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: STUDY_TIME_ZONE,
  });
}
