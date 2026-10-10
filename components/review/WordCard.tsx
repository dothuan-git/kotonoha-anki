'use client';

import { Check, Sparkles, Volume2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { AnswerInput } from '@/components/AnswerInput';
import { ReviewEditPanel, type ReviewEdit } from '@/components/ReviewEditPanel';
import { Ruby } from '@/components/Ruby';
import type { Attempt, FontStyle } from '@/components/review/types';
import { playSentenceAudio, playWordAudio } from '@/lib/client/audio';
import { formatHanViet, formatPos, type Face, type WordView } from '@/lib/types';

/**
 * The inside of a word card: its tags and controls, the prompt, the answer
 * field or the reveal hint, and the answer once given up.
 *
 * The session around it — the queue, grading, undo, the card's frame and the
 * rating row — is the reviewer's and does not care what kind of card this is.
 * What is here is everything that reads `WordView`.
 */
export function WordCard({
  cardId,
  word,
  face,
  done,
  isRevealed,
  typing,
  attempt,
  attemptSeq,
  saving,
  editing,
  fontStyle,
  setFontStyle,
  onAnswer,
  onEditSave,
  onEditCancel,
}: {
  cardId: string;
  word: WordView;
  face: Face;
  /** Showings answered so far — part of the answer field's remount key. */
  done: number;
  isRevealed: boolean;
  typing: boolean;
  attempt: Attempt | null;
  attemptSeq: number;
  saving: boolean;
  editing: boolean;
  fontStyle: FontStyle;
  setFontStyle: (style: FontStyle) => void;
  onAnswer: (attempt: Attempt) => void;
  onEditSave: (patch: ReviewEdit) => void;
  onEditCancel: () => void;
}) {
  const hanViet = formatHanViet(word.kanji);
  // The prompt side never changes once the card is on screen: the face decides
  // it, and revealing adds the answer underneath rather than turning the card
  // over. So a meaning card still reads as the meaning after you have answered
  // it, with the word it was asking for below.
  const asking = face === 'meaning';
  /**
   * What typing asks for. With the meaning on screen the answer is the word,
   * and the kanji or the kana will both do. With the word on screen the only
   * thing left to ask is its reading — accepting the headword there would be
   * marking the card's own prompt correct.
   */
  const expecting: 'word' | 'reading' = asking ? 'word' : 'reading';
  // Hearing the word before you have recalled it is the answer, out loud.
  const canHearWord = !asking || isRevealed;
  /**
   * The answer, in rows, ordered so the thing the card actually asked for
   * comes first and the half already on the prompt side never repeats.
   *
   * Hán Việt is not a row. The word card already wears it as a tag above its
   * headword, so a row would be the same fact twice; the meaning card has no
   * headword up there to hang it on, so it goes under the rows instead.
   */
  const revealedRows: RevealedRow[] = asking
    ? [
        { label: 'Từ tiếng Nhật', value: word.headword, kind: 'headword' },
        // A kana-only word is its own reading. Printing it twice under two
        // labels reads as a mistake rather than as a fact about the word.
        ...(word.reading === word.headword
          ? []
          : [{ label: 'Cách đọc', value: word.reading, kind: 'reading' as const }]),
      ]
    : [
        { label: 'Cách đọc', value: word.reading, kind: 'reading' },
        { label: 'Nghĩa tiếng Việt', value: word.meaning, kind: 'vietnamese' },
      ];

  return (
    <>
      {/* Card Header Tags */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {word.jlpt && (
            <span className="px-2.5 py-0.5 rounded-md bg-[var(--brand-subtle)] border border-[var(--brand-border)]/50 text-[var(--brand)] text-xs font-semibold">
              {word.jlpt}
            </span>
          )}
          <span className="text-xs text-[var(--text-muted)] font-medium">
            {formatPos(word.pos, word.transitivity)}
          </span>
        </div>

        {/*
          The card's own controls: how the word is set, and how it sounds.
          The speaker sits here rather than up in the session bar because
          both of these act on the word in front of you, while everything
          in that bar — progress, sync, the answer mode — acts on the
          session. Sorting them that way puts each control next to the
          thing it changes.
        */}
        <div className="flex items-center gap-1.5">
          {/* Dedicated Japanese Font Toggle (Mincho Serif vs Gothic Sans) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFontStyle(fontStyle === 'mincho' ? 'gothic' : 'mincho');
            }}
            className="px-2 py-0.5 rounded-md text-[11px] font-medium border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 hover:bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1 transition-colors"
            title="Đổi phông chữ tiếng Nhật (Mincho Serif / Gothic Sans)"
          >
            <span
              className={
                fontStyle === 'mincho'
                  ? 'font-jp-serif font-bold text-[var(--brand)]'
                  : 'font-jp-sans'
              }
            >
              {fontStyle === 'mincho' ? '明朝 (Serif)' : 'ゴシック (Sans)'}
            </span>
          </button>

          {/*
            Gated by `canHearWord`, and the click stops here: the card
            itself is the reveal target, so a speaker that bubbled would
            turn the card over on its way to making a sound.
          */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playWordAudio(word);
            }}
            disabled={!canHearWord}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--brand)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            title={canHearWord ? 'Nghe phát âm' : 'Nghe phát âm sau khi trả lời'}
          >
            <Volume2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Center: the prompt — the headword, or the meaning to produce it from */}
      <div className="relative flex min-h-fit flex-1 flex-col justify-center py-6 text-center">
        {/*
          Switching into typing does not replace the word, it makes room:
          the word steps up, and the field opens outward from the middle
          underneath it.

          The step up is the layout's own — a centred column with a field
          added below it puts the word higher, and `layout` is what turns
          that jump into a movement. Animating `y` by hand on top of it
          would be a second, disagreeing answer to where the word goes.

          `popLayout` everywhere below, rather than `wait`, for the same
          reason: what is leaving drops out of the flow immediately, so the
          word begins moving on the frame the field arrives instead of
          waiting out a fade first. `wait` is what made this feel stepped.
        */}
        <motion.div
          layout
          transition={{ layout: { type: 'spring', stiffness: 240, damping: 30, mass: 0.8 } }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={asking ? 'meaning' : 'word'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              {asking ? (
                <>
                  <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                    Nghĩa tiếng Việt
                  </span>
                  <p className="mt-1.5 text-3xl sm:text-4xl font-bold leading-snug text-[var(--text-primary)]">
                    {word.meaning}
                  </p>
                  {!isRevealed && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {typing
                        ? 'Gõ từ tiếng Nhật — kanji hoặc hiragana đều được'
                        : 'Nhớ lại từ tiếng Nhật'}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h1
                    className={`text-5xl sm:text-6xl text-[var(--text-primary)] select-all transition-all ${
                      fontStyle === 'mincho'
                        ? 'font-jp-serif font-medium sm:font-semibold tracking-wide'
                        : 'font-jp-sans font-bold tracking-tight'
                    }`}
                  >
                    {word.headword}
                  </h1>

                  {/* Hán Việt reading tag */}
                  {hanViet !== '—' && (
                    <div className="mt-3">
                      <HanVietTag hanViet={hanViet} />
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* The field, or the invitation to turn the card over */}
        <AnimatePresence mode="popLayout" initial={false}>
          {!isRevealed &&
            (typing ? (
              <motion.div
                key="typing"
                initial={{ opacity: 0, clipPath: 'inset(0% 44% 0% 44%)' }}
                animate={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
                exit={{ opacity: 0, clipPath: 'inset(0% 44% 0% 44%)' }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <AnswerInput
                  // The input is uncontrolled, so it has to be remounted
                  // rather than cleared — and the tries spent live inside
                  // it, so a reused node would carry them to the next card.
                  // `done` matters as much as the card id: on a short queue
                  // a learning step can put the same showing straight back.
                  key={`${cardId}-${face}-${done}-${attemptSeq}`}
                  word={word}
                  expect={expecting}
                  disabled={saving}
                  onAnswer={onAnswer}
                />
              </motion.div>
            ) : (
              <motion.div
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="mt-8 text-xs text-[var(--text-muted)] flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-[var(--brand)]" />
                <span>Chạm hoặc bấm Phím cách để xem đáp án</span>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      {/* Revealed Content: Meaning, Furigana & Example Sentence */}
      <AnimatePresence>
        {isRevealed && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 6 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: 6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="border-t border-[var(--border-subtle)] pt-5 space-y-3.5 overflow-hidden"
          >
            {attempt && <Verdict attempt={attempt} />}

            {/*
              What the card was asking for, which is the half that is not
              already above. Both faces go through the same rows in a
              different order — see `RevealedRows`, which is what keeps
              them from drifting into two layouts again.
            */}
            <RevealedRows rows={revealedRows} fontStyle={fontStyle} />
            {asking && hanViet !== '—' && (
              <div>
                <HanVietTag hanViet={hanViet} />
              </div>
            )}

            {word.note && (
              <div>
                <span className="text-[11px] text-[var(--text-muted)] block font-medium">
                  Ghi chú
                </span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                  {word.note}
                </p>
              </div>
            )}

            {/* Example Sentence with Furigana */}
            {word.sentences.map((sentence) => (
              <div
                key={sentence.id}
                className="p-3 rounded-xl bg-[var(--bg-muted)]/70 border border-[var(--border-subtle)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Ruby
                      text={sentence.jpRuby}
                      className="font-jp-sans text-sm sm:text-base font-medium text-[var(--text-primary)] leading-relaxed"
                    />
                    <p className="text-xs text-[var(--text-secondary)] mt-1">{sentence.vi}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playSentenceAudio(sentence);
                    }}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--brand)] shrink-0 cursor-pointer"
                    title="Nghe câu ví dụ"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {editing && (
              <ReviewEditPanel
                word={word}
                saving={saving}
                onCancel={onEditCancel}
                onSave={onEditSave}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * One line of the answer: what it is called, and what it says.
 *
 * `kind` rather than a className, because the whole point of routing both
 * faces through one component is that neither of them can restyle its own
 * copy. A reading looks like a reading whichever side of the card asked for it.
 */
interface RevealedRow {
  label: string;
  value: string;
  kind: 'headword' | 'reading' | 'vietnamese';
}

/**
 * The size a Japanese value is set at — a headword or a reading, on either
 * face. One constant rather than the same two classes written twice, because
 * two strings that happen to agree are two chances to disagree later.
 *
 * The Vietnamese gloss keeps its own smaller size below. That is the word
 * card's scale, unchanged; what moved is the meaning card, which had been
 * setting its headword a step larger than anything the word card ever used.
 */
const JP_ROW_SIZE = 'text-xl sm:text-2xl';

const ROW_STYLES: Record<RevealedRow['kind'], string> = {
  headword: `${JP_ROW_SIZE} text-[var(--text-primary)] select-all`,
  reading: `font-jp-serif ${JP_ROW_SIZE} font-semibold tracking-wide text-[var(--brand)]`,
  vietnamese: 'text-base font-semibold leading-snug text-[var(--text-primary)]',
};

/**
 * The answer, once the card has given it up.
 *
 * Both faces render through here and differ only in which rows they pass and
 * in what order: the word card asks for a reading and shows the meaning under
 * it, the meaning card asks for the word and shows its reading under that.
 *
 * They used to be two hand-written blocks, and had drifted into two layouts
 * with two sets of sizes for the same three facts — a grouped stack with one
 * speaker on one side, labelled rows with their own speakers on the other.
 * Which rows appear is the caller's business; how a row looks is not.
 */
function RevealedRows({
  rows,
  fontStyle,
}: {
  rows: readonly RevealedRow[];
  fontStyle: FontStyle;
}) {
  const jpWeight =
    fontStyle === 'mincho'
      ? 'font-jp-serif font-medium tracking-wide'
      : 'font-jp-sans font-bold tracking-tight';

  return (
    <>
      {rows.map(({ label, value, kind }) => (
        <div key={label} className="min-w-0">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
          <p className={`mt-0.5 ${ROW_STYLES[kind]} ${kind === 'headword' ? jpWeight : ''}`}>
            {value}
          </p>
        </div>
      ))}
    </>
  );
}

/** `開 KHAI · 始 THỦY`, in the one shape both faces use for it. */
function HanVietTag({ hanViet }: { hanViet: string }) {
  return (
    <span className="inline-block rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
      Hán Việt: {hanViet}
    </span>
  );
}

/**
 * What you typed, against what the card wanted.
 *
 * A wrong answer shows the attempt back verbatim — without it you cannot tell
 * a mistype from a genuinely wrong reading, which is exactly the judgement
 * "gõ nhầm" asks you to make.
 */
function Verdict({ attempt }: { attempt: Attempt }) {
  if (attempt.correct) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-subtle)] px-3 py-2 text-sm font-semibold text-[var(--brand)]">
        <Check className="h-4 w-4 shrink-0" />
        <span>Chính xác</span>
        {/* Which try it took, because it is the thing the grade should turn
            on and the only record of it is about to disappear. */}
        {attempt.attempts > 1 && (
          <span className="font-normal opacity-80">— lượt thứ {attempt.attempts}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
      <X className="h-4 w-4 shrink-0" />
      <span className="font-semibold">Chưa đúng</span>
      {attempt.input.trim() && (
        <span className="font-jp-serif truncate opacity-80">— bạn gõ: {attempt.input}</span>
      )}
    </div>
  );
}
