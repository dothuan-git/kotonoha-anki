# Kotonoha

A private Japanese vocabulary trainer with Vietnamese meanings, built around a
washi-paper, wabi-sabi aesthetic. Single user, no sharing.

Words go in by hand, by dictionary lookup, by share sheet or by JSON import.
Reviews run on FSRS, ask every word from both sides, grade the pair once, and
work with no signal. `/stats` is four charts over the review log.

Next.js 16 (App Router), TypeScript strict, Tailwind v4, Neon Postgres +
Drizzle, Auth.js (Google, single allowlisted address), `ts-fsrs`, `idb`,
Vitest.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run db:migrate             # apply everything in drizzle/
npm run seed:unihan            # Hán Việt readings from Unihan (~10k rows)
npm run seed:words             # optional: 50 N5 words to start from
npm run dev
```

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon Postgres. Use the **pooled** connection string. |
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Authorised redirect URI: `http://localhost:3000/api/auth/callback/google`, and the deployed equivalent. |
| `ALLOWED_EMAIL` | The only address that can sign in. If unset, nobody can. |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | `tsc --noEmit` — there is no ESLint step |
| `npm test` | Vitest (`test:watch` to watch) |
| `npm run db:generate` | Generate a migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run seed:unihan` | Seed `kanji.han_viet`; idempotent, `-- --fresh` re-downloads |
| `npm run seed:words` | The 50-word N5 starter deck; idempotent, `-- --dry` writes nothing |
| `npm run recompute` | Rebuild every `card_states` row from `review_logs`; `-- --check` reports without writing |

Database scripts load `.env.local` through `dotenv-cli`. Tests are unit-only
and need no database; `npm run recompute -- --check` is the integration check,
refolding every card from its log and reporting any row that does not
reproduce.

## Docs

| Doc | What is in it |
|---|---|
| [architecture.md](docs/architecture.md) | Routes, module map, how a review reaches the database, design decisions |
| [data-model.md](docs/data-model.md) | Tables, relationships, the invariants everything else assumes |
| [review-model.md](docs/review-model.md) | The card model, answer matching, FSRS config, the study day, leeches and confusions |
| [offline.md](docs/offline.md) | The outbox, sync, the service worker, installing as a PWA |
| [import-format.md](docs/import-format.md) | The bulk-import JSON contract, and the prompt that generates a file |

## Not built

`POST /api/draft`. The add form has fields for an AI-drafted Vietnamese meaning
and example sentence; nothing fills them, and no `ANTHROPIC_API_KEY` is read
anywhere.
