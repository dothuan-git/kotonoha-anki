'use client';

import { CheckCircle2, Keyboard, Sparkles, Volume2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { Ruby } from '@/components/Ruby';
import { rateCard } from '@/lib/actions/review';
import { playJapaneseAudio } from '@/lib/client/audio';
import { STUDY_TIME_ZONE } from '@/lib/fsrs/day';
import { formatDueIn } from '@/lib/fsrs/format';
import {
  RATING_LABELS,
  formatHanViet,
  formatPos,
  type DailyCounts,
  type ReviewItem,
  type SessionView,
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

interface Answered {
  item: ReviewItem;
  rating: Rating;
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
 */
export function ReviewScreen({ session }: { session: SessionView }) {
  const [queue, setQueue] = useState<ReviewItem[]>(session.items);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [counts, setCounts] = useState<DailyCounts>(session.counts);
  const [isRevealed, setIsRevealed] = useState(false);
  const [fontStyle, setFontStyle] = useState<'mincho' | 'gothic'>('mincho');
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const currentWord = queue[0];

  const handleReveal = useCallback(() => {
    setIsRevealed(true);
    if (currentWord) playJapaneseAudio(currentWord.word.headword);
  }, [currentWord]);

  const handleRate = useCallback(
    (rating: Rating) => {
      const item = queue[0];
      if (!item) return;

      setError(null);
      setIsRevealed(false);
      setQueue((q) => q.slice(1));
      setAnswered((a) => [...a, { item, rating }]);

      startTransition(async () => {
        const result = await rateCard({
          // The log's primary key, generated here so a retry cannot log the
          // same review twice (§3).
          logId: crypto.randomUUID(),
          cardId: item.cardId,
          rating,
        });

        if (!result.ok) {
          setError(result.error);
          setAnswered((a) => a.slice(0, -1));
          setQueue((q) => [item, ...q]);
          return;
        }

        setCounts(result.data.counts);
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

        {/* Mode Toggle & Audio button */}
        <div className="flex items-center gap-2">
          {/*
            The prototype toggled a typing mode that compared the input to the
            reading with ===. Real answer matching is §6 — normalisation, the
            "gõ nhầm" escape — and ships with production cards in Phase 3. The
            control stays visible and disabled rather than shipping a version
            that marks コーヒー wrong for a correct answer.
          */}
          <button
            type="button"
            disabled
            title="Chế độ gõ đi cùng thẻ chủ động, giai đoạn 3"
            className="px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] text-xs font-medium flex items-center gap-1.5 text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Thẻ lật</span>
          </button>

          <button
            type="button"
            onClick={() => playJapaneseAudio(word.headword)}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--bamboo)] cursor-pointer transition-colors"
            title="Nghe phát âm"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/*
        The prototype's undo toast sat here. Undo is Phase 3 (§13) — it is a
        hard-delete of the just-written log row followed by a recompute, and
        `recomputeCardState` is already the second half of it. Until then the
        slot carries the one message a real server write can produce.
      */}
      <AnimatePresence>
        {error && (
          <motion.div
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
          onClick={!isRevealed ? handleReveal : undefined}
          className={`w-full mt-3 flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 sm:p-7 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-colors ${
            !isRevealed ? 'cursor-pointer hover:border-[var(--bamboo)]/50' : ''
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

          {/* Center: Large Kanji Headword */}
          <div className="py-6 text-center">
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

            {/* Click to reveal prompt */}
            {!isRevealed && (
              <div className="mt-8 text-xs text-[var(--text-muted)] flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--bamboo)]" />
                <span>Chạm hoặc bấm Phím cách để xem đáp án</span>
              </div>
            )}
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
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* Bottom Rating Controls with Spring Press Animations */}
      <div className="mt-3 pt-1">
        {isRevealed ? (
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as const).map((rating) => (
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
        )}
      </div>
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
