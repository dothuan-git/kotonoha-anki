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
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { AnswerInput } from '@/components/AnswerInput';
import { LeechPanel } from '@/components/LeechPanel';
import { ReviewEditPanel, type ReviewEdit } from '@/components/ReviewEditPanel';
import { Ruby } from '@/components/Ruby';
import { SyncStatus } from '@/components/SyncStatus';
import { UndoToast } from '@/components/UndoToast';
import { acknowledgeLeech } from '@/lib/actions/leech';
import { undoReview } from '@/lib/actions/review';
import { updateWord } from '@/lib/actions/words';
import { playJapaneseAudio } from '@/lib/client/audio';
import { useOnline } from '@/lib/client/online';
import { enqueue, flush, noteConfusion, pendingCount, takeBack } from '@/lib/client/outbox';
import { chooseSession, loadSession, saveSession } from '@/lib/client/session';
import { STUDY_TIME_ZONE } from '@/lib/fsrs/day';
import { formatDueIn } from '@/lib/fsrs/format';
import { countCard, rateLocally } from '@/lib/fsrs/local';
import {
  RATING_LABELS,
  UNDO_WINDOW_MS,
  formatHanViet,
  formatPos,
  tallyCounts,
  type CountedCards,
  type DailyCounts,
  type ReviewItem,
  type SessionView,
  type SyncResult,
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

/** A typed answer, already judged by the answer matcher. */
interface Attempt {
  input: string;
  correct: boolean;
}

/** The rating still inside the undo window. At most one; a new rating replaces it. */
interface Undoable {
  logId: string;
  item: ReviewItem;
  rating: Rating;
  expiresAt: number;
  /**
   * This rating is what put the card into today's tally, so undoing it takes
   * the card back out. A repeat of a card already counted this morning did
   * not, and must leave the count alone.
   */
  counted: boolean;
}

/** How often the outbox is checked while anything is waiting in it. */
const FLUSH_INTERVAL_MS = 5_000;

/**
 * The prototype's ReviewScreen, rebuilt on the real scheduler.
 *
 * Layout, copy and animation follow the prototype; what changed underneath is
 * that the deck is no longer a fixed array. The server builds the day once —
 * the caps are the whole day, there is no "study more" — each rating goes
 * back as a server action that returns the authoritative state, and a card
 * put back by a learning step re-enters the queue a couple of cards later
 * rather than advancing an index that only moves forward.
 *
 * A `production` card hides the headword and asks you to type it; the answer
 * goes through the exact answer matcher, a wrong one can only be graded
 * Quên, and "gõ nhầm" throws the attempt away without writing a log at all.
 *
 * The server is cut out of the review loop itself. A rating is scheduled
 * here, on the device, and goes into an outbox; `/api/sync` replays the
 * outbox and hands back the authoritative fold, which replaces whatever was
 * computed locally. There is no online path and offline path — there is one
 * path, and being online only means it drains sooner. Airplane mode is
 * therefore not a mode this screen knows about: it is what the ordinary path
 * looks like when nothing is draining.
 */
export function ReviewScreen({ session: serverSession }: { session: SessionView }) {
  const [session, setSession] = useState<SessionView>(serverSession);
  const [queue, setQueue] = useState<ReviewItem[]>(serverSession.items);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [countedCards, setCountedCards] = useState<CountedCards>(serverSession.countedCards);
  const [isRevealed, setIsRevealed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  /** Bumped by "gõ nhầm" to remount the answer field with an empty value. */
  const [attemptSeq, setAttemptSeq] = useState(0);
  /**
   * How this one card is being asked, when that is not how the queue asked
   * for it. The queue still decides which card is in front of you and which
   * card the rating is written to; this decides only whether you type the
   * answer or turn the card over, and it lasts one card.
   */
  const [modeOverride, setModeOverride] = useState<ReviewItem['cardType'] | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const [editing, setEditing] = useState(false);
  /** The leech prompt, shown once for the card that just crossed six lapses. */
  const [leeched, setLeeched] = useState<ReviewItem | null>(null);
  const [fontStyle, setFontStyle] = useState<'mincho' | 'gothic'>('mincho');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  /**
   * Whether the resume decision has been made. Until it has, what is on screen
   * is the server's payload, which may be a cached render of a session that
   * was finished hours ago — so rating is held back rather than applied to a
   * card that is about to be replaced.
   */
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const online = useOnline();

  const counts = tallyCounts(countedCards);
  const currentWord = queue[0];
  /**
   * How the card is being asked — the queue's answer, unless overridden — and
   * what that means on screen.
   *
   * Three arrangements, not two, because typing means a different question on
   * each card. A production card typed is the whole point of it: the meaning
   * alone, and you produce the word. A recognition card typed keeps its
   * headword on screen and asks only for the reading, which is a self-imposed
   * check on the card you were already being shown.
   */
  const typing = (modeOverride ?? currentWord?.cardType) === 'production';
  const produceWord = typing && currentWord?.cardType === 'production';

  /**
   * Applying what came back from /api/sync: the server folded each card's
   * whole log, this screen only ever folded the slice it was handed, so the
   * server wins outright. Cards that have already left the queue need
   * nothing — their state is on the server, which is where the next session
   * reads it from.
   */
  const applySync = useCallback((result: SyncResult) => {
    setCountedCards(result.countedCards);
    setQueue((q) =>
      q.map((item) => {
        const authoritative = result.states[item.cardId];
        return authoritative
          ? { ...item, state: authoritative.state, previews: authoritative.previews }
          : item;
      }),
    );

    if (result.unlocked.length > 0) {
      setNotice(`Đã mở ${result.unlocked.length} thẻ gõ mới — sẽ xuất hiện ở phiên sau.`);
    }

    // The leech prompt, for a card whose sixth lapse was rated somewhere
    // else. The one in front of you raised its own prompt at the rating,
    // without waiting for a round trip, so this only fires for the other
    // device's card — and only if that card is in today's queue, where there
    // is a word to edit.
    if (result.leeches.length > 0) {
      setLeeched((current) => {
        if (current) return current;
        const cardId = result.leeches[0];
        return queueRef.current.find((item) => item.cardId === cardId) ?? null;
      });
    }
    if (result.rejected.length > 0) {
      // Permanently refused: the card was deleted or suspended between the
      // rating and the sync. Saying so is the honest option — the alternative
      // is an outbox that quietly never empties.
      setError(`${result.rejected.length} lượt ôn không gửi được (thẻ đã bị xoá hoặc tạm dừng).`);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flush();
      if (result) applySync(result);
    } finally {
      setSyncing(false);
      setPending(await pendingCount());
    }
  }, [applySync]);

  const syncRef = useRef(sync);
  syncRef.current = sync;

  // Read by `applySync`, which must not take the queue as a dependency: it is
  // handed to every flush interval and would rebuild them on every rating.
  const queueRef = useRef(queue);
  queueRef.current = queue;

  /**
   * The offline prefetch, and the resume decision.
   *
   * The day's cards, words and sentences already arrived in the payload that
   * rendered this page, so prefetching them means keeping them. What takes a
   * moment is deciding whether to believe them — see `chooseSession`.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const now = new Date();
      const [stored, waiting] = await Promise.all([loadSession(now), pendingCount()]);
      if (cancelled) return;

      const chosen = chooseSession({
        server: serverSession,
        stored,
        pendingCount: waiting,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
        now,
      });

      setSession(chosen.session);
      setQueue(chosen.session.items);
      setCountedCards(chosen.session.countedCards);
      setPending(waiting);
      setReady(true);
      await saveSession(chosen.session, now);
      if (!cancelled) await syncRef.current();
    })();

    return () => {
      cancelled = true;
    };
  }, [serverSession]);

  /**
   * Keep the stored queue equal to what is left, not to what the day started
   * as. Close the tab two stations early and the next open resumes here.
   */
  useEffect(() => {
    if (!ready) return;
    void saveSession({ ...session, items: queue, countedCards });
  }, [ready, session, queue, countedCards]);

  /**
   * Drain the outbox. Entries are held back for the undo window, so a flush
   * straight after a rating deliberately does nothing and this poll is what
   * eventually sends it.
   */
  useEffect(() => {
    if (!ready || pending === 0 || !online) return;
    const id = setInterval(() => void sync(), FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready, pending, online, sync]);

  /** Coming out of a tunnel, or back to the tab, is worth trying at once. */
  useEffect(() => {
    if (!ready) return;
    const retry = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [ready, sync]);

  /**
   * The override lasts exactly one card. Both halves of "one card" matter: the
   * card id, for the ordinary move to the next card, and the number answered,
   * because a learning step can put the same card straight back — and that
   * second showing is a new question, not the one you overrode.
   */
  useEffect(() => {
    setModeOverride(null);
  }, [currentWord?.cardId, answered.length]);

  /**
   * Ask this card the other way: type the answer instead of turning the card
   * over, or the reverse. Only before the answer is on screen — afterwards
   * there is nothing left to ask.
   */
  const toggleMode = useCallback(() => {
    if (isRevealed) return;
    setAttempt(null);
    setModeOverride(typing ? 'recognition' : 'production');
  }, [isRevealed, typing]);

  const handleReveal = useCallback(() => {
    if (!currentWord || typing) return;
    setIsRevealed(true);
    playJapaneseAudio(currentWord.word.headword);
  }, [currentWord, typing]);

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
   * The escape hatch for a mistyped answer. The attempt is discarded and
   * nothing is written — no log, no rating, no state change — so a slipped
   * finger costs a retype rather than a card.
   */
  const handleMistype = useCallback(() => {
    setAttempt(null);
    setIsRevealed(false);
    setAttemptSeq((n) => n + 1);
  }, []);

  /**
   * One rating, scheduled here on the device and queued for the server.
   *
   * Nothing is awaited. The card moves because the scheduler said so, not
   * because a round trip came back — which is what makes the session work in
   * a tunnel, and incidentally what makes it feel immediate on a good
   * connection. What the server eventually says replaces this.
   */
  const handleRate = useCallback(
    (rating: Rating) => {
      const item = queue[0];
      if (!item || !ready) return;
      // A wrong production answer is a miss; the buttons that would grade it
      // as anything else are not rendered, and not reachable by key.
      if (item.cardType === 'production' && attempt && !attempt.correct && rating !== 1) return;

      // Generated here so a retried send lands on the same row instead of
      // logging the review twice — and so undo knows which row to drop.
      const logId = crypto.randomUUID();
      const now = new Date();
      const { result, pending: entry } = rateLocally({
        logId,
        item,
        rating,
        now,
        requestRetention: session.requestRetention,
      });

      setError(null);
      setNotice(null);
      setIsRevealed(false);
      setAttempt(null);
      setEditing(false);
      // The leech prompt appears once, at six lapses. It is raised here
      // rather than waiting for the sync because the device already knows
      // both halves — see `rateLocally`.
      setLeeched(result.leech ? { ...item, state: result.state } : null);
      setAnswered((a) => [...a, { logId, item, rating }]);
      setCountedCards((c) => countCard(c, item));
      setQueue((q) => {
        const rest = q.slice(1);
        if (!result.repeat) return rest;
        // A learning step puts the card back a couple of cards later rather
        // than at the end: 1m and 10m are inside the session, not after it.
        const updated: ReviewItem = {
          ...item,
          isNew: false,
          state: result.state,
          previews: result.previews,
        };
        return [...rest.slice(0, LEARNING_GAP), updated, ...rest.slice(LEARNING_GAP)];
      });
      setUndoable({
        logId,
        item,
        rating,
        expiresAt: now.getTime() + UNDO_WINDOW_MS,
        counted: countedCards[item.cardId] === undefined,
      });

      void enqueue(entry, now.getTime()).then(async () => setPending(await pendingCount()));

      // A wrong answer worth a second look, but only if it was typed.
      // "Chưa nhớ ra" submits an empty attempt and is a miss, not a mix-up.
      // Whether it names another word is the server's question: the device has
      // the day's queue, not the collection.
      if (item.cardType === 'production' && attempt && !attempt.correct && attempt.input.trim()) {
        void noteConfusion({
          id: crypto.randomUUID(),
          cardId: item.cardId,
          typed: attempt.input,
          observedAt: now.toISOString(),
        });
      }
    },
    [queue, attempt, ready, session.requestRetention, countedCards],
  );

  /**
   * Undo, which now has a cheap case and an expensive one.
   *
   * The cheap case is the common one: the rating is still in the outbox,
   * because the flush holds entries back for exactly this window. Dropping it
   * there means nothing was ever written, so there is no log row to delete and
   * `review_logs` keeps its append-only property. The card comes
   * back carrying the state it had before — which is simply correct, since
   * nothing happened to it.
   *
   * The expensive case is a rating that already left the device — flushed from
   * another tab, or synced from another device. Then it costs the one deletion
   * the table permits: the server drops that row by id, refolds, and hands
   * back the state the shorter log implies. Not the values the client had
   * cached; those were a different card's worth of history.
   */
  const handleUndo = useCallback(() => {
    const last = undoable;
    if (!last) return;
    setUndoable(null);
    setError(null);
    setNotice(null);
    // The lapse that raised the leech prompt is the one being taken back, so
    // the prompt goes with it. Nothing was acknowledged, so it returns if the
    // card is failed again.
    setLeeched(null);

    const restore = (state: ReviewItem['state'], previews: ReviewItem['previews']) => {
      setAnswered((a) => a.filter((x) => x.logId !== last.logId));
      setIsRevealed(false);
      setAttempt(null);
      setEditing(false);
      setQueue((q) => [
        { ...last.item, state, previews },
        // A learning step may have put this card back further down; the undone
        // review is the reason it is there, so that copy goes too.
        ...q.filter((i) => i.cardId !== last.item.cardId),
      ]);
    };

    startTransition(async () => {
      if (await takeBack(last.logId)) {
        setPending(await pendingCount());
        if (last.counted) {
          setCountedCards(({ [last.item.cardId]: _undone, ...rest }) => rest);
        }
        restore(last.item.state, last.item.previews);
        return;
      }

      const result = await undoReview(last.logId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCountedCards(result.data.countedCards);
      restore(result.data.state, result.data.previews);
    });
  }, [undoable]);

  /** Edit mid-review. Server first: a failed save must not leave a lie on screen. */
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

  /**
   * The leech prompt, answered.
   *
   * Both ways out of it — saving a rewrite, or deciding the word is fine as
   * written — count as having read it, so both acknowledge. That is what turns
   * off the flag and takes the word's production card out of rotation; the
   * rewrite comes first for a reason, and a card retired before you had the
   * chance to fix its meaning is a card you never fixed.
   *
   * The acknowledgement is a server write and there is no offline path for it.
   * A dismissal with no signal closes the panel and changes nothing, so the
   * card is flagged again next session — which is the honest outcome for a
   * prompt that only the server can remember having shown once.
   */
  const handleLeechDone = useCallback(
    (patch?: ReviewEdit) => {
      const item = leeched;
      if (!item) return;
      setLeeched(null);

      startTransition(async () => {
        if (patch) {
          const saved = await updateWord({ id: item.word.id, ...patch });
          if (!saved.ok) {
            setError(saved.error);
            // The rewrite failed, so the prompt has not done its job. Put it
            // back rather than acknowledging a rewrite that did not happen.
            setLeeched(item);
            return;
          }
          const apply = (w: WordView): WordView =>
            w.id === item.word.id ? { ...w, ...patch } : w;
          setQueue((q) => q.map((i) => ({ ...i, word: apply(i.word) })));
          setAnswered((a) =>
            a.map((x) => ({ ...x, item: { ...x.item, word: apply(x.item.word) } })),
          );
        }

        const result = await acknowledgeLeech(item.cardId);
        if (!result.ok) {
          setNotice('Chưa lưu được dấu thẻ khó — sẽ nhắc lại ở phiên sau.');
          return;
        }
        setNotice(
          result.data.deactivatedProduction
            ? 'Thẻ gõ của từ này đã tạm nghỉ. Thẻ lật vẫn chạy tiếp.'
            : 'Đã ghi nhận thẻ khó.',
        );
      });
    },
    [leeched],
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
    // Two reasons not to announce the day is over yet. The resume decision may
    // still be pending, and the payload that rendered this page can be a
    // cached one whose queue was emptied hours ago — saying "done" and then
    // producing a card would be worse than a beat of waiting. An undo in
    // flight is the other: it puts a card straight back.
    if (!ready || saving) {
      return (
        <div className="w-full max-w-lg mx-auto py-16 px-6 text-center text-sm text-[var(--text-muted)]">
          Đang tải…
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
  // Only the card being asked to produce the word withholds it; a recognition
  // card typed for its reading shows the headword all along, which is what
  // makes it a reading test rather than a second production card.
  const showAnswerSide = !produceWord || isRevealed;
  // Quên-only belongs to the production card, not to the typing. Typing a
  // recognition card is a test you set yourself, and failing a harder test than
  // the card measures should not cost the card: the verdict is shown and all
  // four grades stay open.
  const wrongAnswer = currentWord.cardType === 'production' && attempt !== null && !attempt.correct;

  return (
    /*
      Fills the phone screen rather than demanding a fixed 580px. That minimum
      was written for a page that scrolled; inside the frame it is taller than
      the screen itself, which pushed the rating row off the bottom — the one
      control the session cannot work without. The progress bar and the ratings
      now stay put and the card scrolls between them.
    */
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col justify-between p-2">
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
          <SyncStatus online={online} pending={pending} syncing={syncing} />

          {/*
            The prototype's mode toggle, kept, but narrowed to what it can
            honestly mean here: recognition and production are two cards on the
            same word and the queue decides which one is in front of you, so
            this changes how the card is asked, never which card the rating
            lands on. Highlighted while the override is on, because then the
            label is no longer the queue's word for this card.
          */}
          <button
            type="button"
            onClick={toggleMode}
            disabled={isRevealed}
            className={`px-2.5 py-1 min-w-[6.5rem] justify-center rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:cursor-default disabled:opacity-60 ${
              modeOverride
                ? 'bg-[var(--bamboo-subtle)] border-[var(--bamboo-border)] text-[var(--bamboo)] font-semibold'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] enabled:hover:border-[var(--border-strong)]'
            } ${isRevealed ? '' : 'cursor-pointer'}`}
            title={
              isRevealed
                ? 'Đáp án đã hiện — đổi cách hỏi ở thẻ sau'
                : produceWord
                  ? 'Thẻ gõ — nhớ lại từ tiếng Nhật từ nghĩa tiếng Việt. Bấm để lật thẻ này thay vì gõ.'
                  : typing
                    ? 'Chế độ gõ — gõ cách đọc của từ đang hiện. Bấm để quay lại thẻ lật.'
                    : 'Thẻ lật — nhận mặt từ. Bấm để gõ cách đọc cho thẻ này.'
            }
          >
            {typing ? (
              <Keyboard className="w-3.5 h-3.5" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            <span>{produceWord ? 'Thẻ gõ' : typing ? 'Chế độ gõ' : 'Thẻ lật'}</span>
          </button>

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
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--bamboo)] cursor-pointer transition-[color,border-color,opacity] duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title={showAnswerSide ? 'Nghe phát âm' : 'Nghe phát âm sau khi trả lời'}
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* The prototype's toast slot: undo, then anything a write had to say. */}
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
        {leeched && (
          <LeechPanel
            key={`leech-${leeched.cardId}`}
            word={leeched.word}
            lapses={leeched.state.lapses}
            saving={saving}
            onSave={(patch) => handleLeechDone(patch)}
            onDismiss={() => handleLeechDone()}
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
          onClick={!isRevealed && !typing ? handleReveal : undefined}
          className={`w-full mt-3 flex-1 min-h-0 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 sm:p-7 flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-colors ${
            !isRevealed && !typing ? 'cursor-pointer hover:border-[var(--bamboo)]/50' : ''
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
          <div className="relative flex min-h-fit flex-1 flex-col justify-center py-6 text-center">
            {/*
              Switching into typing does not replace the word, it makes room:
              the word steps up, and the field opens outward from the middle
              underneath it.

              The step up is the layout's own — a centred column with a field
              added below it puts the word higher, and `layout` is what turns
              that jump into a movement. Animating `y` by hand on top of it
              would be a second, disagreeing answer to where the word goes.

              `popLayout` everywhere below, rather than `wait`, for the same
              reason: what is leaving drops out of the flow immediately, so the
              word begins moving on the frame the field arrives instead of
              waiting out a fade first. `wait` is what made this feel stepped.
            */}
            <motion.div
              layout
              transition={{ layout: { type: 'spring', stiffness: 240, damping: 30, mass: 0.8 } }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={showAnswerSide ? 'word' : 'meaning'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                >
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
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        Gõ từ tiếng Nhật tương ứng
                      </p>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>

            {/* The field, or the invitation to turn the card over */}
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
                    <AnswerInput
                      // The input is uncontrolled, so it has to be remounted
                      // rather than cleared. `done` matters as much as the card
                      // id: on a short queue a learning step can put the same
                      // card straight back, and without it React would reuse the
                      // node with the previous attempt still typed in.
                      key={`${currentWord.cardId}-${done}-${attemptSeq}`}
                      word={word}
                      expect={produceWord ? 'word' : 'reading'}
                      disabled={saving}
                      onAnswer={handleAnswer}
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
                    <Sparkles className="w-3.5 h-3.5 text-[var(--bamboo)]" />
                    <span>Chạm hoặc bấm Phím cách để xem đáp án</span>
                  </motion.div>
                ))}
            </AnimatePresence>
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
      <div className="relative mt-3 pt-1">
        {/*
          Whatever is under the card opens the same way the field does, so a
          mode switch reads as one movement instead of the card animating and
          its button cutting.
        */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={isRevealed ? (wrongAnswer ? 'miss' : 'ratings') : typing ? 'typing' : 'reveal'}
            initial={{ opacity: 0, clipPath: 'inset(0% 44% 0% 44%)' }}
            animate={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
            exit={{ opacity: 0, clipPath: 'inset(0% 44% 0% 44%)' }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            // The clip box is the border box, and the reveal button's shadow
            // falls outside it. Four pixels of padding, taken straight back as
            // margin, widen the box without moving anything in it.
            className="p-1 -m-1"
          >
            {!isRevealed ? (
              typing ? (
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
              /* A near miss is a miss, so Quên is the only grade on offer.
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
          </motion.div>
        </AnimatePresence>
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
 * cards already answered today, and there is no "study more" escape hatch.
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
