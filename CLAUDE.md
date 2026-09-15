@AGENTS.md

# Kotonoha

Private Japanese vocabulary trainer, Vietnamese meanings. Single user, offline
first. Next.js 16 App Router, TypeScript strict, Tailwind v4, Neon + Drizzle,
Auth.js, `ts-fsrs`, `idb`, Vitest.

Setup and scripts are in [README.md](README.md).

```bash
npm run lint                   # tsc --noEmit, the only lint step
npm test                       # vitest run
npm run db:generate            # migration from lib/db/schema.ts
npm run recompute -- --check   # refold every card from its log, report drift
```

Run `npm run lint` and `npm test` before calling a change done. If the change
touches scheduling, run the recompute check too.

## Read before changing

| Touching | Read |
|---|---|
| Schema, migrations, anything storing review history | [docs/data-model.md](docs/data-model.md) |
| `lib/fsrs/*`, `ReviewScreen`, `lib/answer.ts`, `/stats` | [docs/review-model.md](docs/review-model.md) |
| `lib/client/*`, `/api/sync`, `public/sw.js` | [docs/offline.md](docs/offline.md) |
| `lib/import.ts`, `/api/import` | [docs/import-format.md](docs/import-format.md) |
| Routes, module boundaries, anything unfamiliar | [docs/architecture.md](docs/architecture.md) |

## Hard rules

Breaking one of these is a bug even when it type-checks.

1. **`card_states` is a projection of `review_logs`.** Only `lib/db/review.ts`
   writes it, always from a fold. `npm run recompute -- --check` must stay
   clean.
2. **`review_logs` is append-only**, except the ten-second undo and the pair
   correction, both already in `lib/db/review.ts`. `confusions` never deletes.
3. **`applyReview` / `foldLogs` is the one scheduling path.** Do not add a
   second way to write a review.
4. **Every rating goes through the outbox and `/api/sync`**, online or not. No
   direct-write fast path for the connected case.
5. **One card per word, asked twice, graded once** on the worse answer.
6. **Never import a *value* from `lib/db/*` into a client component** — it
   pulls the database client into the browser bundle and throws at runtime.
   Type-only imports are fine.
7. **The reading is what gets spoken**, never the headword. A reading
   containing kanji is invalid.
8. **Matching is exact** (`lib/answer.ts`). No fuzzy matching, no edit
   distance, anywhere.

## Conventions

- UI copy is Vietnamese; code, comments and docs are English.
- Server actions return `ActionResult` rather than throwing at the screen.
- Pure logic lives in `lib/` and gets a Vitest test; tests use no database.
- Schema changes go through `npm run db:generate`, never hand-written SQL.
- Keep the docs current when behaviour changes — in particular the prompt in
  [docs/import-format.md](docs/import-format.md) if the import format moves.
