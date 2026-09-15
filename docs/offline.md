# Offline and sync

The review session is the offline-critical path: the day's queue lives in
IndexedDB, the scheduler runs on the device, and ratings queue in an outbox
that replays through `/api/sync`.

## Rules

- **One write path.** Every rating goes through the outbox, connection or not.
  A second path for the connected case is exactly the thing that drifts from
  the first; an offline review and an online one must land on the same
  schedule.
- **The scheduler runs on the device**, because learning steps leave no choice:
  "again in a minute" is inside the session, and a client that could not
  schedule would have to drop the card or lie about when it returns.
  `lib/fsrs/local.ts` does it, and `tests/local.test.ts` proves it agrees with
  the server's fold of the resulting log.
- **The server always wins.** Whatever `/api/sync` returns replaces what the
  client scheduled — the server folded the card's whole log, the client only
  the slice it was handed. A device clock running fast is clamped to the
  server's now, and the corrected state comes back in the same response.
- **Two devices need no conflict resolution.** Because state is a fold,
  replaying both outboxes in `reviewed_at` order lands on the same card
  whichever reconnects first.
- **Caps are kept by identity, not by count.** The session carries which cards
  have been spent today and in which bucket, so a learning card the server
  counted this morning does not spend a second slot on the train.
- **The wire shape is wider than the table.** `CardStateView` carries
  `learning_steps`, `elapsed_days` and `scheduled_days` — free off the fold that
  just ran, and impossible for the client to recover, since it has no log to
  refold. A card that forgets which of `['1m','10m']` it is on returns in ten
  minutes instead of graduating, every time, forever.

## The outbox

Entries are held for the length of the undo window before flushing, so the
usual undo drops a row that was never sent — nothing written, and `review_logs`
keeps its append-only property. The server-side undo exists for a rating that
got out early (flushed by another tab, synced from another device).

`id` is generated on the device, which makes replay idempotent and is what lets
a pair correction re-send under the same id. `/api/sync` accepts at most 500
ratings per POST: a week offline fits comfortably, and a corrupt outbox cannot
ask the server to replay forever. Wrong answers that might be confusions ride
along in the same request.

Signing out clears cached pages and the stored queue, but never the outbox —
those are reviews that have not reached the server, and only one address can
sign in.

## Service worker

Cached: the shell, hashed `_next/static` chunks, and the Google Fonts faces — a
card set in a fallback sans-serif is a different card. Documents are cached
network-first.

**Not cached: `/api/*` and React flight payloads.** A cached `?_rsc=` response
is a session rendered at some past moment; serving it as current would hand
back cards that were already answered. The cached document has the same
problem, which is why it carries `session.now` and `chooseSession` refuses a
payload older than two minutes (`lib/client/session.ts`).

The worker only registers in production; in development it unregisters anything
already installed, because caching dev chunks rebuilt on every keystroke costs
an afternoon.

## Installing

`/manifest.webmanifest` declares a share target at `POST /api/share`, which
extracts the run of Japanese from whatever the share sheet sent and redirects
to `/add?q=`. It does not segment a shared sentence — no browser-side tokeniser
resolves word boundaries reliably.

Icons are SVG, which Chrome on Android installs from (Web Share Target is
Chrome-only anyway). iOS wants a PNG `apple-touch-icon` and uses a screenshot
until one exists.
