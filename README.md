# Kotonoha

A private Japanese vocabulary trainer with Vietnamese meanings, built around a
washi-paper, wabi-sabi aesthetic. Single user, no sharing. See
[kotonoha-technical-plan.md](kotonoha-technical-plan.md) for the full design.

## Status — Phase 4 (the train)

Working: add a word (dictionary lookup, Hán Việt), the word list with search
and inline edit, the kanji index, and the review session — FSRS scheduling,
the daily queue, recognition **and production** cards, kana input with §6
answer matching, "gõ nhầm", the ten-second undo, editing a word mid-review,
and session end.

Phase 4 made the session work with no signal. It installs as a PWA, the day's
queue is kept in IndexedDB, the scheduler runs on the device, ratings queue in
an outbox and replay through `/api/sync`, and sharing Japanese text to
Kotonoha from anywhere on the phone opens the add form with the word in it.

Not built yet: `/stats` shows an empty state. It is four charts over
`review_logs` and belongs to Phase 5; nothing on it is mocked.

## Stack

Next.js 16 (App Router), TypeScript strict, Tailwind v4, Neon Postgres +
Drizzle, Auth.js (Google, single allowlisted address), `ts-fsrs`, `idb`,
Vitest.

## Setup

```bash
npm install
npm run db:migrate             # apply drizzle/0000_initial_schema.sql
npm run seed:unihan            # Hán Việt readings from Unihan (~10k rows)
npm run seed:words             # optional: 50 N5 words to start from
npm run dev
```

`AUTH_SECRET` comes from `npx auth secret`. The Google OAuth client needs
`http://localhost:3000/api/auth/callback/google` as an authorised redirect URI.
`ALLOWED_EMAIL` is the only address that can sign in — if it is unset, nobody
can.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run db:generate` | Generate a migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run seed:unihan` | Seed `kanji.han_viet`; idempotent, `-- --fresh` re-downloads |
| `npm run seed:words` | Add the 50-word N5 starter deck; idempotent, `-- --dry` writes nothing |
| `npm run recompute` | Rebuild every `card_states` row from `review_logs`; `-- --check` reports without writing |

Layout note: `lib/answer.ts` is §6's matcher, and the only thing that decides
whether a typed answer is right. `lib/client/outbox.ts` is the only thing that
sends a review to the server.

## Layout

```
app/          routes and route handlers (/api/lookup, /api/sync, /api/share, auth)
components/   client components, one per screen
lib/db/       Drizzle schema, queries, and the review projection
lib/fsrs/     scheduler params, log replay, queue order, the study day,
              the card-state wire shape, the client-side scheduler
lib/client/   IndexedDB, the offline outbox, the stored session
lib/dict/     Jotoba client, tag→pos mapping, furigana conversion
lib/actions/  server actions
lib/ruby.ts   §7 ruby parser
lib/share.ts  §10 share-target text extraction
proxy.ts      auth redirect (Next 16's renamed middleware)
public/       manifest, service worker, offline page, icons
scripts/      Unihan seed, card-state recompute
tests/        unit tests
```

## How review works

- **`card_states` is a projection, not state** (§5). `lib/fsrs/replay.ts` folds
  a card's `review_logs` through FSRS; `lib/db/review.ts` stores the result for
  query speed and is the only thing that writes the table. `npm run recompute`
  rebuilds every row and reports anything that did not reproduce — drift there
  means something wrote a state the log does not imply.
- **The fold seeds from `words.created_at`**, so an untouched card recomputes to
  the same row a year later instead of to "now". `createWord` writes the word
  and its card state with one timestamp for exactly this reason.
- **ts-fsrs's `learning_steps` is deliberately not stored.** It is a step index
  the log already determines, and a stored copy would be a second source of
  truth. Every path that needs a real `Card` folds the log first.
- **Fuzz stays deterministic.** ts-fsrs seeds it from the card itself, so a
  replay lands on the same due date — which is what makes §5's guarantee real
  rather than aspirational.
- **The study day starts at 04:00 `Asia/Ho_Chi_Minh`** (`lib/fsrs/day.ts`), so
  a session that runs past midnight still counts against the day it began. The
  caps count each card once: a new card walking its learning steps does not
  also spend a review slot.
- **Changing `request_retention` reschedules the whole collection** on the next
  `npm run recompute`, rather than only affecting future reviews.

### Intervals differ from §4's table

§4 predicts a graduating interval of 1 day, `Easy` on a new card at 4 days, and
a repeated-`Good` path of 1 → 3 → 7 → 17 → 40 → 95 → 200 → 365. The config
block in §4 is implemented verbatim, but those numbers come from `w`, the
model's weights, not from any of those knobs. With the stock FSRS-5 weights the
actual path is **10m → 2d → 11d → 44d → 164d → 357d → 365d**, and `Easy` on a
new card lands around 9 days.

Hitting §4's table would mean overriding `w[2]` and `w[3]` — the initial
stability estimates for `Good` and `Easy` — which distorts the model's own
first-review guesses. Left alone pending a decision; the override is a one-line
change in `lib/fsrs/params.ts`.

## How recall works

- **A production card asks for the word, given only the meaning.** No Hán Việt
  and no example sentence on the prompt side — both leak the answer. The
  headword, the reading and the furigana appear together once you have
  answered.
- **Matching is exact** (`lib/answer.ts`, §6). NFKC, katakana folded to
  hiragana, ー expanded to the vowel before it (コーヒー → こおひい, which is
  why こうひい does not match), punctuation and interpuncts stripped. Accepts
  the reading or the headword — typing 開ける instead of あける is correct. No
  Levenshtein tolerance: in an SRS a near miss is a miss, and じ/ぢ stay apart.
- **A wrong answer can only be graded Quên.** The other three buttons are not
  rendered and the keys do nothing, so a miss cannot be self-graded into Được.
  The escape is **"gõ nhầm"**, which discards the attempt without writing a log
  row — no rating, no state change, retype it.
- **"Chưa nhớ ra"** reveals the answer and counts as a miss. Without it the
  only way to see the answer is to type a wrong one, which logs a review you
  did not mean to grade.
- **Undo is ten seconds** (§5), and it is the one deletion `review_logs`
  permits. The server deletes that row by id and refolds the card; the card
  comes back in front of you carrying the state the shorter log implies, not
  the values the client had cached. Two guards, because a delete against an
  append-only table should be narrow: the row must be inside the window
  (checked against `reviewed_at`, not the client's countdown) and it must be
  the card's most recent review.
- **Editing mid-review saves before it redraws.** A failed write leaves the old
  values on screen rather than a lie. The panel is narrower than /words on
  purpose — headword, reading, meaning, note; the things you can be wrong about
  while looking at the card.

### When production cards appear

§4 unlocks one at `stability >= 21` on the word's recognition card, checked
after every review. With the stock FSRS-5 weights that is the **4th consecutive
Được** (stability steps 2.3 → 2.3 → 11.0 → 44.0, about eight weeks in) or the
**2nd Dễ**. Nothing lands exactly on 21; the fold steps over it.

The new card's state row is `createEmptyCard(word.created_at)` — the same seed
every other fold uses — so `npm run recompute` reproduces it instead of moving
it to whenever the rebuild ran. It is therefore due in the past, which is
correct: it is a new card, and it joins the *next* session, never the one that
unlocked it (§4 allows one card per word per session).

One consequence worth knowing: new cards are ordered by `words.created_at`, so
an unlocked production card sorts ahead of recently added vocabulary and spends
the 12/day new-card budget first. In practice unlocks arrive at roughly the
rate you were adding words two months ago, so it is self-limiting — but if a
backlog ever crowds out new words, that ordering in `buildSession` is where to
change it.

## How offline works

- **There is one write path, not two.** Every rating goes into the outbox and
  reaches the server through `/api/sync`, whether or not there is a
  connection. Being online only means the queue drains sooner. The `rateCard`
  server action is gone: a second path for the connected case is exactly the
  thing that drifts from the first, and §8's guarantee is that an offline
  review and an online one land on the same schedule.
- **The scheduler runs on the device**, because learning steps leave no
  choice. `Quên` on a new card means "again in a minute", and a minute is
  inside the session — a client that could not schedule would have to drop the
  card or lie about when it comes back. `lib/fsrs/local.ts` does it;
  `tests/local.test.ts` proves it lands where the server's fold of the
  resulting log lands.
- **`CardStateView` is wider than `card_states`.** The table still stores only
  §3's columns, and `learning_steps` still is not one of them. The wire shape
  carries it anyway, along with `elapsed_days` and `scheduled_days`, because
  they come free off the fold that just ran and the client has no log to refold
  from. A card that forgets which of `['1m', '10m']` it is on goes back in ten
  minutes instead of graduating to two days — every time, forever.
- **Undo now has a cheap case.** The flush holds each entry for the length of
  §5's window, so the usual undo drops a row that was never sent: nothing was
  written, and `review_logs` keeps the append-only property §3 asks of it. The
  server-side `undoReview` is still there for a rating that got out early —
  flushed by another tab, synced from another device — and that is what the one
  permitted deletion is spent on.
- **The daily caps are kept by identity, not by count.** `SessionView` carries
  which cards have been spent today and in which bucket, because a learning
  card the server counted this morning must not spend a second slot when it
  comes round again on the train.
- **The server always wins.** Whatever `/api/sync` returns replaces what the
  client scheduled. It is the only party that folded the card's whole log; the
  client only ever folded the slice it was handed at session start. The one
  place this bites is a device clock running fast — `syncReviews` clamps a
  future `reviewed_at` to the server's now, and the corrected state comes back
  in the same response.
- **Two devices need no conflict resolution.** Because state is a fold (§5),
  replaying both outboxes in `reviewed_at` order lands on the same card
  whichever one reconnects first. `tests/local.test.ts` covers the ordering.

### What the service worker does and does not cache

Shell, hashed `_next/static` chunks, and the Google Fonts faces — a card set in
a fallback sans-serif is a different card. Documents are cached network-first,
so the reviewer opens offline.

Not cached: `/api/*`, as §8 requires, and React's flight payloads. A cached
`?_rsc=` response is a session rendered at some past moment; serving it as
though it were current would hand back cards that were already answered. The
cached document has the same problem, which is why it carries `session.now` and
`chooseSession` refuses to believe a payload older than two minutes — see
`lib/client/session.ts`.

Signing out clears the cached pages and the stored queue. It never clears the
outbox: those are reviews that have not reached the server, and §10 admits one
address, so they can only belong to whoever signs back in.

### Installing it

`/manifest.webmanifest` declares the share target at `POST /api/share`, which
303s to `/add?q=` with the run of Japanese pulled out of whatever the share
sheet sent. It deliberately does not segment a shared sentence — §7 rules out
browser-side tokenising, and guessing a word boundary here is the same mistake
one layer up.

**The icons are SVG.** Chrome on Android installs from them, which is the
platform this phase is for — Web Share Target is Chrome-only. iOS wants a PNG
`apple-touch-icon` and will use a screenshot until one exists; dropping
`icons/apple-touch-icon.png` into `public/` and naming it in `app/layout.tsx`
is the whole fix, if that ever matters.

The service worker only registers in production. In development it unregisters
anything already there, because a worker caching dev chunks that are rebuilt on
every keystroke costs an afternoon.

## Notes for the next phase

- **`review_logs` is append-only.** Two permitted deletions now, both narrow:
  `undoReview`'s 10-second window on the server, and the outbox entry that is
  dropped before it is ever sent. The second one deletes nothing in Postgres at
  all, which is the point.
- **`/stats` is the last screen.** It reads `review_logs` directly — the log is
  the source of truth (§5), so the charts do not need `card_states` for
  anything but "due today".
- **Leeches, confusion pairs and TTS are Phase 5.** §4's leech rule (flag at 6
  lapses, deactivate the production card, never auto-suspend the word) has no
  implementation yet; `card_states.lapses` is already correct and folded.
- **`applyReview` is the one scheduling path.** Server action, sync replay and
  recompute all go through it or through `foldLogs`. Anything Phase 5 adds that
  writes a review should too.
- **Jotoba does not return raw JMdict tags.** `lib/dict/pos.ts` maps its actual
  tagged enums; §9's `v5*`/`v1`/`vt` table does not apply. Test fixtures are
  verbatim live responses so the mapping cannot drift silently.
- **JLPT is a hint, never authoritative.** Jotoba carries no word-level level;
  the hint comes from the constituent kanji and often disagrees (開ける hints
  N4 but is N5). The form's selector always wins.
