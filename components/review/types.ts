/** A typed answer, already judged by the answer matcher. */
export interface Attempt {
  input: string;
  correct: boolean;
  /** Tries spent getting here, out of `MAX_ANSWER_ATTEMPTS`. */
  attempts: number;
}

/** How Japanese is set on a card: Mincho serif or Gothic sans. Session state. */
export type FontStyle = 'mincho' | 'gothic';
