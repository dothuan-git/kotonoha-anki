'use client';

import {
  Check,
  CheckCircle2,
  Copy,
  Keyboard,
  Pencil,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { AnswerInput } from '@/components/AnswerInput';
import { LeechPanel } from '@/components/LeechPanel';
import { ReviewEditPanel, type ReviewEdit } from '@/components/ReviewEditPanel';
import { Ruby } from '@/components/Ruby';
import { SyncStatus } from '@/components/SyncStatus';
import { UndoToast } from '@/components/UndoToast';
import { acknowledgeLeech } from '@/lib/actions/leech';
import { undoReview } from '@/lib/actions/review';
import { updateWord } from '@/lib/actions/words';
import { playSentenceAudio, playWordAudio } from '@/lib/client/audio';
import { useOnline } from '@/lib/client/online';
import { enqueue, flush, noteConfusion, pendingCount, takeBack } from '@/lib/client/outbox';
import { chooseSession, loadSession, saveSession } from '@/lib/client/session';
import { STUDY_TIME_ZONE } from '@/lib/fsrs/day';
import { formatDueIn } from '@/lib/fsrs/format';
import { countCard, rateLocally } from '@/lib/fsrs/local';
import { resolvePair, revises, type PriorGrade } from '@/lib/fsrs/pair';
import { repeatSlot } from '@/lib/fsrs/queue';
import { mergeMissed, missedWords, toCsv, type MissedWord } from '@/lib/recap';
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


/** The prototype's rating row, unchanged. */
const RATING_STYLES: Record<Rating, string> = {
  1: 'border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20',
  2: 'border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
  3: 'border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-[var(--bamboo)] hover:opacity-90',
  4: 'bg-[var(--bamboo)] text-white hover:opacity-90 shadow-xs',
};

const ALL_RATINGS = [1, 2, 3, 4] as const;

interface Answered {
  /**
   * `review_logs.id` — what undo deletes. Both faces of a word point at the
   * same row, because the pair is one review.
   */
  logId: string;
  item: ReviewItem;
  rating: Rating;
}

/** A typed answer, already judged by the answer matcher. */
interface Attempt {
  input: string;
  correct: boolean;
  /** Tries spent getting here, out of `MAX_ANSWER_ATTEMPTS`. */
  attempts: number;
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
  /**
   * This rating replaced a better one from the word's other face, so undoing
   * it does not mean "no review": it means the grade the word had before this
   * showing revised it. Absent on an ordinary first-face rating, which has
   * nothing behind it.
   */
  reinstate?: PriorGrade & { item: ReviewItem };
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
 * put back by a learning step re-enters the queue as far down as its step is
 * long, rather than advancing an index that only moves forward.
 *
 * A word is asked twice in a session and graded once. The queue deals each
 * card from both sides — the Japanese word, and its meaning — shuffled and
 * kept apart; the first side answered writes the review, and if the second
 * comes back worse it replaces that grade rather than adding a second review.
 * See `lib/fsrs/pair.ts`.
 *
 * Either side can be typed instead of turned over. A typed answer goes through
 * the exact answer matcher and gets three tries before the card gives it up;
 * every grade is then on offer, because only the person typing knows whether
 * the third miss was a slip or a word they have lost. "Gõ nhầm" is there for
 * when it was a slip, and writes nothing at all.
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
   * Typing the answer instead of turning the card over.
   *
   * Both faces are flashcards by default — look, recall, turn over, grade
   * yourself — and this is the opt-in to typing the answer instead. It holds
   * for the rest of the session: choosing to type is a statement about how
   * you want to study, not about the one card that happened to be in front
   * of you when you reached for the toggle. The queue still decides which
   * card that is, which way round it is asked, and which card the rating is
   * written to.
   *
   * Session state, like the font toggle — a reload starts back on flip cards.
   */
  const [typing, setTyping] = useState(false);
  /**
   * What each word has already been graded this session, by card.
   *
   * A word is asked twice and graded once, so the second face has to know what
   * the first one wrote: the row's id, the rating, and the item as it stood
   * *before* that rating — which is what a replacement is applied to, since
   * the point is to schedule the card as though the worse grade had been the
   * only one. See `lib/fsrs/pair.ts`.
   */
  const [graded, setGraded] = useState<Record<string, PriorGrade & { item: ReviewItem }>>({});
  /**
   * The recap this study day already had before this session opened.
   *
   * Read once, on mount, and never written to again — what this session adds
   * is derived from `answered` instead, so an undo takes a word back out of
   * the list the same tick it takes back the review. Sessions earlier in the
   * day are past undoing, which is exactly why they can be a flat list.
   */
  const [dayMissed, setDayMissed] = useState<MissedWord[]>([]);
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
  /**
   * The day's recap: every word graded Quên or Khó, this session's and the
   * ones before it folded together.
   *
   * Over `answered` rather than `graded` on purpose. `graded` holds the review
   * the scheduler is acting on, and a learning step overwrites it — forget a
   * word at 09:00, walk it back through 1m and 10m, and what stands is a
   * "Được" for a word you plainly did not know. Every showing counts here.
   */
  const missed = useMemo(
    () => mergeMissed(dayMissed, missedWords(answered)),
    [dayMissed, answered],
  );
  const currentWord = queue[0];
  /**
   * Which way round this showing is asked, and what it wants typed.
   *
   * The face comes from the queue and is not negotiable — it is half of what
   * makes the session twenty cards rather than ten. What *is* negotiable is
   * how you answer: turn it over, or type it.
   *
   * Typing means a different question on each face, which is why `expecting`
   * is derived from the face rather than chosen. With the meaning on screen
   * the answer is the word, and the kanji or the kana will both do. With the
   * word on screen the only thing left to ask is its reading — accepting the
   * headword there would be marking the card's own prompt correct.
   */
  const face = currentWord?.face ?? 'word';
  const expecting: 'word' | 'reading' = face === 'meaning' ? 'word' : 'reading';

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
      // Permanently refused, for one of two reasons: the card was deleted or
      // suspended between the rating and the sync, or a pair correction lost
      // the race against a newer real review of the same card. Naming just
      // the first would be wrong for the second, so this stays general.
      // Saying so at all is the honest option — the alternative is an outbox
      // that quietly never empties.
      setError(`${result.rejected.length} lượt ôn không gửi được.`);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      // A word still in the queue may yet be revised by its other face, but
      // that no longer holds the rating back — see `flush`. A correction
      // reaches the server the same way this one did, queued under the same
      // id, whenever its own turn comes.
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
        stored: stored?.session ?? null,
        pendingCount: waiting,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
        now,
      });

      // Half-graded words belong to the queue they were graded in. Resuming
      // keeps them, so a word's second face still revises the review its first
      // one wrote — `chooseSession` resumes an unfinished stored session
      // precisely so this is never dropped just because the first face's
      // rating already reached the server on its own.
      const resumed = chosen.source === 'resumed' ? (stored?.graded ?? {}) : {};
      // The recap is kept whichever queue won, unlike `graded` above. A word
      // half-graded belongs to the session it was dealt in; a word forgotten
      // belongs to the day. Dropping it on a fresh server queue would empty
      // the recap in precisely the case it exists for — finish the morning's
      // cards, come back at noon to nothing due.
      const earlier = stored?.missed ?? [];

      setSession(chosen.session);
      setQueue(chosen.session.items);
      setCountedCards(chosen.session.countedCards);
      setGraded(resumed);
      setDayMissed(earlier);
      setPending(waiting);
      setReady(true);
      await saveSession(chosen.session, resumed, earlier, now);
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
    void saveSession({ ...session, items: queue, countedCards }, graded, missed);
  }, [ready, session, queue, countedCards, graded, missed]);

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
   * Switch how answers are given: type them instead of turning the card over,
   * or the reverse. Only before the answer is on screen — afterwards there is
   * nothing left to ask, and the switch would land on a card already graded.
   */
  const toggleMode = useCallback(() => {
    if (isRevealed) return;
    setAttempt(null);
    setAttemptSeq((n) => n + 1);
    setTyping((v) => !v);
  }, [isRevealed]);

  const handleReveal = useCallback(() => {
    if (!currentWord || typing) return;
    setIsRevealed(true);
    playWordAudio(currentWord.word);
  }, [currentWord, typing]);

  /**
   * The card is done being typed at — right, out of tries, or given up on.
   * A wrong answer with tries left never reaches here: the field keeps it.
   */
  const handleAnswer = useCallback(
    (result: Attempt) => {
      setAttempt(result);
      setIsRevealed(true);
      if (currentWord) playWordAudio(currentWord.word);
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
   *
   * A word is asked twice and graded once, so this has two shapes. The first
   * face of a card writes the review, exactly as a single-card session always
   * did. The second face grades the same word again, and what happens then is
   * `resolvePair`: a grade as good or better leaves the review alone, and a
   * worse one takes it back and writes itself in its place. The second is only
   * cheap because `flush` held the first rating back while this showing was
   * still outstanding — nothing was sent, so nothing has to be deleted.
   */
  const handleRate = useCallback(
    (rating: Rating) => {
      const item = queue[0];
      if (!item || !ready) return;

      const now = new Date();
      // The review standing for this word, if this showing revises it rather
      // than adding to it — a learning-step repeat is an ordinary second
      // review wherever in the queue it landed, which is why `item.repeat`
      // and not the face is what `revises` reads.
      const standing = graded[item.cardId];
      const prior = standing && revises(standing, item) ? standing : undefined;

      setError(null);
      setNotice(null);
      setIsRevealed(false);
      setAttempt(null);
      setEditing(false);

      /**
       * Drop the showing that was just answered, and put it back if it repeats.
       *
       * Where it goes is the card's own step, spent in showings — `repeatSlot`.
       * `state.due` is the scheduler's answer and is not negotiated here; this
       * only decides which questions fill the wait.
       */
      const advance = (repeat: ReviewItem | null) => {
        setQueue((q) => {
          const rest = q.slice(1);
          if (!repeat) return rest;
          const at = repeatSlot(new Date(repeat.state.due).getTime() - now.getTime(), rest.length);
          return [...rest.slice(0, at), { ...repeat, repeat: true }, ...rest.slice(at)];
        });
      };

      // A wrong typed answer worth a second look. "Chưa nhớ ra" submits an
      // empty attempt and is a miss, not a mix-up. Whether it names another
      // word is the server's question: the device has the day's queue, not the
      // collection. Asked from the meaning only — a wrong *reading* typed with
      // the word on screen is not a word you confused this one with.
      if (item.face === 'meaning' && attempt && !attempt.correct && attempt.input.trim()) {
        void noteConfusion({
          id: crypto.randomUUID(),
          cardId: item.cardId,
          typed: attempt.input,
          observedAt: now.toISOString(),
        });
      }

      if (prior) {
        const outcome = resolvePair(prior, rating);
        setAnswered((a) => [...a, { logId: prior.logId, item, rating }]);

        if (outcome.action === 'keep') {
          // Nothing is written: the word has already had its review today, and
          // this answer was no worse. Said out loud, because pressing Dễ and
          // watching nothing happen to the schedule deserves an explanation.
          if (rating !== prior.rating) {
            setNotice(
              `Đã giữ điểm "${RATING_LABELS[prior.rating - 1]}" của mặt trước — mỗi từ tính một lần mỗi ngày.`,
            );
          }
          // Nothing was written, so there is nothing to take back. Any prompt
          // left over from the card before goes, the way every rating clears it.
          setLeeched(null);
          setUndoable(null);
          advance(null);
          return;
        }

        // Worse, so it becomes the word's grade. Applied to the state the card
        // had *before* its first face, because the point is to schedule it as
        // though this had been the only review.
        const { result, pending: entry } = rateLocally({
          logId: prior.logId,
          item: prior.item,
          rating: outcome.rating,
          now,
          requestRetention: session.requestRetention,
        });

        setLeeched(result.leech ? { ...item, state: result.state } : null);
        setGraded((g) => ({
          ...g,
          [item.cardId]: {
            logId: prior.logId,
            rating: outcome.rating,
            item: prior.item,
            face: item.face,
          },
        }));
        advance(
          result.repeat
            ? { ...item, isNew: false, state: result.state, previews: result.previews }
            : null,
        );
        // The first face's own repeat may still be waiting further down the
        // queue, carrying the state this correction has just replaced. The log
        // it will write is a rating and a time, so the server's fold is right
        // either way; this is so the buttons it comes back wearing are.
        setQueue((q) =>
          q.map((showing) =>
            showing.cardId === item.cardId
              ? { ...showing, state: result.state, previews: result.previews }
              : showing,
          ),
        );
        setUndoable({
          logId: prior.logId,
          item,
          rating: outcome.rating,
          expiresAt: now.getTime() + UNDO_WINDOW_MS,
          // The first face already spent the card's slot for today.
          counted: false,
          reinstate: prior,
        });

        void (async () => {
          // Try the free path first, on the chance the first face's rating is
          // still sitting inside its own ten-second window. Once that window
          // has closed — the ordinary case, since a rating no longer waits
          // for its twin to leave the outbox — `takeBack` finds nothing, and
          // `entry` is queued anyway under the same id: `applyReview` on the
          // server now knows a review under an id it has already seen, priced
          // differently, is this correction rather than a duplicate.
          await takeBack(prior.logId);
          await enqueue(entry, now.getTime());
          setPending(await pendingCount());
        })();
        return;
      }

      // The first face of this card today: an ordinary review.
      //
      // The id is generated here so a retried send lands on the same row
      // instead of logging the review twice — and so undo, and the pair
      // correction above, know which row they are talking about.
      const logId = crypto.randomUUID();
      const { result, pending: entry } = rateLocally({
        logId,
        item,
        rating,
        now,
        requestRetention: session.requestRetention,
      });

      // The leech prompt appears once, at six lapses. It is raised here
      // rather than waiting for the sync because the device already knows
      // both halves — see `rateLocally`.
      setLeeched(result.leech ? { ...item, state: result.state } : null);
      setAnswered((a) => [...a, { logId, item, rating }]);
      setCountedCards((c) => countCard(c, item));
      setGraded((g) => ({ ...g, [item.cardId]: { logId, rating, item, face: item.face } }));
      advance(
        result.repeat
          ? { ...item, isNew: false, state: result.state, previews: result.previews }
          : null,
      );
      setUndoable({
        logId,
        item,
        rating,
        expiresAt: now.getTime() + UNDO_WINDOW_MS,
        counted: countedCards[item.cardId] === undefined,
      });

      void enqueue(entry, now.getTime()).then(async () => setPending(await pendingCount()));
    },
    [queue, attempt, graded, ready, session.requestRetention, countedCards],
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

    const sameShowing = (i: { cardId: string; face: ReviewItem['face'] }) =>
      i.cardId === last.item.cardId && i.face === last.item.face;

    const restore = (state: ReviewItem['state'], previews: ReviewItem['previews']) => {
      setAnswered((a) => a.filter((x) => !(x.logId === last.logId && sameShowing(x.item))));
      setIsRevealed(false);
      setAttempt(null);
      setEditing(false);
      setQueue((q) => [
        { ...last.item, state, previews },
        // A learning step may have put this showing back further down; the
        // undone review is the reason it is there, so that copy goes too. The
        // word's *other* face is a different question and stays where it is.
        ...q.filter((i) => !sameShowing(i)),
      ]);
    };

    startTransition(async () => {
      if (await takeBack(last.logId)) {
        const reinstate = last.reinstate;
        if (reinstate) {
          // This rating replaced the one the word's other face gave it. Taking
          // it back means that grade stands again — not that the word went
          // unreviewed — so it is queued afresh under its own id and the card
          // goes back to the state it implies.
          const { result, pending: entry } = rateLocally({
            logId: reinstate.logId,
            item: reinstate.item,
            rating: reinstate.rating,
            now: new Date(),
            requestRetention: session.requestRetention,
          });
          await enqueue(entry, Date.now());
          setGraded((g) => ({ ...g, [last.item.cardId]: reinstate }));
          setPending(await pendingCount());
          restore(result.state, result.previews);
          return;
        }

        setPending(await pendingCount());
        setGraded(({ [last.item.cardId]: _ungraded, ...rest }) => rest);
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
  }, [undoable, session.requestRetention]);

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
   * off the flag; the rewrite comes first for a reason, and a prompt that
   * closed before you had the chance to fix the meaning is a meaning you never
   * fixed.
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
        setNotice('Đã ghi nhận thẻ khó.');
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
        missed={missed}
      />
    ) : (
      // The recap rides the empty screen too. Reopening at noon with nothing
      // due is not an empty day — it is a finished one, and the words it cost
      // are still the answer to "what should I look at again".
      <Finished
        title={emptyTitle(session)}
        body={emptyBody(session)}
        session={session}
        missed={missed}
      />
    );
  }

  const { word } = currentWord;
  const total = answered.length + queue.length;
  const done = answered.length;
  const hanViet = formatHanViet(word.kanji);
  // The prompt side never changes once the card is on screen: the face decides
  // it, and revealing adds the answer underneath rather than turning the card
  // over. So a meaning card still reads as the meaning after you have answered
  // it, with the word it was asking for below.
  const asking = face === 'meaning';
  // Hearing the word before you have recalled it is the answer, out loud.
  const canHearWord = !asking || isRevealed;
  // A typed attempt that ran out of tries. Every grade stays on offer — the
  // grading is yours, here as everywhere — but "gõ nhầm" is offered alongside
  // them, because three wrong spellings of a word you knew is the one case
  // where the honest answer is that no review happened at all.
  const missedAnswer = attempt !== null && !attempt.correct;
  /**
   * The answer, in rows, ordered so the thing the card actually asked for
   * comes first and the half already on the prompt side never repeats.
   *
   * Hán Việt is not a row. The word card already wears it as a tag above its
   * headword, so a row would be the same fact twice; the meaning card has no
   * headword up there to hang it on, so it goes under the rows instead.
   */
  const revealedRows: RevealedRow[] = asking
    ? [
        { label: 'Từ tiếng Nhật', value: word.headword, kind: 'headword' },
        // A kana-only word is its own reading. Printing it twice under two
        // labels reads as a mistake rather than as a fact about the word.
        ...(word.reading === word.headword
          ? []
          : [{ label: 'Cách đọc', value: word.reading, kind: 'reading' as const }]),
      ]
    : [
        { label: 'Cách đọc', value: word.reading, kind: 'reading' },
        { label: 'Nghĩa tiếng Việt', value: word.meaning, kind: 'vietnamese' },
      ];

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
            The prototype's mode toggle, kept, and now saying one thing only:
            turn this card over, or type the answer. Which way round the card
            is asked belongs to the queue — a word is asked both ways in the
            same session — so this cannot change the question, only how you
            answer it. Highlighted while typing is on, and it stays on until
            it is switched back.
          */}
          <button
            type="button"
            onClick={toggleMode}
            disabled={isRevealed}
            aria-pressed={typing}
            className={`px-2.5 py-1 min-w-[6.5rem] justify-center rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:cursor-default disabled:opacity-60 ${
              typing
                ? 'bg-[var(--bamboo-subtle)] border-[var(--bamboo-border)] text-[var(--bamboo)] font-semibold'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] enabled:hover:border-[var(--border-strong)]'
            } ${isRevealed ? '' : 'cursor-pointer'}`}
            title={
              isRevealed
                ? 'Đáp án đã hiện — đổi cách trả lời ở thẻ sau'
                : typing
                  ? asking
                    ? 'Chế độ gõ — gõ từ tiếng Nhật bằng kanji hoặc hiragana. Bấm để quay lại thẻ lật.'
                    : 'Chế độ gõ — gõ cách đọc của từ đang hiện. Bấm để quay lại thẻ lật.'
                  : asking
                    ? 'Thẻ lật — nhớ lại từ rồi lật xem. Bấm để chuyển sang gõ đáp án.'
                    : 'Thẻ lật — nhận mặt từ. Bấm để chuyển sang gõ cách đọc.'
            }
          >
            {typing ? (
              <Keyboard className="w-3.5 h-3.5" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            <span>{typing ? 'Chế độ gõ' : 'Thẻ lật'}</span>
          </button>

          {/* Editing before the answer is on screen would give the card away. */}
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

            {/*
              The card's own controls: how the word is set, and how it sounds.
              The speaker sits here rather than up in the session bar because
              both of these act on the word in front of you, while everything
              in that bar — progress, sync, the answer mode — acts on the
              session. Sorting them that way puts each control next to the
              thing it changes.
            */}
            <div className="flex items-center gap-1.5">
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

              {/*
                Gated by `canHearWord`, and the click stops here: the card
                itself is the reveal target, so a speaker that bubbled would
                turn the card over on its way to making a sound.
              */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playWordAudio(word);
                }}
                disabled={!canHearWord}
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--bamboo)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                title={canHearWord ? 'Nghe phát âm' : 'Nghe phát âm sau khi trả lời'}
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </div>
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
                  key={asking ? 'meaning' : 'word'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                >
                  {asking ? (
                    <>
                      <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                        Nghĩa tiếng Việt
                      </span>
                      <p className="mt-1.5 text-3xl sm:text-4xl font-bold leading-snug text-[var(--text-primary)]">
                        {word.meaning}
                      </p>
                      {!isRevealed && (
                        <p className="mt-2 text-xs text-[var(--text-muted)]">
                          {typing
                            ? 'Gõ từ tiếng Nhật — kanji hoặc hiragana đều được'
                            : 'Nhớ lại từ tiếng Nhật'}
                        </p>
                      )}
                    </>
                  ) : (
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
                          <HanVietTag hanViet={hanViet} />
                        </div>
                      )}
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
                      // rather than cleared — and the tries spent live inside
                      // it, so a reused node would carry them to the next card.
                      // `done` matters as much as the card id: on a short queue
                      // a learning step can put the same showing straight back.
                      key={`${currentWord.cardId}-${currentWord.face}-${done}-${attemptSeq}`}
                      word={word}
                      expect={expecting}
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

                {/*
                  What the card was asking for, which is the half that is not
                  already above. Both faces go through the same rows in a
                  different order — see `RevealedRows`, which is what keeps
                  them from drifting into two layouts again.
                */}
                <RevealedRows rows={revealedRows} fontStyle={fontStyle} />
                {asking && hanViet !== '—' && (
                  <div>
                    <HanVietTag hanViet={hanViet} />
                  </div>
                )}

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
                          playSentenceAudio(sentence);
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
            key={isRevealed ? 'ratings' : typing ? 'typing' : 'reveal'}
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
            ) : (
              /*
                Every grade, every time. The card does not decide what a review
                was worth — three wrong tries and a right one on the first go
                both end here, with the same four buttons, because only the
                person who typed knows which of those was a slip and which was
                a word they have lost.
              */
              <div className="space-y-2">
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
                      <span className="text-[10px] opacity-70 font-normal mt-0.5">
                        Phím {rating}
                      </span>
                    </motion.button>
                  ))}
                </div>

                {/*
                  The escape hatch, and the only button here that writes
                  nothing at all: no rating, no log row, no state change. For
                  the answer you had and mistyped three times.
                */}
                {missedAnswer && (
                  <button
                    type="button"
                    onClick={handleMistype}
                    title="Bỏ qua lần gõ này, không ghi vào lịch sử ôn tập"
                    className="w-full rounded-xl border border-[var(--border-subtle)] py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors cursor-pointer hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  >
                    Gõ nhầm — gõ lại, không tính
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * One line of the answer: what it is called, and what it says.
 *
 * `kind` rather than a className, because the whole point of routing both
 * faces through one component is that neither of them can restyle its own
 * copy. A reading looks like a reading whichever side of the card asked for it.
 */
interface RevealedRow {
  label: string;
  value: string;
  kind: 'headword' | 'reading' | 'vietnamese';
}

/**
 * The size a Japanese value is set at — a headword or a reading, on either
 * face. One constant rather than the same two classes written twice, because
 * two strings that happen to agree are two chances to disagree later.
 *
 * The Vietnamese gloss keeps its own smaller size below. That is the word
 * card's scale, unchanged; what moved is the meaning card, which had been
 * setting its headword a step larger than anything the word card ever used.
 */
const JP_ROW_SIZE = 'text-xl sm:text-2xl';

const ROW_STYLES: Record<RevealedRow['kind'], string> = {
  headword: `${JP_ROW_SIZE} text-[var(--text-primary)] select-all`,
  reading: `font-jp-serif ${JP_ROW_SIZE} font-semibold tracking-wide text-[var(--bamboo)]`,
  vietnamese: 'text-base font-semibold leading-snug text-[var(--text-primary)]',
};

/**
 * The answer, once the card has given it up.
 *
 * Both faces render through here and differ only in which rows they pass and
 * in what order: the word card asks for a reading and shows the meaning under
 * it, the meaning card asks for the word and shows its reading under that.
 *
 * They used to be two hand-written blocks, and had drifted into two layouts
 * with two sets of sizes for the same three facts — a grouped stack with one
 * speaker on one side, labelled rows with their own speakers on the other.
 * Which rows appear is the caller's business; how a row looks is not.
 */
function RevealedRows({
  rows,
  fontStyle,
}: {
  rows: readonly RevealedRow[];
  fontStyle: 'mincho' | 'gothic';
}) {
  const jpWeight =
    fontStyle === 'mincho'
      ? 'font-jp-serif font-medium tracking-wide'
      : 'font-jp-sans font-bold tracking-tight';

  return (
    <>
      {rows.map(({ label, value, kind }) => (
        <div key={label} className="min-w-0">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
          <p className={`mt-0.5 ${ROW_STYLES[kind]} ${kind === 'headword' ? jpWeight : ''}`}>
            {value}
          </p>
        </div>
      ))}
    </>
  );
}

/** `開 KHAI · 始 THỦY`, in the one shape both faces use for it. */
function HanVietTag({ hanViet }: { hanViet: string }) {
  return (
    <span className="inline-block rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
      Hán Việt: {hanViet}
    </span>
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
        {/* Which try it took, because it is the thing the grade should turn
            on and the only record of it is about to disappear. */}
        {attempt.attempts > 1 && (
          <span className="font-normal opacity-80">— lượt thứ {attempt.attempts}</span>
        )}
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
  missed,
}: {
  title: string;
  body: string;
  session: SessionView;
  missed: MissedWord[];
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

      {missed.length > 0 && <Recap words={missed} />}

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

/**
 * The day's misses, and a way to take them somewhere else.
 *
 * Three fields and no fourth. The grade is not a column because the list is
 * already ordered by it — Quên before Khó — and a badge on every row would
 * make the loudest thing on the screen the scoring rather than the words.
 *
 * The CSV is on the page whether or not the button works. `navigator.clipboard`
 * is absent outside a secure context and can reject inside one, and a copy
 * button that fails silently on a list you are about to close is a list lost.
 */
function Recap({ words }: { words: MissedWord[] }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const csv = toCsv(words);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(csv);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Cần ôn thêm</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {words.length} từ bạn chấm Quên hoặc Khó hôm nay.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            copied
              ? 'border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-[var(--bamboo)]'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Đã sao chép' : 'Sao chép CSV'}</span>
        </button>
      </div>

      {copyFailed && (
        <p className="mt-2 text-[11px] text-[var(--danger)]">
          Không sao chép được — hãy mở “Xem CSV” bên dưới và chọn thủ công.
        </p>
      )}

      <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
        {words.map((word) => (
          <li key={word.cardId} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="font-jp-serif text-base text-[var(--text-primary)]">{word.headword}</p>
              {/* A kana-only word is its own reading; printing it twice reads
                  as a mistake rather than as a fact about the word. */}
              {word.reading !== word.headword && (
                <p className="mt-0.5 font-jp-sans text-xs text-[var(--text-muted)]">
                  {word.reading}
                </p>
              )}
            </div>
            <p className="max-w-[55%] shrink-0 text-right text-xs text-[var(--text-secondary)]">
              {word.meaning}
            </p>
          </li>
        ))}
      </ul>

      <details className="mt-3 border-t border-[var(--border-subtle)] pt-2">
        <summary className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          Xem CSV
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--bg-muted)] p-2 text-[11px] whitespace-pre text-[var(--text-secondary)]">
          {csv}
        </pre>
      </details>
    </section>
  );
}

function summarise(answered: Answered[], counts: DailyCounts, session: SessionView): string {
  // Words, not showings: each was asked twice and graded once, so counting
  // the answers would report a session twice the size of the work done.
  const cards = new Set(answered.map((a) => a.item.cardId)).size;
  const forgotten = answered.filter((a) => a.rating === 1).length;
  const forgot = forgotten > 0 ? `, ${forgotten} lượt quên` : '';
  // A lifted cap has no "/N" to report against — the count stands alone.
  const newLine = session.limits.unlimited
    ? `${counts.newCards} từ mới`
    : `${counts.newCards}/${session.limits.newPerDay} từ mới`;
  const reviewLine = session.limits.unlimited
    ? `${counts.reviewCards} lượt ôn`
    : `${counts.reviewCards}/${session.limits.reviewsPerDay} lượt ôn`;
  return (
    `${cards} từ, ${answered.length} lượt chấm${forgot}. ` +
    `Hôm nay đã học ${newLine} và ${reviewLine}.`
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
