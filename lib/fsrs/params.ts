import { generatorParameters, type FSRSParameters } from 'ts-fsrs';

/**
 * The scheduler configuration, in exactly one place.
 *
 * `request_retention` is the only field the user can move (/settings); the
 * rest are fixed. Changing any of them reschedules the whole collection on the
 * next `npm run recompute`, because state is a fold over the log rather
 * than something accumulated in place.
 */
export const MAXIMUM_INTERVAL = 365;
export const LEARNING_STEPS = ['1m', '10m'] as const;
export const RELEARNING_STEPS = ['10m'] as const;
export const DEFAULT_REQUEST_RETENTION = 0.9;

export function schedulerParams(
  requestRetention: number = DEFAULT_REQUEST_RETENTION,
): FSRSParameters {
  return generatorParameters({
    request_retention: requestRetention,
    maximum_interval: MAXIMUM_INTERVAL,
    enable_fuzz: true,
    // Learning and relearning steps only apply while this is on.
    enable_short_term: true,
    learning_steps: LEARNING_STEPS,
    relearning_steps: RELEARNING_STEPS,
  });
}

/**
 * How far ahead a card still counts as part of the running session. A card put
 * back by a learning step (1m, 10m) returns within the session; anything
 * scheduled beyond this leaves it.
 */
export const LEARN_AHEAD_MINUTES = 20;

/** New cards are interleaved at most one per five reviews. */
export const NEW_PER_REVIEWS = 5;

/**
 * The share of a session held for new words whenever any are waiting.
 *
 * Reviews claim slots first — a due review is a memory already decaying, and
 * letting it lapse resets its interval, which manufactures more reviews. But
 * reviews-first with nothing reserved means a backlog blocks an import for
 * days, so a fifth of the session is kept back for new words.
 */
export const NEW_SHARE = 0.2;

/**
 * How far behind reviews must fall before new words stop being introduced,
 * counted in sessions' worth of due cards.
 *
 * Not a daily cap: there is no counter and nothing resets at the rollover. It
 * is the one brake on a per-session model, where ten sittings in an afternoon
 * would otherwise introduce ten batches of new words that all come due
 * together two days later.
 */
export const BACKLOG_SESSIONS = 2;

/**
 * The leech threshold: six lapses on one card.
 *
 * `card_states.lapses` is folded from the log like everything else, so
 * this is a reading of the history rather than a counter anything increments.
 * What the log cannot say is whether the prompt has already been shown — that
 * is `cards.leech_acked_at`, and it is why the prompt only ever flags a card once.
 */
export const LEECH_LAPSES = 6;
