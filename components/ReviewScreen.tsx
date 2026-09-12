'use client';

import { Check, Eye, Volume2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { Ruby } from '@/components/Ruby';
import { rateCard } from '@/lib/actions/review';
import { playJapaneseAudio } from '@/lib/client/audio';
import { STUDY_TIME_ZONE } from '@/lib/fsrs/day';
import { formatDueIn } from '@/lib/fsrs/format';
import { escapeRuby } from '@/lib/ruby';
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

const RATING_STYLES: Record<Rating, string> = {
  1: 'border-[var(--danger)]/35 bg-[var(--danger-subtle)] text-[var(--danger)]',
  2: 'border-[var(--warning)]/35 bg-[var(--warning-subtle)] text-[var(--warning)]',
  3: 'border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-[var(--bamboo)]',
  4: 'border-[var(--success)]/35 bg-[var(--success-subtle)] text-[var(--success)]',
};

interface Answered {
  item: ReviewItem;
  rating: Rating;
}

/**
 * The session runs off a client-held queue: the server builds the day once
 * (§4 — caps are the whole day, there is no "study more"), and each rating
 * goes back as a server action that returns the authoritative state.
 *
 * A card put back by a learning step re-enters the queue a couple of cards
 * later. Anything scheduled past the learn-ahead window leaves the session.
 */
export function ReviewScreen({ session }: { session: SessionView }) {
  const [queue, setQueue] = useState<ReviewItem[]>(session.items);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [counts, setCounts] = useState<DailyCounts>(session.counts);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const current = queue[0];

  const rate = useCallback(
    (rating: Rating) => {
      const item = queue[0];
      if (!item) return;

      setError(null);
      setRevealed(false);
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
          setQueue((q) => [
            ...q.slice(0, LEARNING_GAP),
            updated,
            ...q.slice(LEARNING_GAP),
          ]);
        }
      });
    },
    [queue],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && event.key >= '1' && event.key <= '4') {
        event.preventDefault();
        rate(Number(event.key) as Rating);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, rate]);

  if (!current) {
    // The queue can be momentarily empty while the last rating is in flight:
    // a learning step puts that card straight back. Showing the summary here
    // would flash "done" and then take it away again.
    if (saving) return <Saving />;
    return answered.length > 0 ? (
      <SessionSummary answered={answered} counts={counts} session={session} />
    ) : (
      <EmptySession session={session} />
    );
  }

  const total = answered.length + queue.length;

  return (
    <div className="w-full">
      <Progress done={answered.length} total={total} counts={counts} session={session} />

      {error && (
        <p className="mb-3 rounded-xl border border-[var(--danger)]/35 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={`${current.cardId}-${answered.length}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.18 }}
        >
          <CardFace item={current} revealed={revealed} onReveal={() => setRevealed(true)} />
        </motion.div>
      </AnimatePresence>

      {revealed ? (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map((rating) => (
            <button
              key={rating}
              type="button"
              onClick={() => rate(rating)}
              className={`flex flex-col items-center rounded-xl border py-2.5 transition-transform active:scale-95 ${RATING_STYLES[rating]}`}
            >
              <span className="text-sm font-bold">{RATING_LABELS[rating - 1]}</span>
              <span className="mt-0.5 text-[11px] opacity-80">{current.previews[rating]}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--bamboo)] py-3 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
        >
          <Eye className="h-4 w-4" />
          Xem đáp án
        </button>
      )}

      <p className="mt-3 text-center text-[11px] text-[var(--text-muted)]">
        Phím cách để lật thẻ · 1–4 để chấm
      </p>
    </div>
  );
}

function Progress({
  done,
  total,
  counts,
  session,
}: {
  done: number;
  total: number;
  counts: DailyCounts;
  session: SessionView;
}) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="mb-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Ôn tập</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {done}/{total} thẻ · hôm nay {counts.newCards}/{session.limits.newPerDay} từ mới,{' '}
            {counts.reviewCards}/{session.limits.reviewsPerDay} lượt ôn
          </p>
        </div>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
        <motion.div
          className="h-full rounded-full bg-[var(--bamboo)]"
          animate={{ width: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        />
      </div>
    </div>
  );
}

/**
 * Recognition (§13 — Phase 2 ships this card type only): the Japanese is the
 * prompt, everything else is the answer. The reading stays hidden until the
 * reveal, otherwise the card asks nothing.
 */
function CardFace({
  item,
  revealed,
  onReveal,
}: {
  item: ReviewItem;
  revealed: boolean;
  onReveal: () => void;
}) {
  const { word } = item;
  const hasKanji = word.headword !== word.reading;
  const ruby = `${escapeRuby(word.headword)}[${escapeRuby(word.reading)}]`;

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            item.isNew
              ? 'bg-[var(--bamboo-subtle)] text-[var(--bamboo)]'
              : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
          }`}
        >
          {item.isNew ? 'Từ mới' : `Lần ${item.state.reps + 1}`}
        </span>
        {item.state.lapses > 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">
            đã quên {item.state.lapses} lần
          </span>
        )}
      </div>

      {revealed ? (
        <p className="mt-5 text-center">
          {hasKanji ? (
            <Ruby text={ruby} className="font-jp-serif text-5xl text-[var(--text-primary)]" />
          ) : (
            <span className="font-jp-serif text-5xl text-[var(--text-primary)]">
              {word.headword}
            </span>
          )}
        </p>
      ) : (
        <button type="button" onClick={onReveal} className="mt-5 block w-full text-center">
          <span className="font-jp-serif text-5xl text-[var(--text-primary)]">
            {word.headword}
          </span>
          <span className="mt-6 block text-xs text-[var(--text-muted)]">
            Nhớ lại cách đọc và nghĩa, rồi lật thẻ.
          </span>
        </button>
      )}

      <AnimatePresence initial={false}>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* A kana-only headword is already its own reading; the ruby above
                covers the rest, so there is nothing to repeat here. */}
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => playJapaneseAudio(word.headword)}
                aria-label="Nghe phát âm"
                className="rounded-lg border border-[var(--border-subtle)] p-1.5 text-[var(--text-muted)] hover:text-[var(--bamboo)]"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 text-center text-2xl font-semibold text-[var(--text-primary)]">
              {word.meaning}
            </p>

            <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
              {formatPos(word.pos, word.transitivity)}
              {word.jlpt ? ` · ${word.jlpt}` : ''}
            </p>

            {word.kanji.length > 0 && (
              <p className="mt-1 text-center font-jp-sans text-xs text-[var(--text-secondary)]">
                {formatHanViet(word.kanji)}
              </p>
            )}

            {word.note && (
              <p className="mt-3 rounded-xl bg-[var(--bg-muted)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {word.note}
              </p>
            )}

            {word.sentences.map((sentence) => (
              <div
                key={sentence.id}
                className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-page)] px-3 py-2.5"
              >
                <Ruby
                  text={sentence.jpRuby}
                  className="font-jp-serif text-base leading-loose text-[var(--text-primary)]"
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">{sentence.vi}</p>
              </div>
            ))}

            <div className="mt-3 text-center">
              <Link
                href="/words"
                className="text-[11px] text-[var(--text-muted)] underline-offset-2 hover:underline"
              >
                Sửa từ này trong kho từ
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionSummary({
  answered,
  counts,
  session,
}: {
  answered: Answered[];
  counts: DailyCounts;
  session: SessionView;
}) {
  const forgotten = answered.filter((a) => a.rating === 1).length;
  const cards = new Set(answered.map((a) => a.item.cardId)).size;
  const nextDay = new Date(session.nextDayStart);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)]">
        <Check className="h-6 w-6 text-[var(--bamboo)]" />
      </div>

      <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
        Xong phiên hôm nay
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
        {cards} thẻ, {answered.length} lượt chấm
        {forgotten > 0 ? `, ${forgotten} lượt quên` : ''}.
      </p>

      <dl className="mt-6 grid w-full max-w-xs grid-cols-2 gap-2 text-left">
        <Stat label="Từ mới hôm nay" value={`${counts.newCards}/${session.limits.newPerDay}`} />
        <Stat
          label="Lượt ôn hôm nay"
          value={`${counts.reviewCards}/${session.limits.reviewsPerDay}`}
        />
      </dl>

      <p className="mt-5 text-xs text-[var(--text-secondary)]">
        Hạn mức mới lúc {formatRollover(nextDay)} ngày mai.
      </p>

      <Link
        href="/add"
        className="mt-6 rounded-xl bg-[var(--bamboo)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
      >
        Thêm từ vựng
      </Link>
    </div>
  );
}

/** No queue at all — which of the three reasons matters, so say which. */
function EmptySession({ session }: { session: SessionView }) {
  const now = new Date(session.now);
  const capped = session.heldBack.newCards + session.heldBack.reviewCards > 0;
  const nextDay = new Date(session.nextDayStart);

  const body = (() => {
    if (session.totalCards === 0) {
      return 'Chưa có thẻ nào. Thêm từ đầu tiên và nó sẽ xuất hiện ở đây ngay.';
    }
    if (capped) {
      return `Đã đủ hạn mức hôm nay: ${session.limits.newPerDay} từ mới và ${session.limits.reviewsPerDay} lượt ôn. Còn ${session.heldBack.reviewCards} thẻ đến hạn và ${session.heldBack.newCards} từ mới chờ sang ngày mai.`;
    }
    if (session.nextDue) {
      return `Không còn thẻ nào đến hạn. Thẻ gần nhất ${formatDueIn(now, new Date(session.nextDue))}.`;
    }
    return 'Không còn thẻ nào đến hạn.';
  })();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)]">
        <span className="font-jp-serif text-2xl text-[var(--bamboo)]">空</span>
      </div>

      <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
        {session.totalCards === 0 ? 'Chưa có thẻ nào' : 'Hết bài hôm nay'}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
        {body}
      </p>

      {capped && (
        <p className="mt-5 text-xs text-[var(--text-secondary)]">
          Hạn mức mới lúc {formatRollover(nextDay)} ngày mai.
        </p>
      )}

      <Link
        href="/add"
        className="mt-6 rounded-xl bg-[var(--bamboo)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
      >
        Thêm từ vựng
      </Link>
    </div>
  );
}

function Saving() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-[var(--text-muted)]">
      Đang lưu…
    </div>
  );
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <dt className="text-[11px] text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-semibold text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
