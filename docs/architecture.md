# Architecture

Single-user PWA. Next.js 16 App Router: screens render on the server, mutations
go through server actions, and the review session runs on the device so it
survives losing signal. Postgres (Neon) via Drizzle is the only durable store;
IndexedDB holds the day's queue and unsent ratings.

## Routes

| Route | Purpose |
|---|---|
| `/` | The review session |
| `/words` | Word list, search, inline edit, suspend/delete |
| `/add`, `/add/bulk` | Add one word, or import a JSON file |
| `/kanji`, `/kanji/[char]` | Kanji index and detail, with Hán Việt |
| `/stats` | Four charts over the review log |
| `/settings` | Daily caps, target retention, theme |
| `/signin` | Google sign-in |

| Route handler | Purpose |
|---|---|
| `POST /api/sync` | The only way a rating reaches the database |
| `GET /api/lookup` | Jotoba dictionary lookup, cached in `dict_cache` |
| `POST /api/share` | PWA share target; redirects to `/add?q=` |
| `POST /api/import` | Bulk import preview (`dryRun=1`) and commit |
| `/api/auth/*` | Auth.js |

Auth is Auth.js with Google and a single allowlisted address
(`ALLOWED_EMAIL`); `proxy.ts` — Next 16's renamed middleware — redirects
anything unauthenticated to `/signin`.

## Module map

```
app/              routes and route handlers
components/       client components, one per screen
components/stats/ the charts, inline SVG
lib/db/           Drizzle schema, queries, the review projection, /stats reads
lib/fsrs/         scheduler params, log replay, queue order, study day,
                  client-side scheduler, the pair rule
lib/client/       IndexedDB, the outbox, the stored session, the TTS check
lib/dict/         Jotoba client, tag→pos mapping, furigana
lib/actions/      server actions
lib/answer.ts     answer matching and normalisation
lib/import.ts     bulk-import parser (pure, no database)
lib/stats.ts      the /stats charts as pure functions over rows
lib/ruby.ts       furigana parsing  ·  lib/share.ts  share-text extraction
lib/confusion.ts  confusion-pair resolution
```

## How a review reaches the database

```
server renders the queue  →  IndexedDB (session + card states)
                                   ↓
                          device schedules the rating (lib/fsrs/local.ts)
                                   ↓
                          outbox (IndexedDB, held for the undo window)
                                   ↓
                          POST /api/sync  →  insert review_logs
                                   ↓
                          fold the card's whole log  →  card_states
                                   ↓
                          the folded state is returned and replaces the
                          client's own
```

The same path runs online and offline; being online only means the outbox
drains sooner. Details in [offline.md](offline.md).

## Design decisions

- **Scheduling state is a fold over the log**, never accumulated in place. See
  [data-model.md](data-model.md#invariants) and
  [review-model.md](review-model.md).
- **One write path for ratings.** There is no server action that rates a card.
- **Pure logic lives in `lib/` and is tested without a database** — answer
  matching, ruby, import parsing, queue order, the log fold, the stats buckets.
- **Ambiguity is resolved where the data is.** The device holds one day's
  queue, so the server — which holds the collection — decides whether a wrong
  answer named another word.
- **No generated or stored audio.** The Web Speech API reads Japanese on every
  target platform, offline, using a voice already on the device. The add form
  checks at save time that such a voice exists, because a device without one
  reads Japanese in English and that is worth discovering early.

## Gotchas

- **Never import a *value* from `lib/db/*` into a client component.** It pulls
  the database client into the browser bundle, which throws on a missing
  `DATABASE_URL` before anything renders. Type-only imports are fine; the
  difference is invisible until it runs. This is why `VOLUME_DAYS` and
  `StatsView` live in `lib/stats.ts`.
- **Jotoba does not return raw JMdict tags.** `lib/dict/pos.ts` maps its actual
  tagged enums, and the test fixtures are verbatim live responses so the
  mapping cannot drift silently.
- **JLPT from a lookup is a hint, not an answer.** Jotoba has no word-level
  level; the hint is inferred from the constituent kanji and often disagrees
  (開ける hints N4, is N5). The form's selector wins.
