import { formatInterval } from '@/lib/fsrs/format';
import { LEARN_AHEAD_MINUTES } from '@/lib/fsrs/params';
import {
  State,
  previewDueDates,
  type Card,
  type RatingValue,
} from '@/lib/fsrs/replay';
import type { CardStateView, RatingPreviews } from '@/lib/types';

import type { FSRSParameters } from 'ts-fsrs';

/**
 * The wire shape of a folded card, and the way back to a real ts-fsrs `Card`.
 *
 * Pure and free of `lib/db`, because the scheduler runs client-side: the
 * browser has to rebuild a `Card` from what the session payload carried and
 * step it forward with no server in reach.
 *
 * Note what this is *not*. `card_states` — the table — still stores only a
 * few plain columns, and `learning_steps` is still deliberately absent from it
 * (a step index the log already determines). `CardStateView` is the projection
 * on the wire, produced by a fold that just ran, so carrying the step costs
 * nothing and saves the client from folding a log it does not have.
 */

export function toStateView(card: Card): CardStateView {
  const isNew = card.state === State.New;
  return {
    due: card.due.toISOString(),
    // ts-fsrs reports 0/0 for an untouched card; "not measured yet" is not the
    // same thing as zero, and the columns are nullable for that reason.
    stability: isNew ? null : card.stability,
    difficulty: isNew ? null : card.difficulty,
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review?.toISOString() ?? null,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
  };
}

/** The inverse. `toStateView(toCard(v))` is `v`, which is what makes offline scheduling safe. */
export function toCard(view: CardStateView): Card {
  return {
    due: new Date(view.due),
    stability: view.stability ?? 0,
    difficulty: view.difficulty ?? 0,
    elapsed_days: view.elapsedDays,
    scheduled_days: view.scheduledDays,
    learning_steps: view.learningSteps,
    reps: view.reps,
    lapses: view.lapses,
    state: view.state,
    last_review: view.lastReview ? new Date(view.lastReview) : undefined,
  };
}

/** The four rating buttons and what each would schedule ("10 phút", "2 ngày"). */
export function toPreviews(card: Card, now: Date, params: FSRSParameters): RatingPreviews {
  const due = previewDueDates(card, now, params);
  const at = (r: RatingValue) => formatInterval(due[r].getTime() - now.getTime());
  return { 1: at(1), 2: at(2), 3: at(3), 4: at(4) };
}

/**
 * A card put back by a learning step returns inside the session; anything
 * further out leaves it. Shared, because the client decides this offline and
 * the server decides it at sync — from the same threshold.
 */
export function staysInSession(card: Card, now: Date): boolean {
  return card.due.getTime() - now.getTime() <= LEARN_AHEAD_MINUTES * 60_000;
}
