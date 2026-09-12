import { generatorParameters, type FSRSParameters } from 'ts-fsrs';

/**
 * §4's scheduler configuration, in exactly one place.
 *
 * `request_retention` is the only field the user can move (/settings); the
 * rest are fixed. Changing any of them reschedules the whole collection on the
 * next `npm run recompute`, because state is a fold over the log (§5) rather
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

/** §4: new cards are interleaved at most one per five reviews. */
export const NEW_PER_REVIEWS = 5;
