import { and, desc, eq, not, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getSettings } from '@/lib/db/queries';
import { hydrateQueue, inRotation, isNew } from '@/lib/db/review';
import { cardStates, cards, words } from '@/lib/db/schema';
import { startOfStudyDay } from '@/lib/fsrs/day';
import { schedulerParams } from '@/lib/fsrs/params';
import { expandFaces, type QueueEntry } from '@/lib/fsrs/queue';
import { practicePage } from '@/lib/practice';
import type { SessionView } from '@/lib/types';

/**
 * The practice queue: recent vocabulary, drilled on demand, scheduler ignored.
 *
 * The reviewer proper deals what is due. This deals what is *recent* — the
 * newest words you have already met, a page at a time, whatever their due
 * dates say. It exists for the time left over once the day's queue is clear,
 * which FSRS by design has nothing to offer.
 *
 * Nothing here writes, and nothing downstream of it does either: the session
 * it returns is handed to the same `ReviewScreen` with a recorder whose
 * `enqueue` is a no-op, so a rating given in practice reaches neither the
 * outbox nor `review_logs`. That is the whole contract of the mode, and it is
 * enforced on the client rather than here — this module only chooses cards.
 *
 * Deliberately *not* built with `buildQueue`/`sessionSlots`. Those exist to
 * split one budget between two competing streams and to pace new words among
 * reviews; practice has one stream, no reserve to hold and no interleave to
 * honour, so reusing them would mean passing zeroes through machinery that
 * then has nothing to decide.
 */

/** The page in hand and the one behind it, fetched together. */
const LOOKAHEAD_PAGES = 2;

/**
 * A page of practice, plus the page behind it.
 *
 * The lookahead is the same promise the reviewer makes: finishing a page with
 * no signal deals the next one locally rather than ending there. It costs one
 * `LIMIT` twice as wide, not a second query.
 *
 * Brand-new cards are excluded. A word never studied is the reviewer's job —
 * introducing it here would give it its first showing outside the scheduler,
 * with nothing written, which is the one case where "practice changes
 * nothing" is a loss rather than the point.
 */
export async function buildPracticeSession(
  requestedPage = 0,
  now = new Date(),
): Promise<SessionView> {
  const settings = await getSettings();
  const params = schedulerParams(settings.requestRetention);
  const cap = settings.practiceWords;

  /** In rotation, and met at least once. */
  const eligible = and(inRotation, not(isNew))!;

  const from = () =>
    db
      .select({
        cardId: cards.id,
        wordId: cards.wordId,
        leechAckedAt: cards.leechAckedAt,
        createdAt: words.createdAt,
      })
      .from(cards)
      .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
      .innerJoin(words, eq(words.id, cards.wordId));

  // Counted before the page is chosen, because the page number has to be
  // wrapped against something. One indexed aggregate, not a fetch.
  const [countRow] = await db
    .select({ seen: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(eligible);

  const seen = countRow?.seen ?? 0;
  const { page, pages } = practicePage(requestedPage, seen, cap);

  const rows =
    seen === 0
      ? []
      : await from()
          .where(eligible)
          // Newest first — and the same `sort_order` tiebreak the new-card
          // query uses, read backwards, so an import's own ordering survives
          // into the drill instead of falling through to the card's UUID.
          .orderBy(desc(words.createdAt), desc(words.sortOrder), desc(cards.id))
          .limit(LOOKAHEAD_PAGES * cap)
          .offset(page * cap);

  // One card per word is a unique index, so there is nothing to dedupe here —
  // the collision `buildQueue` guards against cannot arise.
  const entries = (slice: typeof rows): QueueEntry[] =>
    slice.map((row) => ({ cardId: row.cardId, wordId: row.wordId, isNew: false }));

  const meta = new Map(rows.map((row) => [row.cardId, row]));

  // Seeded by the study day like the reviewer, so a re-render before the queue
  // is stored deals the order already on screen — offset by the page, so two
  // pages read on the same day do not shuffle in lockstep.
  const seed = startOfStudyDay(now).getTime() + page;
  const [items, next] = await Promise.all([
    hydrateQueue(expandFaces(entries(rows.slice(0, cap)), seed), meta, params, now),
    hydrateQueue(expandFaces(entries(rows.slice(cap)), seed + 1), meta, params, now),
  ]);

  return {
    now: now.toISOString(),
    items,
    next,
    cardsPerSession: cap,
    requestRetention: settings.requestRetention,
    // Practice is never behind. There is no backlog to report and no date to
    // come back for — the next page is always available, which is what the
    // finish screen says instead.
    remaining: { newCards: 0, reviewCards: 0 },
    nextDue: null,
    // Words eligible for practice, not the whole collection: it is what
    // `empty-collection` has to be true about on this screen.
    totalCards: seen,
    practice: { page, pages },
  };
}
