# Bulk import format

`/add/bulk` takes a `.json` file of words, and `/grammar/add/bulk` one of
grammar points ([below](#grammar-files)). Both preview what they will do and
write only after confirmation. The whole file becomes one `import_batches` row,
tagged with its `kind`, and can be undone as a unit from the screen it came in
through.

## File shape

```json
{
  "source": "Minna no Nihongo, lesson 12",
  "words": [ { "headword": "…", "…": "…" } ]
}
```

| Field | Required | Notes |
|---|---|---|
| `headword` | yes | The word as written, kanji included. |
| `reading` | yes | Kana only. **Kanji here is rejected** — this field is what gets spoken. |
| `meaning` | yes | Vietnamese; senses separated by commas. |
| `pos` | yes | One of `Noun`, `Verb 1`, `Verb 2`, `Verb 3`, `I-adjective`, `Na-adjective`, `Adverb`, `Particle`, `Conjunction`, `Counter`, `Expression`. |
| `transitivity` | verbs | `transitive` or `intransitive`. |
| `jlpt` | no | `N5`–`N1`. |
| `note` | no | Vietnamese, up to 2000 characters. |
| `hanViet` | no | `{ "勉": ["miễn"], "強": ["cường"] }`; a bare string is accepted. |
| `sentence` | no | `{ "jpRuby": "窓[まど]を開[あ]けてください。", "vi": "…" }`. |

Unknown keys are ignored. At most 1000 words per file.

**Ruby format:** the bracket group annotates only the kanji run immediately
before it — 開[あ]ける, never 開ける[あける]. `sentence.jp` is derived from `jpRuby`
and ignored if supplied: nobody typed the plain text, so a generated file
disagreeing with itself is a failure mode worth removing rather than reporting.

## Behaviour

- **The parser is pure** (`lib/import.ts`, no database), so the preview and the
  committed rows come out of the same function — there is no second parser to
  disagree with the first.
- **The file is uploaded twice**: once with `dryRun=1` for the preview, once to
  commit. Nothing half-finished is parked on the server between them, and the
  duplicate check is made fresh both times. It is a route handler rather than a
  server action because server action bodies are capped at 1 MB.
- **Words can be struck off in the preview.** The X on a row drops it and the
  arrow puts it back; the commit post carries an `exclude` field, a JSON array
  of the file positions to skip, and `applyExclusions` clears their `data` so
  the insert never sees them. Positions travel rather than words: the server
  re-parses the same bytes, so nothing about the row has to be trusted from the
  round trip.
- **A row opens its detail on click** — part of speech, Hán Việt, sentences,
  note; for grammar, formation and every sentence. ←/→ step through the rows
  and a row can be struck off from there. Each preview row carries a
  `detail` built from the parse (`previewDetails`) before the duplicate check
  and the exclusions clear `data`, so a skipped row still shows what the file
  says. It is display fields only, never the insert payload. An invalid row has
  no detail; its reason is the whole story.
- **A row can be fixed before the import.** "Sửa" turns the dialog's card
  into a form, and a refused row opens straight in it with the parser's
  reason above. Saving writes the row back into the file in the browser
  (`lib/import-edit.ts`) and posts the edited file for a fresh dry run; the
  edited file is what the commit posts too. So an edit is judged by the same
  parser and duplicate check as the file — the form validates nothing, and
  the server trusts an edited row no more than any other. Keys the form does
  not show (`hanViet`, unknown ones) are kept as the file had them.
- **Duplicates are reported before the insert**, by one query on
  `(headword, reading)`, so the preview can say what will be skipped. The
  unique index is still behind the write.
- **The batch shares one `created_at`**, so `sort_order` — the row's position
  in the file — is what carries your ordering into the new-card queue. A
  rejected or struck-off row spends its position rather than shifting
  everything after it.
- **Writes are chunked twenty words per `db.batch`.** Neon applies a batch as
  one transaction, so a failed chunk is retried one word at a time and only the
  offending row is reported.
- **Undo deletes the words, then the batch row**, with cascades taking
  sentences, cards and review history — which is why the screen asks first.

## Grammar files

```json
{
  "source": "Minna no Nihongo, ngữ pháp bài 12",
  "grammar": [ { "pattern": "〜てしまう", "…": "…" } ]
}
```

| Field | Required | Notes |
|---|---|---|
| `pattern` | yes | The pattern as a grammar book writes it: `〜てしまう`. |
| `meaning` | yes | Vietnamese, one meaning. A pattern with several distinct meanings is one object per meaning — each its own card, scheduled apart. |
| `formation` | no | How it attaches: `V-て + しまう`. |
| `jlpt` | no | `N5`–`N1`. |
| `note` | no | Vietnamese, up to 2000 characters. |
| `sentences` | yes | 1–2 of `{ "jpRuby": "…", "vi": "…" }`. Same ruby rules as a word's sentence; a sentence with kanji and no furigana is rejected. |

The same route takes it — `POST /api/import` with `kind=grammar` — through the
same two passes, struck-off rows and chunked writes. What differs is the
parser (`parseGrammarImport`), the identity a duplicate is judged on
(`(pattern, meaning)`, not the pattern alone) and the table written.

The card asks with the Vietnamese sentence and the pattern, and you say the
Japanese; so the Vietnamese has to be natural, and the Japanese has to be the
answer you would want to give — a sentence that only works with some *other*
pattern is a card you will fail correctly.

## The prompts that generate a file

Each is a plain-text file: copy the whole file into Claude, then paste your
list after the last line.

| Prompt | List to paste | Keep in step with |
|---|---|---|
| [prompts/import-words.txt](prompts/import-words.txt) | Words | `parseImport` in `lib/import.ts` |
| [prompts/import-grammar.txt](prompts/import-grammar.txt) | Grammar points, one per line. `〜ために (mục đích)` asks for that one meaning; a bare pattern gets one object per distinct meaning. | `parseGrammarImport` in `lib/import.ts` |

If the format changes, change the prompt in the same commit.
