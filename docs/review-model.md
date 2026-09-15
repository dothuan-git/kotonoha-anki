# Review model

## One word, one card, two faces

A word is a single card with a single schedule, asked **twice per session and
graded once**: the Japanese on one showing, the Vietnamese meaning on the
other. Ten words due is twenty showings, shuffled with the two halves of a word
kept at least three cards apart.

Knowing 開ける on sight and producing it from "mở" are two questions about one
thing you either know or do not, so they collapse into one review — graded on
the **worse** of the two answers. `lib/fsrs/pair.ts` holds the rule:

1. The first face answered writes the review and starts its own undo window.
2. The second face, if worse, corrects it — by taking back the first rating if
   it is still unsent, otherwise by re-queueing under the same
   `review_logs.id`. `applyReview` treats a known id with a different rating as
   a correction rather than a duplicate. A second face that is as good or
   better writes nothing.
3. Quitting mid-pair leaves the grade you gave; the correction flushes on the
   next open.

A card put back by a **learning step** wears the same face and is an ordinary
second review, not a correction — folding it into the first rating would leave
a lapsed card stuck at its lapse instead of walking 1m → 10m out of it.
`revises()` is what distinguishes them.

## Answering

- A card opens on its face and stays there; nothing about the answer is on the
  prompt side. Either face can be typed instead of turned over, one card at a
  time. A typed meaning card accepts the kanji *or* the kana; a typed Japanese
  card asks only for the reading, since accepting the headword there would mark
  the prompt correct.
- **Matching is exact** (`lib/answer.ts`): NFKC, katakana folded to hiragana, ー
  expanded to the preceding vowel (コーヒー → こおひい), punctuation stripped. No
  edit distance anywhere — in an SRS a near miss is a miss, and じ/ぢ stay apart.
- **Three tries.** A wrong answer reveals nothing and writes nothing; only the
  third gives the answer up. This is not a looser matcher, it is an allowance
  for the fact that a slipped finger and a forgotten word look identical to a
  string comparison. "Chưa nhớ ra" gives up immediately instead.
- **The user grades.** All four buttons are offered however the card went. "Gõ
  nhầm" writes nothing at all — no rating, no log row, no state change.
- **Undo is ten seconds** and is the one deletion `review_logs` permits. It is
  bounded by the row's `reviewed_at`, not by the client's countdown, and only
  the card's most recent review can be taken back.
- **The reading is what gets spoken**, never the headword — which is why a
  reading containing kanji is invalid on import.

## Scheduling

FSRS via `ts-fsrs`, configured in one place (`lib/fsrs/params.ts`):

| | |
|---|---|
| Learning steps | `1m → 10m` |
| Relearning steps | `10m` |
| Maximum interval | 365 days |
| Fuzz | on (seeded from the card, so a replay lands on the same date) |
| `request_retention` | 0.9, the only value the user can change |
| Leech threshold | 6 lapses |
| New-card interleave | at most one per five reviews |

State is a fold: `lib/fsrs/replay.ts` replays a card's log, and the result is
stored in `card_states` for query speed only. The fold seeds from
`words.created_at`, so an untouched card recomputes to the same row a year
later rather than to "now". Changing `request_retention` therefore reschedules
the whole collection on the next `npm run recompute`, not just future reviews.

**Known deviation.** The config reads as though a graduating interval were one
day, but the intervals come from the model's weights, not the knobs. With the
stock FSRS-5 weights, repeated `Good` runs 10m → 2d → 11d → 44d → 164d → 357d →
365d, and `Easy` on a new card lands around 9 days. Matching the naive
prediction would mean overriding `w[2]` and `w[3]`, which distorts the model's
own first-review estimates; left alone deliberately.

## The study day and the caps

A study day starts at **04:00 `Asia/Ho_Chi_Minh`** (`lib/fsrs/day.ts`), so a
session running past midnight still counts against the day it began. The zone
is a constant, not a setting.

`newPerDay` (12) and `reviewsPerDay` (100) count **cards**, once each: a new
card walking its learning steps does not also spend a review slot. Because
every card is asked twice, twelve new cards is a twenty-four showing session —
the nav badge counts showings, `/stats` counts cards.

Everything bucketed by day — the caps, the `/stats` columns — uses this
boundary, not the calendar day. A key taken off `toISOString()` would label
every column a day early, consistently enough to look correct;
`tests/stats.test.ts` pins 03:59 against 04:00.

## Leeches and confusions

**Leeches.** At six lapses a card raises a prompt **once**. The lapse count is
folded from the log like everything else; what the log cannot say is whether
the prompt has been shown, so that single bit is `cards.leech_acked_at`. The
prompt is an editor — rewrite the meaning or add a note, there and then — and
both saving and dismissing acknowledge it. It never offers to suspend or delete
the word: the moment you have just failed it six times is the worst moment to
make that decision. The device can raise the prompt offline; acknowledging it
is a server write, so with no signal the card is simply flagged again next
session.

**Confusions.** A wrong answer typed from the meaning that turns out to name
another word in the collection — あける for 開く. It rides the outbox next to the
rating, and the server resolves it, because the device holds only the day's
queue and cannot know which other words exist. Resolution runs through
`normaliseAnswer` and nothing else: the rule that decided the answer was wrong
decides which word it was right about. An ambiguous attempt is dropped — 上る
and 登る are both のぼる, and recording one at random would put a fact on `/stats`
that nobody observed.

## `/stats`

Four charts, all pure functions in `lib/stats.ts`: reviews per day (new vs
review, 30/90 days), the 30-day forecast, weekly retention against
`request_retention`, and collection maturity by stability (split at 21 and 90
days). Two rules they follow, both to avoid saying something the data does not:
ratings on brand-new cards are excluded from retention, and new cards are
excluded from the forecast — their due date is their creation time, so all of
them are "overdue" by construction and what actually releases them is the
daily cap.
