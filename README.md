# Kotonoha

A private Japanese vocabulary trainer with Vietnamese meanings, built around a
washi-paper, wabi-sabi aesthetic. Single user, no sharing. See
[kotonoha-technical-plan.md](kotonoha-technical-plan.md) for the full design.

## Status — Phase 1 (capture)

Working: add a word (dictionary lookup, AI drafting, Hán Việt), the word list
with search and inline edit, and the kanji index.

Not built yet: `/` (review) and `/stats` show an empty state — both are
projections over `review_logs`, which stays empty until Phase 2 lands the FSRS
scheduler. Nothing on those screens is mocked.

## Stack

Next.js 16 (App Router), TypeScript strict, Tailwind v4, Neon Postgres +
Drizzle, Auth.js (Google, single allowlisted address), Anthropic API for
drafting, Vitest.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run db:migrate             # apply drizzle/0000_initial_schema.sql
npm run seed:unihan            # Hán Việt readings from Unihan (~10k rows)
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

## Layout

```
app/          routes and route handlers (/api/lookup, /api/draft, auth)
components/   client components, one per screen
lib/db/       Drizzle schema and queries
lib/dict/     Jotoba client, tag→pos mapping, furigana conversion
lib/actions/  server actions
lib/ruby.ts   §7 ruby parser
proxy.ts      auth redirect (Next 16's renamed middleware)
scripts/      Unihan seed
tests/        unit tests
```

## Notes for the next phase

- **`card_states` is a projection, not state** (§5). It must always be
  reproducible by folding `review_logs` through FSRS. `createWord` writes an
  initial row at `state 0` because an empty log folds to exactly that.
- **`review_logs` is append-only.** The single permitted deletion is the
  10-second undo window, by id.
- **Jotoba does not return raw JMdict tags.** `lib/dict/pos.ts` maps its actual
  tagged enums; §9's `v5*`/`v1`/`vt` table does not apply. Test fixtures are
  verbatim live responses so the mapping cannot drift silently.
- **JLPT is a hint, never authoritative.** Jotoba carries no word-level level;
  the hint comes from the constituent kanji and often disagrees (開ける hints
  N4 but is N5). The form's selector always wins.
