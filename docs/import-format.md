# Bulk import format

`/add/bulk` takes a `.json` file, previews what it will do, and writes only
after confirmation. The whole file becomes one `import_batches` row and can be
undone as a unit.

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
- **Duplicates are reported before the insert**, by one query on
  `(headword, reading)`, so the preview can say what will be skipped. The
  unique index is still behind the write.
- **The batch shares one `created_at`**, so `sort_order` — the row's position
  in the file — is what carries your ordering into the new-card queue. A
  rejected row spends its position rather than shifting everything after it.
- **Writes are chunked twenty words per `db.batch`.** Neon applies a batch as
  one transaction, so a failed chunk is retried one word at a time and only the
  offending row is reported.
- **Undo deletes the words, then the batch row**, with cascades taking
  sentences, cards and review history — which is why the screen asks first.

## The prompt that generates a file

Paste into Claude, then the word list. Keep in step with `lib/import.ts` if the
format changes.

````
Generate a JSON file to bulk-import Japanese vocabulary into my Anki-style app.

Output ONE JSON code block and nothing else — no commentary before or after.

Shape:
{
  "source": "<short name for this batch, e.g. the textbook lesson>",
  "words": [ { …one object per word, in the order I gave them… } ]
}

Fields per word:

- "headword"  (required) The word as written in Japanese — kanji if it has kanji.
- "reading"   (required) The reading in HIRAGANA ONLY (katakana for loanwords).
              Never any kanji here. The app speaks this field aloud.
- "meaning"   (required) The Vietnamese meaning. Several senses separated by commas.
- "pos"       (required) EXACTLY one of these English strings:
                "Noun", "Verb 1", "Verb 2", "Verb 3", "I-adjective",
                "Na-adjective", "Adverb", "Particle", "Conjunction",
                "Counter", "Expression"
              Verb 1 = godan/五段 (飲む, 書く). Verb 2 = ichidan/一段 (食べる, 見る).
              Verb 3 = irregular (する, 来る, and every 〜する compound verb).
              A noun like 勉強 that takes する stays "Noun".
- "transitivity" (verbs only, omit otherwise) "transitive" or "intransitive".
- "jlpt"      (optional) One of "N5", "N4", "N3", "N2", "N1".
- "note"      (optional) A short Vietnamese usage note. Omit if you have nothing useful.
- "hanViet"   (optional) Object mapping each kanji in the headword to its Hán Việt
              reading(s), lowercase, as an array: { "勉": ["miễn"], "強": ["cường"] }.
- "sentence"  (optional but please include one) An example sentence:
              { "jpRuby": "<sentence with furigana>", "vi": "<Vietnamese translation>" }

Furigana format for "jpRuby" — this is the part to get exactly right:

  Put the reading in square brackets immediately after each kanji run.
  A bracket group annotates ONLY the kanji directly before it, never the
  okurigana or the kana around it.

    毎日[まいにち]日本語[にほんご]を勉強[べんきょう]します。
    窓[まど]を開[あ]けてください。        ← 開[あ], NOT 開ける[あける]
    友[とも]達[だち]                      ← WRONG, write 友達[ともだち]

  A run of adjacent kanji is annotated as one group with its whole reading.
  Kana needs no brackets. Do NOT include a separate plain-text version of the
  sentence — the app derives it.

Rules:
- Keep my order. The app introduces the words in the order they appear in the file.
- Every word exactly once. Do not invent words I did not give you.
- Keep sentences short and at or below the word's JLPT level, and make sure each
  sentence actually uses its headword.
- Valid JSON: double quotes, no trailing commas, no comments.

Here are the words:
````
