import type { RemainingWork, ReviewItem } from '@/lib/types';

/**
 * What the reviewer shows once the queue is empty.
 *
 * Six states off three inputs, kept out of the JSX because this is the part
 * that rots: every one of them used to be a branch inside `emptyBody`, and the
 * one that mattered most — "there is more, go and get it" — did not exist at
 * all while the caps were daily.
 */
export type FinishState =
  /** Nothing in the collection yet. */
  | { kind: 'empty-collection' }
  /** Opened with an empty queue and nothing answered: nothing is due. */
  | { kind: 'nothing-due'; nextDue: string | null }
  /** Finished a session, and there is more to deal. */
  | { kind: 'more-waiting'; remaining: RemainingWork; canDeal: boolean }
  /** Finished a session and cleared everything that was waiting. */
  | { kind: 'all-clear'; nextDue: string | null; outOfNewWords: boolean }
  /** The next session came back empty because the last ratings are still in flight. */
  | { kind: 'waiting-for-sync' };

export function finishState(input: {
  /** Showings answered in the session that just ended. */
  answered: number;
  totalCards: number;
  remaining: RemainingWork;
  nextDue: string | null;
  /**
   * Whether the next session can actually be dealt right now: online, or
   * holding a lookahead. Not simply "online" — a promoted session needs no
   * network, and telling someone on a train to find signal they do not need
   * would be a lie.
   */
  canDeal: boolean;
  /** A next session was asked for and every card in it was filtered out. */
  unsettled: boolean;
}): FinishState {
  if (input.totalCards === 0) return { kind: 'empty-collection' };
  if (input.unsettled) return { kind: 'waiting-for-sync' };

  const waiting = input.remaining.newCards + input.remaining.reviewCards > 0;
  if (input.answered === 0) {
    // Nothing was answered, so nothing was cleared: if anything is waiting it
    // is waiting because the budget did not reach it, not because you finished.
    return waiting
      ? { kind: 'more-waiting', remaining: input.remaining, canDeal: input.canDeal }
      : { kind: 'nothing-due', nextDue: input.nextDue };
  }

  return waiting
    ? { kind: 'more-waiting', remaining: input.remaining, canDeal: input.canDeal }
    : {
        kind: 'all-clear',
        nextDue: input.nextDue,
        outOfNewWords: input.remaining.newCards === 0,
      };
}

/**
 * Drop every showing of a card whose last rating the server cannot have seen.
 *
 * `flush` deliberately holds an entry back for the length of the undo window,
 * so the final ratings of a session are still local when the next one is
 * dealt — and a card the server has not heard about still has its old `due` in
 * the past, so the query hands it straight back. Without this you would be
 * re-shown a card you answered ten seconds ago, and answering it again would
 * write a second review.
 *
 * By card rather than by showing: both faces go together, because half a pair
 * is worse than neither. A card dropped here is not lost — it is dealt by the
 * session after this one, by which time its rating has landed.
 */
export function dropUnsettled(
  items: readonly ReviewItem[],
  unsettled: ReadonlySet<string>,
): ReviewItem[] {
  if (unsettled.size === 0) return [...items];
  return items.filter((item) => !unsettled.has(item.cardId));
}
