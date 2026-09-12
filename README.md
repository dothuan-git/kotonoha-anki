# Kotonoha

A private Japanese vocabulary trainer with Vietnamese meanings, built around a
washi-paper, wabi-sabi aesthetic. Single user, no sharing.

## Status

Adding a word works end to end: dictionary lookup, Hán Việt, the word list
with search and inline edit, the kanji index. So does the review session —
FSRS scheduling, the daily queue, every word asked from both sides and graded
once, kana input with exact answer matching and three tries, "gõ nhầm", the
ten-second undo, editing a word mid-review. The session works with no signal: it installs as a PWA, the
day's queue is kept in IndexedDB, the scheduler runs on the device, ratings
queue in an outbox and replay through `/api/sync`, and sharing Japanese text
to Kotonoha from anywhere on the phone opens the add form with the word in
it. `/stats` is four charts over `review_logs`, a card forgotten six times
raises a one-time leech prompt, and a wrong answer typed from the meaning that
names another word you own is recorded as a confusion pair.

**One thing was never built: `POST /api/draft`.** The add form has fields for
an AI-drafted Vietnamese meaning and example sentence, but no drafting
endpoint fills them and no `ANTHROPIC_API_KEY` is read anywhere.

## Stack

Next.js 16 (App Router), TypeScript strict, Tailwind v4, Neon Postgres +
Drizzle, Auth.js (Google, single allowlisted address), `ts-fsrs`, `idb`,
Vitest.

## Setup

```bash
npm install
npm run db:migrate             # apply everything in drizzle/
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

Layout note: `lib/answer.ts` is the answer matcher, and the only thing that
decides whether a typed answer is right — and the only thing that decides
which *other* word a wrong answer named. `lib/client/outbox.ts` is the only
thing that sends a review to the server.

## Layout

```
app/          routes and route handlers (/api/lookup, /api/sync, /api/share, auth)
components/   client components, one per screen
components/stats/  the charts, built from elements and inline SVG
lib/db/       Drizzle schema, queries, the review projection, the /stats reads
lib/fsrs/     scheduler params, log replay, queue order and the two-faced
              deal, the study day, the card-state wire shape, the client-side
              scheduler, the one-grade-per-word pair rule
lib/client/   IndexedDB, the offline outbox, the stored session, the TTS check
lib/dict/     Jotoba client, tag→pos mapping, furigana conversion
lib/actions/  server actions
lib/ruby.ts   the ruby parser
lib/share.ts  share-target text extraction
lib/stats.ts  the four /stats charts as pure functions over rows
lib/confusion.ts  confusion-pair resolution, through the answer normaliser
proxy.ts      auth redirect (Next 16's renamed middleware)
public/       manifest, service worker, offline page, icons
scripts/      Unihan seed, card-state recompute
tests/        unit tests
```

## How review works

- **`card_states` is a projection, not state.** `lib/fsrs/replay.ts` folds
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
  replay lands on the same due date — which is what makes the projection a
  real guarantee rather than an aspirational one.
- **The study day starts at 04:00 `Asia/Ho_Chi_Minh`** (`lib/fsrs/day.ts`), so
  a session that runs past midnight still counts against the day it began. The
  caps count each card once: a new card walking its learning steps does not
  also spend a review slot.
- **Changing `request_retention` reschedules the whole collection** on the next
  `npm run recompute`, rather than only affecting future reviews.

### Intervals differ from the naive prediction

A graduating interval of 1 day, `Easy` on a new card at 4 days, and a
repeated-`Good` path of 1 → 3 → 7 → 17 → 40 → 95 → 200 → 365 is what the
scheduler config would suggest at a glance. Those numbers come from `w`, the
model's weights, not from the config knobs directly. With the stock FSRS-5
weights the actual path is **10m → 2d → 11d → 44d → 164d → 357d → 365d**, and
`Easy` on a new card lands around 9 days.

Matching the naive prediction would mean overriding `w[2]` and `w[3]` — the
initial stability estimates for `Good` and `Easy` — which distorts the
model's own first-review guesses. Left alone pending a decision; the override
is a one-line change in `lib/fsrs/params.ts`.

## How recall works

Each word is asked **twice per session and graded once**. Ten words due is
twenty cards: the Japanese on one, the Vietnamese meaning on the other,
shuffled together with the two halves of a word kept at least three cards
apart — back to back, the first is not a question, it is the answer to the
second.

- **A card opens on its face and stays there.** The Japanese card shows the
  word and reveals the reading, meaning and example under it; the meaning card
  shows the meaning and reveals the word — kanji, then reading — directly above
  the example sentence, so the two read together. Neither turns over into the
  other: nothing about the answer is on the prompt side, including Hán Việt on
  a meaning card.
- **Either card can be typed instead of turned over.** The toggle in the header
  is per card and lasts one card. Typing a meaning card asks for the word and
  takes the kanji *or* the kana — 開ける and あける are the same answer. Typing a
  Japanese card can only ask for the reading; accepting the headword there
  would be marking the card's own prompt correct.
- **Matching is exact** (`lib/answer.ts`). NFKC, katakana folded to
  hiragana, ー expanded to the vowel before it (コーヒー → こおひい, which is
  why こうひい does not match), punctuation and interpuncts stripped. No
  Levenshtein tolerance: in an SRS a near miss is a miss, and じ/ぢ stay apart.
- **Three tries.** A wrong answer reveals nothing and writes nothing: it says
  what you typed, says how many tries are left, and waits. Only the third gives
  the answer up. This is not a loosening of the matcher — every attempt is
  judged as strictly as before — it is an admission that a slipped finger and a
  forgotten word look identical to a string comparison.
- **Every grade is yours.** All four buttons are offered however the card went,
  including after three misses. The app does not grade for you. **"Gõ nhầm"**
  appears alongside them after a missed typed answer and is the one button that
  writes nothing at all — no rating, no log row, no state change.
- **"Chưa nhớ ra"** gives up at once, without spending the remaining tries.
  Without it the only way to see the answer is to type three wrong ones.
- **Undo is ten seconds**, and it is the one deletion `review_logs`
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

### One word, one grade a day

The two showings are one card with one schedule, not a forward card and a
reverse card with separate due dates. Knowing 開ける on sight and producing it
from "mở" are two questions about one thing you either know or do not, so they
collapse into a single review — graded on the **worse** of the two answers,
because a word you can read but cannot produce is not a word you knew.

`lib/fsrs/pair.ts` holds the rules and `ReviewScreen` applies them:

1. The first face answered writes the review, exactly as a single-card session
   always did — scheduled on the device, queued in the outbox, learning steps,
   undo toast.
2. That entry is **held back from the flush** while its twin is still in the
   queue, on top of the ordinary undo-window hold.
3. The second face, if it is worse, takes the entry back and queues itself in
   its place. Because nothing was ever sent, the correction costs no deletion
   and `review_logs` keeps its append-only property. If it is as good or
   better, nothing is written and the screen says so.
4. Quit mid-pair and the grade you gave stands; the held entry flushes on the
   next open. The half-graded words ride in the stored session, so a reload
   between the two showings still revises rather than writing a second review.

A card put back by a **learning step** wears the same face it was just asked
from, and that is an ordinary second review rather than a revision — folding it
into the first rating would leave a lapsed card stuck at its lapse instead of
walking 1m → 10m out of it. `revises()` is the one line that tells them apart.

### What the caps count

`newPerDay` and `reviewsPerDay` count **cards**, and every card is asked twice,
so a `newPerDay` of 12 is twelve words and a twenty-four card session. The nav
badge counts showings, because it is a promise about how much work is waiting.
`/stats` counts cards, because a forecast that doubled every bar would be
describing keystrokes rather than vocabulary.

## How offline works

- **There is one write path, not two.** Every rating goes into the outbox and
  reaches the server through `/api/sync`, whether or not there is a
  connection. Being online only means the queue drains sooner. The `rateCard`
  server action is gone: a second path for the connected case is exactly the
  thing that drifts from the first, and the guarantee is that an offline
  review and an online one land on the same schedule.
- **The scheduler runs on the device**, because learning steps leave no
  choice. `Quên` on a new card means "again in a minute", and a minute is
  inside the session — a client that could not schedule would have to drop the
  card or lie about when it comes back. `lib/fsrs/local.ts` does it;
  `tests/local.test.ts` proves it lands where the server's fold of the
  resulting log lands.
- **`CardStateView` is wider than `card_states`.** The table still stores only
  the columns FSRS actually needs, and `learning_steps` still is not one of
  them. The wire shape carries it anyway, along with `elapsed_days` and
  `scheduled_days`, because they come free off the fold that just ran and the
  client has no log to refold from. A card that forgets which of `['1m',
  '10m']` it is on goes back in ten minutes instead of graduating to two
  days — every time, forever.
- **Undo now has a cheap case.** The flush holds each entry for the length of
  the undo window, so the usual undo drops a row that was never sent: nothing
  was written, and `review_logs` keeps its append-only property. The
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
- **Two devices need no conflict resolution.** Because state is a fold,
  replaying both outboxes in `reviewed_at` order lands on the same card
  whichever one reconnects first. `tests/local.test.ts` covers the ordering.

### What the service worker does and does not cache

Shell, hashed `_next/static` chunks, and the Google Fonts faces — a card set in
a fallback sans-serif is a different card. Documents are cached network-first,
so the reviewer opens offline.

Not cached: `/api/*`, and React's flight payloads. A cached
`?_rsc=` response is a session rendered at some past moment; serving it as
though it were current would hand back cards that were already answered. The
cached document has the same problem, which is why it carries `session.now` and
`chooseSession` refuses to believe a payload older than two minutes — see
`lib/client/session.ts`.

Signing out clears the cached pages and the stored queue. It never clears the
outbox: those are reviews that have not reached the server, and only one
address is allowed to sign in, so they can only belong to whoever signs back
in.

### Installing it

`/manifest.webmanifest` declares the share target at `POST /api/share`, which
303s to `/add?q=` with the run of Japanese pulled out of whatever the share
sheet sent. It deliberately does not segment a shared sentence — no
browser-side tokeniser can resolve a word boundary reliably here, and
guessing would be the same mistake one layer up.

**The icons are SVG.** Chrome on Android installs from them; Web Share Target
is Chrome-only. iOS wants a PNG `apple-touch-icon` and will use a screenshot
until one exists; dropping `icons/apple-touch-icon.png` into `public/` and
naming it in `app/layout.tsx` is the whole fix, if that ever matters.

The service worker only registers in production. In development it unregisters
anything already there, because a worker caching dev chunks that are rebuilt on
every keystroke costs an afternoon.

## How /stats works

Four charts, read off `review_logs` rather than off `card_states`. The log
is the source of truth, so three of the four stay right across a
`npm run recompute` that moves every projected row; only the forecast reads the
projection, because "when is this due" is what the projection is for.

- **Lượt ôn mỗi ngày** — distinct cards studied per day, split new vs review,
  30 or 90 days. Counted exactly the way the daily caps count: once per card
  per day, in the bucket of its first showing, so a new card walking
  `['1m','10m']` is one new card and not also three reviews.
- **Sắp đến hạn** — the next 30 days. New cards are left out: their `due` is
  the word's creation time (the fold seeds from it), so all of them are
  "overdue" by construction and what actually releases them is the daily cap.
  Anything genuinely past its date is a single overdue count instead.
- **Tỉ lệ nhớ** — the share graded Được or Dễ, by week, against
  `request_retention`. A rating on a card in `State.New` is excluded: it is the
  first time that card has ever been seen, so it says nothing about recall, and
  counting it would drag the line down at exactly the rate new words are added.
  Weekly, because a day is 20–100 reviews and the noise swamps the signal.
- **Độ chín của sổ từ** — the active cards by stability, split at 21 and 90
  days. 21 days is roughly four consecutive Được: the line between learning a
  word and knowing it.

**The bucketing is by study day, not by calendar day**, and that is the part
worth being careful about. A study day starts at 04:00 `Asia/Ho_Chi_Minh`,
which is 21:00 UTC the *previous* date — so a key taken off `toISOString()`
would label every column a day early, consistently enough to look right.
`studyDayKey` formats in the study zone, and `tests/stats.test.ts` pins the
boundary at 03:59 and 04:00.

The window is read as rows and bucketed in JS rather than grouped in SQL.
This is a single-user app meant to run for years, not to scale, and 26 weeks
at the daily cap is under 20k narrow rows; the awkward part of pushing it
into SQL would be that same 04:00 boundary. If it ever stops being
comfortable, the volume and retention buckets are the two to move.

Every chart carries a legend where it has more than one series, a hover/tap
readout under the plot rather than a tooltip floating over the columns it is
meant to help compare, and the same numbers as a table behind **Xem số liệu** —
colour is one channel and it fails for some readers and every printer.

The chart colours are their own tokens in `globals.css`, chosen against each
surface rather than lightened from one another, and checked for lightness,
chroma, colour-vision separation and contrast. "Từ mới" is blue rather than the
amber the `--warning` token would have given, because green and amber are the
same colour to a deuteranope.

## Leeches, confusion pairs and audio

### Leeches

At six lapses a card raises the prompt **once**. The count is
`card_states.lapses`, folded from the log like everything else; what the log
cannot say is whether the prompt has already been shown, so that one bit is
stored as `cards.leech_acked_at`.

The prompt *is* the editor: a rewrite of the meaning or a note, right there,
because an alert that only told you to go and do one somewhere else is an
alert you dismiss. Saving and dismissing both acknowledge, since both are the
decision the prompt exists to get. It never offers to suspend or delete the
word — the moment you have just failed it six times is the worst moment to
decide you are done with it, and both of those stay manual decisions on /words.

It used to do one thing more. When a word had two cards, acknowledging a leech
sent the harder one — the production card — `active = false`, leaving
recognition running. A word is one card asked from both sides now, so there is
no second card to retire, and retiring one *side* would mean a column on
`cards` saying which. The prompt is a prompt to fix the word, and nothing else.

The device raises it without waiting for the server: the leech flag needs only
the card's own fold and the flag it arrived with, so it works on the train. The *acknowledgement* is a server write with no
offline path — dismissing with no signal changes nothing and the card is
flagged again next session, which is the honest outcome for a rule that is
about showing something once.

**One behaviour changed for this.** `applyReview` no longer requires
`cards.active`; the queue still filters on it. `active` decides what a session
*hands you*, not whether a review that already happened may be recorded — a
card deactivated mid-session, while the rating that triggered it is still in
the outbox, would otherwise reject that rating permanently and throw away a
review the user actually did. A suspended word still rejects.

### Confusion pairs

A wrong answer, typed from the meaning, that turns out to name **another word
in the collection**. Typing あける for 開く is a confusion; typing あkえru is a typo,
and `review_logs` has already recorded it as a miss.

- The attempt rides the outbox alongside the rating, so one typed in a tunnel
  is not lost, and a client-generated id makes the replay idempotent.
- **The server resolves it, not the device.** The device holds the day's queue,
  not the collection — it cannot know that あける is also a word you own.
- Resolution runs through `normaliseAnswer` and nothing else: the same rule
  that decided the answer was wrong decides which word it was right *about*. No
  edit distance, because a matcher that guessed here would invent confusions
  nobody had.
- **An ambiguous attempt is dropped.** 上る and 登る are both のぼる; the attempt
  cannot say which was meant, and recording one at random would put a fact on
  /stats that nobody observed.
- `confusions` is append-only like `review_logs`; the counts are a fold over
  it. What was typed is never stored — a confusion is a pair of words.
- It is directional. "asked for 開く, typed 開ける" and its mirror are different
  mistakes, and collapsing them would hide which direction keeps failing.

### Audio

No audio is generated, stored or fetched. The Web Speech API already reads
Japanese on every platform this runs on — including offline, because the
voice is installed on the device rather than streamed. A stored MP3 per word
would buy identical audio across devices at the cost of a provider, a key, a
blob store and a sync path, for one person listening on one phone.

What the platform does not give for free is knowing whether it will work. A
device with no Japanese voice reads 開ける in English, and discovering that
mid-session is both too late and easy to mistake for a bad recording. So the
add form checks at save time and says so, and carries a speaker button to hear
the word once while adding it. `lib/client/audio.ts` also waits for
`voiceschanged` — an early `getVoices()` returns an empty list in Chrome, which
is why the previous version silently fell back to the default voice.

## Notes for whoever picks this up

- **`POST /api/draft` is the outstanding item.** An AI drafting endpoint would
  fill in the Vietnamese meaning and an example sentence with ruby from the
  headword plus the dictionary result, validated with Zod, retried once on a
  parse failure, and never blocking the save. The add form has the fields;
  nothing fills them.
- **`review_logs` is still append-only.** Two permitted deletions, both narrow:
  `undoReview`'s 10-second window on the server, and the outbox entry dropped
  before it is ever sent. `confusions` is append-only on the same terms and has
  no deletion at all.
- **`applyReview` is the one scheduling path.** Server action, sync replay and
  recompute all go through it or through `foldLogs`. Anything that writes a
  review should too.
- **A constant imported from `lib/db/*` into a client component pulls the
  database client into the browser bundle**, where it throws on a missing
  `DATABASE_URL` before anything renders. A type-only import is fine; a number
  is not, and the difference is invisible until it runs. That is why
  `VOLUME_DAYS` and `StatsView` live in `lib/stats.ts` rather than next to the
  queries that use them.
- **Jotoba does not return raw JMdict tags.** `lib/dict/pos.ts` maps its actual
  tagged enums. Test fixtures are verbatim live responses so the mapping
  cannot drift silently.
- **JLPT is a hint, never authoritative.** Jotoba carries no word-level level;
  the hint comes from the constituent kanji and often disagrees (開ける hints
  N4 but is N5). The form's selector always wins.
