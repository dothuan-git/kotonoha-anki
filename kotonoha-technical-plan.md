# Kotonoha — technical plan

For Claude Code. Read fully before writing anything. The UI design is being produced separately in Claude Design; this document covers everything else.

---

## 1. Scope

A private Japanese vocabulary trainer with Vietnamese meanings. Single user, no sharing, no multi-tenancy, no public content. Words are added by the user, not imported from pre-made decks.

Deploy: Vercel. Repo: GitHub, single Next.js app, no monorepo.

**Non-goals.** Do not build: user registration, roles or permissions, deck sharing, import/export from Anki, a public API, an admin panel, email, analytics, feature flags, i18n infrastructure, or a marketing page. Interface copy is Vietnamese and hardcoded.

Optimise for one person using this daily for years. Correctness of scheduling and speed of adding words matter; scale does not.

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js, App Router, TypeScript strict |
| Database | Neon Postgres (free tier is sufficient forever) |
| ORM | Drizzle + drizzle-kit migrations |
| Auth | Auth.js, Google provider, single allowlisted email |
| Scheduler | `ts-fsrs` |
| Kana input | `wanakana` |
| Client data | TanStack Query |
| Offline | IndexedDB via `idb` + service worker |
| Drafting | Anthropic API, `claude-sonnet-4-6` |
| Styling | Tailwind, tokens from the design |

Server Actions for mutations, route handlers only where a real HTTP endpoint is needed (share target, sync, drafting).

## 3. Data model

```ts
// words
id            uuid pk
headword      text notnull          // 開ける
reading       text notnull          // あける
meaning       text notnull          // Vietnamese
pos           text notnull          // enum, see below
transitivity  text                  // 'transitive' | 'intransitive' | null
jlpt          text                  // 'N5'..'N1' | null
note          text
suspended     boolean default false
created_at    timestamptz

// kanji
char          text pk               // 開
han_viet      text[] notnull        // ['KHAI']

// word_kanji
word_id       uuid fk
kanji_char    text fk
position      int
  primary key (word_id, kanji_char, position)

// sentences
id            uuid pk
word_id       uuid fk cascade
jp            text notnull
jp_ruby       text notnull          // 窓[まど]を開[あ]けてください。
vi            text notnull
source        text                  // 'ai' | 'manual'
created_at    timestamptz

// cards
id            uuid pk
word_id       uuid fk cascade
card_type     text notnull          // 'recognition' | 'production' | 'cloze'
active        boolean default true
  unique (word_id, card_type)

// card_states  — DERIVED, see §5
card_id       uuid pk fk cascade
due           timestamptz notnull
stability     real
difficulty    real
state         int notnull           // ts-fsrs State enum
reps          int notnull default 0
lapses        int notnull default 0
last_review   timestamptz

// review_logs  — APPEND ONLY
id            uuid pk               // client-generated, idempotency key
card_id       uuid fk
rating        int notnull           // 1..4
state         int notnull           // state before the review
elapsed_days  real notnull
scheduled_days real notnull
reviewed_at   timestamptz notnull
  index (card_id, reviewed_at)

// dict_cache
headword      text pk
payload       jsonb notnull
fetched_at    timestamptz
```

`pos` enum: `Noun`, `Verb 1`, `Verb 2`, `Verb 3`, `I-adjective`, `Na-adjective`, `Adverb`, `Particle`, `Conjunction`, `Counter`, `Expression`.

`review_logs` is never updated or deleted. After a year I want to run the FSRS optimiser over it.

## 4. Scheduling

`ts-fsrs`, configured:

```ts
{
  request_retention: 0.90,
  maximum_interval: 365,
  enable_fuzz: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
}
```

Graduating interval 1 day; `Easy` on a new card jumps to 4 days; a lapse floors at 1 day after its relearning step. Expected path on repeated `Good`: 1 → 3 → 7 → 17 → 40 → 95 → 200 → 365 days.

Ratings map to `Again|Hard|Good|Easy` = 1|2|3|4, labelled `Quên|Khó|Được|Dễ` in the UI.

Daily caps, stored in a settings row, editable: **12 new**, **100 reviews**. When a cap is reached the session ends. Do not offer a "study more" escape hatch.

**Card unlocking.** A new word gets a `recognition` card only. Its `production` card is created and activated automatically once the recognition card's `stability >= 21`. Check this after each review. `cloze` is opt-in per word, default off.

**Leeches.** At 6 lapses on a card, flag it once in the UI and prompt me to rewrite the meaning or add a note; then set `active = false` on the production card and leave recognition running. Never auto-delete or auto-suspend a word.

**Queue order.** Overdue reviews first (most overdue first), then new cards interleaved at most one per five reviews. Never show two cards from the same word in one session.

## 5. Card state is a projection

`card_states` is not the source of truth — it is a fold over `review_logs`:

```
state(card) = review_logs.filter(card).sortBy(reviewed_at).reduce(fsrs.next)
```

Write `recomputeCardState(cardId)` and use it everywhere. Store the result for query speed, but it must always be reproducible from the log alone. Add a `pnpm recompute` script that rebuilds every row.

This buys three things cheaply: offline sync becomes log replay (§8), undo becomes "delete nothing, append nothing, recompute from a log slice", and changing FSRS parameters later reschedules the whole collection correctly instead of only affecting future reviews.

**Undo** is a 10-second window: hard-delete the just-written log row (the only permitted deletion, and only within that window, by id) and recompute.

## 6. Answer matching — production cards

Input runs through `wanakana` for live romaji→kana conversion. On submit, compare normalised forms:

```
normalise(s):
  NFKC
  katakana → hiragana
  strip whitespace, ・, 〜, punctuation
  expand ー to the preceding vowel   (コーヒー → こおひい)
  lowercase
```

Accept if `normalise(input) === normalise(reading)` **or** `input === headword` (typing the kanji is fine).

No fuzzy matching, no Levenshtein tolerance — in an SRS a near miss is a miss. But provide an explicit **"gõ nhầm"** button on a wrong answer that discards the attempt without writing a review log, for genuine mistypes. It costs nothing and prevents the resentment that makes people quit.

Write a table-driven unit test for this. Cases to include: 開ける/あける/アケル/開ける, コーヒー vs こうひい vs こおひい, じ/ぢ must not be interchangeable.

## 7. Furigana

`jp_ruby` format: `窓[まど]を開[あ]けてください。`

Write `parseRuby(s): Array<{ base: string; ruby?: string }>` and a `<Ruby>` component rendering real `<ruby><rb>…</rb><rt>…</rt></ruby>`. Escape `[` as `\[`. Unit test the parser against nested-free but bracket-heavy strings.

Do not attempt runtime furigana generation — 開ける is あける, 開く is あく, and no browser-side tokeniser resolves that. Ruby is authored at add time and stored.

## 8. Offline

Reviewing on the train with no signal is a hard requirement.

- On session start, prefetch the day's queue (cards + words + sentences) into IndexedDB.
- Run the FSRS scheduler **client-side** during the session so learning steps behave correctly offline.
- Each rating writes a log entry to a local outbox with a client-generated UUID and true `reviewed_at`.
- On reconnect, POST the outbox to `/api/sync`. The server inserts logs idempotently on the UUID primary key, then recomputes affected card states in `reviewed_at` order and returns authoritative states.
- The client discards its local state in favour of the server response. Server always wins.

Because state is a projection, two devices reviewing the same card offline resolve correctly on replay — no conflict resolution logic needed.

Service worker: cache the app shell and the queue. Do not cache API responses.

## 9. External data

**Dictionary lookup.** Jotoba's public search API. Check `dict_cache` first; on miss, fetch and cache the raw payload. Map to our fields: reading, JMdict pos tags → our `pos` enum (`v5*` → Verb 1, `v1`/`v1-s` → Verb 2, `vs-i`/`vk` → Verb 3, `adj-i`/`adj-na`, etc.), `vt`/`vi` → transitivity, JLPT level, and the kanji characters in the headword. Put the tag→label mapping in one pure function so I can change a label without a migration.

**Hán Việt.** One-time seed from the Unicode Consortium's Unihan database, `kVietnamese` field in `Unihan_Readings.txt`. Parse to `kanji.han_viet`. Script under `scripts/seed-unihan.ts`, committed, idempotent. Expect gaps on rarer characters — the add form must let me type a Hán Việt reading by hand and persist it.

**Drafting.** `POST /api/draft` takes a headword plus the dictionary result and returns:

```json
{
  "meaning": "mở",
  "sentence": {
    "jp": "窓を開けてください。",
    "jp_ruby": "窓[まど]を開[あ]けてください。",
    "vi": "Xin hãy mở cửa sổ."
  }
}
```

System prompt constraints: Vietnamese meaning in the register a Vietnamese learner's dictionary would use, no English; example sentence 10–15 morae, using only N5–N4 vocabulary besides the target word, showing the word in its most frequent grammatical pattern; ruby annotations on every kanji in the sentence; respond with JSON only, no prose, no code fences. Validate with Zod and retry once on a parse failure before surfacing an error.

Never block saving on this call. If drafting fails, the form stays usable with the fields empty.

## 10. Routes

```
/                 review session
/add              add a word
/words            list + search + inline edit
/kanji            kanji index
/kanji/[char]     one kanji and its words
/stats            four charts
/settings         caps, retention target, dark mode

POST /api/draft   Claude drafting
POST /api/sync    offline log batch
POST /api/share   Web Share Target → redirects to /add?q=
GET  /api/lookup  dictionary passthrough + cache
```

Auth: Auth.js Google provider, `signIn` callback returns false unless the email equals `ALLOWED_EMAIL`. Middleware protects everything except the auth routes.

Env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL`, `ANTHROPIC_API_KEY`.

## 11. Consuming the design

The visual design arrives from Claude Design as HTML/CSS.

- Extract its tokens into `app/globals.css` as CSS custom properties and mirror them in `tailwind.config.ts`. Tokens live in exactly one place.
- **Rebuild** the markup as React components. Do not paste exported HTML into JSX and patch it — that produces unmaintainable class soup within a week.
- Keep animation in CSS where possible; reach for a JS animation library only for the reveal sequence if CSS can't express it.
- Respect `prefers-reduced-motion` globally, once, in `globals.css`.
- Ask me before deviating from the design. If something in it can't be built as drawn, say so rather than quietly substituting.

## 12. Testing

Vitest, unit only. No E2E, no component tests, no coverage targets.

Test exactly four things: the answer normaliser (table-driven), the ruby parser, the JMdict tag → `pos` mapping, and log replay determinism (same log ⇒ same state, and replay order independence for interleaved devices).

Everything else is verified by using the app.

## 13. Build order

Ship each phase to Vercel before starting the next.

**Phase 1 — capture.** Schema, migrations, auth, Unihan seed, dictionary lookup with cache, drafting endpoint, add form, word list with search and inline edit.
*Done when:* I can add a word on my phone in under five seconds and see it in the list.
**Then stop and tell me.** I'll add fifty words by hand before you build the reviewer — the add flow's real problems only appear in use.

**Phase 2 — review.** FSRS integration, state projection and recompute script, queue builder, recognition cards, rating, session end.
*Done when:* a full day's session works and `pnpm recompute` reproduces every state exactly.

**Phase 3 — recall.** Production cards, kana input, answer matching, "gõ nhầm", undo, edit mid-review, unlocking at 21-day stability.

**Phase 4 — the train.** PWA, service worker, IndexedDB queue, client-side scheduling, `/api/sync`, share target.
*Done when:* airplane mode for a whole session, then reconnect, and the server state is correct.

**Phase 5 — the rest.** Kanji index, stats, leech handling, confusion pairs, TTS audio on save.

Work in small commits with clear messages. Open a PR per phase; don't push to main.
