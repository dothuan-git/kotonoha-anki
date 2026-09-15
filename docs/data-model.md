# Data model

`lib/db/schema.ts` is the single definition. Migrations are generated from it
(`npm run db:generate`) into `drizzle/` and are never hand-written.

## Tables

```
words ──┬── word_kanji ── kanji
        ├── sentences            (one per word)
        ├── cards                (one per word)
        │     ├── card_states    (one per card, derived)
        │     └── review_logs    (append-only)
        └── confusions           (word_id, typed_word_id — append-only)

import_batches ── words          (set null on delete)
settings  dict_cache             (standalone)
```

| Table | Purpose | Notes |
|---|---|---|
| `words` | The vocabulary | Identity is `(headword, reading)`, unique — the same headword recurs with different readings (開ける/あける vs 開ける/ひらける). `sort_order` breaks ties within one `created_at` and carries an import's ordering into the new-card queue. |
| `import_batches` | One row per bulk import | The handle its words hang off, so a batch can be undone as a unit. |
| `kanji` | Hán Việt readings, seeded from Unihan | `meaning_vi` and `jlpt` are hand-filled for the kanji screens. |
| `word_kanji` | Word↔kanji, with position | |
| `sentences` | One example per word, enforced | Stores `jp` and `jp_ruby`; `jp` is derived from the ruby, never typed twice. |
| `cards` | The scheduling identity | One card per word, enforced. `leech_acked_at` is the one bit of review state the log cannot express. |
| `card_states` | **Derived.** The current FSRS state | A projection of `review_logs`, stored only for query speed. |
| `review_logs` | **Append-only.** Every rating | The source of truth for scheduling and for three of the four `/stats` charts. `id` is generated on the device so replay is idempotent. |
| `confusions` | **Append-only.** Wrong answers that named another word you own | Directional. What was typed is not stored — a confusion is a pair of words. |
| `dict_cache` | Jotoba responses by normalised query | No TTL; a dictionary entry does not go stale. |
| `settings` | Single row, `id = 1` | Daily caps, `request_retention`, theme. |

## Invariants

- **`card_states` is a projection, never state.** It is always reproducible by
  folding a card's `review_logs` through FSRS. `lib/db/review.ts` is the only
  thing that writes it, and `npm run recompute -- --check` must stay clean —
  drift means something wrote a state the log does not imply.
- **`review_logs` is append-only, with two exceptions**, both narrow and both
  in `lib/db/review.ts`: the ten-second undo window deletes the row it just
  wrote, and a pair correction replaces a rating under the same id (guarded by
  "still the card's latest review" rather than by time). `confusions` has no
  deletion at all.
- **`applyReview` / `foldLogs` is the one scheduling path.** Sync replay and
  `npm run recompute` both go through it.
- **One card per word, one sentence per word**, both enforced by unique
  indexes. The bounded session queries rely on the first: a `LIMIT 12` on cards
  is twelve words.
- **`learning_steps` is deliberately not stored.** It is a step index the log
  already determines; a stored copy would be a second source of truth. Anything
  needing a real FSRS `Card` folds the log first.
- **`/stats` reads the log, not the projection** — except the forecast, which
  is what the projection is for. Three of the four charts therefore stay
  correct across a recompute that moves every projected row.

## Deletion

Cascades run from `words`: deleting a word takes its sentence, kanji links,
card, card state, review history and confusions. Only two things do not
cascade — `words.import_batch_id` is `set null`, so dropping a batch row means
"stop tracking where these came from" rather than destroying vocabulary, and
`kanji` rows outlive the words that referenced them.
