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

A card put back by a **learning step** is an ordinary second review, not a
correction — folding it into the first rating would leave a lapsed card stuck
at its lapse instead of walking 1m → 10m out of it. `revises()` is what
distinguishes them, and it reads the repeat flag the screen sets rather than
the face: a step long enough to land behind the word's other face would
otherwise be mistaken for the second half of the pair.

**Where the repeat lands** is `repeatSlot()` in `lib/fsrs/queue.ts`. The step
is a time and the queue is a list, so the step is spent in showings — roughly
`(due − now) / 20s` other questions, never fewer than two, and the end of the
day when the day is shorter than the step. Nothing about `state.due` is
negotiated here; only which questions fill the wait. Before this, every repeat
came back two cards later, which made Hard feel like no interval at all.

## Answering

- A card opens on its face and stays there; nothing about the answer is on the
  prompt side. Either face can be typed instead of turned over, and the choice
  holds for the rest of the session rather than for one card — it is a way of
  studying, not a property of the card. It is session state, so a reload starts
  back on flip cards. A typed meaning card accepts the kanji *or* the kana; a
  typed Japanese card asks only for the reading, since accepting the headword
  there would mark the prompt correct. Esc switches between the two, and is
  the one shortcut that works with the answer field focused — which is where
  you are standing when you want out of it.
- **Matching is exact** (`lib/answer.ts`): NFKC, katakana folded to hiragana, ー
  expanded to the preceding vowel (コーヒー → こおひい), punctuation stripped. No
  edit distance anywhere — in an SRS a near miss is a miss, and じ/ぢ stay apart.
- **Three tries.** A wrong answer reveals nothing and writes nothing; only the
  third gives the answer up. This is not a looser matcher, it is an allowance
  for the fact that a slipped finger and a forgotten word look identical to a
  string comparison. "Chưa nhớ ra" gives up immediately instead, and the space
  bar is bound to it — the same key that turns a flip card over, free to take
  because no answer the field accepts contains a space.
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

## The session budget

`settings.cardsPerSession` (50) is the whole of it: one session deals at most
that many **cards**, and there is no daily ceiling of any kind. Finish a
session and the next one is right there — a card that was rated has a future
`due`, so it simply is not in the next query, and asking again deals the cards
the budget did not reach.

Because every card is asked twice, fifty cards is a hundred-showing session.
The nav badge counts showings, `/stats` counts cards.

`sessionSlots` (`lib/fsrs/queue.ts`) splits the budget, and the same function
answers for the nav badge so the two cannot drift:

- **Due reviews claim slots first.** A due review is a memory already
  decaying; letting it lapse resets its interval, which manufactures more
  reviews. Anki's own guidance for a backlog is to prioritise by forgetting
  risk for exactly this reason.
- **A fifth is held for new words** (`NEW_SHARE`), so a backlog never blocks
  an import outright. The reserve shrinks to however many new words are
  actually waiting, and review slots with no reviews to fill them fall through
  to new words — a fresh collection with nothing due gets a session of fifty
  new words.
- **New words stop once two sessions behind** (`BACKLOG_SESSIONS`). Not a
  daily cap — no counter, nothing resets at 04:00. It is the one brake on a
  model with unlimited sessions per day, where ten sittings would otherwise
  introduce ten batches that all come due together two days later.
- **Learning cards are never dropped, but they do spend the budget.** A card
  put back by a step is mid-thought. Answer `Quên` on thirty words and the
  next session is those thirty plus twenty others — not thirty plus fifty, or
  the number in Cài đặt would stop meaning anything.

Presentation order keeps one new card per five (`NEW_PER_REVIEWS`).
Interleaving is worth the trouble: it hurts performance during the session and
roughly doubles delayed recall, which is why a block of fifty new words in a
row is the worst arrangement of the same cards.

The session carries **the next one with it** (`SessionView.next`). The client
cannot build a queue — it holds no words, sentences or logs for cards it was
never handed — so without a lookahead, finishing a session on a train would
end the day. Two sessions is a hundred cards, less than the single day's queue
this replaced.

## Practice

The reviewer deals what is **due**. Once the day's queue is clear it has
nothing more to offer, however much time is left — which is correct for the
scheduler and unhelpful for the person. `/practice` is the other door: the
newest words you have already met, a page at a time, due dates ignored.

**It writes nothing.** No `review_logs` row, no `card_states` change, nothing
in the outbox, nothing on `/stats`. Reviewing a card early would move its due
date, and answering `Quên` on a healthy card would lapse it — so a drill you
took for extra practice would reshape the schedule you built. Practice is the
Anki *preview*, not *study ahead*.

That is enforced in one place. Every outbound call the reviewer makes goes
through a `Recorder` (`lib/client/recorder.ts`), and practice gets an inert
one. Most of the mode then follows rather than being written twice: with
`enqueue` a no-op nothing can reach `/api/sync`; with `pendingCount` zero the
flush interval never starts; with `takeBack` always true, undo takes its cheap
branch and never asks the server. The leech prompt is suppressed, because
acknowledging it is a server write and the lapse count did not move.

**Grading still happens**, and it has to. The four buttons are what decide
whether a card comes back inside the session — answer `Quên` in practice and
the word returns on its learning step exactly as it would in a review — and
they feed the recap. It is only the writing down that stops.

**What it deals.** The N newest words (`words.created_at desc`, `sort_order`
breaking the tie as ever, read backwards) that are not suspended and not
`State.New`. Brand-new words are excluded deliberately: a word's first showing
belongs to the scheduler, and giving it one here — with nothing recorded —
is the single case where "practice changes nothing" is a loss rather than the
point.

**How it moves.** `settings.practiceWords` (50) is a page, and finishing one
deals the page behind it: 1–50 newest, then 51–100, wrapping at the oldest
back to the newest. A page number rather than a row offset, because the
collection grows underneath it — `practicePage()` in `lib/practice.ts` holds
the arithmetic, and it is pure so the boundaries are pinned by tests. The next
page rides along in `SessionView.next` like the reviewer's, so finishing a
drill on a train deals another.

Its own setting rather than a share of `cardsPerSession`: practice is time you
chose to spend, not work the scheduler asked for, and the two are sized by
different things. None of the budget machinery applies — `sessionSlots` splits
one budget between competing streams, and practice has one stream, no reserve
and no interleave.

## The study day

A study day starts at **04:00 `Asia/Ho_Chi_Minh`** (`lib/fsrs/day.ts`). The
zone is a constant, not a setting. Nothing is capped against it any more; it is
what `/stats` buckets by and what seeds the queue shuffle, so a session running
past midnight stays on one column and does not reshuffle itself at 00:00. A key
taken off `toISOString()` would label every column a day early, consistently
enough to look correct; `tests/stats.test.ts` pins 03:59 against 04:00.

## The recap

When the queue empties, the completion screen lists the words graded `Quên` or
`Khó` — headword, reading, meaning — and copies them as RFC 4180 CSV. Three
columns, no header, quoted, because a Vietnamese meaning carrying a comma
("mở, bật") silently becomes two columns otherwise.

It is folded from the session's *showings*, not from the review standing for
each word (`lib/recap.ts`). The two disagree, and the difference is the point:
a word forgotten at 09:00 and walked back through `1m → 10m` ends the day with
a `Được` against it, which is right for the scheduler and wrong for a list of
what you did not know. Every showing counts, and `worseOf` — the same
comparator the pair rule uses — picks which grade survives.

Client-side, off `answered`, rather than a query over `review_logs`: a rating
can still be sitting in the outbox, and the session most worth recapping is the
one taken with no signal. It is scoped to the **session**, and rides in the
stored session under `missed` only so that a reload mid-session does not empty
it — `answered` is not persisted. Dealing a new session clears it, under the
same condition that clears `graded`. An undo inside its ten seconds takes the
word back out.

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
new-word share of a session.
