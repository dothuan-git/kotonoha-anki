'use client';

import { Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';

import { Ruby } from '@/components/Ruby';
import { MAX_GRAMMAR_SENTENCES, grammarInput, type GrammarInput } from '@/lib/grammar';
import { JLPT_LABELS, JLPT_VALUES, type GrammarView, type Jlpt } from '@/lib/types';

interface SentenceDraft {
  jpRuby: string;
  vi: string;
}

const INPUT =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none';

/** Three empty rows to start: one is required, and three is the number worth aiming for. */
const blankSentences = (): SentenceDraft[] => [
  { jpRuby: '', vi: '' },
  { jpRuby: '', vi: '' },
  { jpRuby: '', vi: '' },
];

/**
 * The grammar point editor, shared by /grammar/add and the inline edit in
 * /grammar/list.
 *
 * Sentence rows left completely blank are dropped before validation, so the
 * form can offer three rows without demanding three sentences. A half-filled
 * row is not dropped: it is a sentence you started, and saving without it
 * would lose it silently.
 */
export function GrammarForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: GrammarView;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: GrammarInput) => void;
  onCancel?: () => void;
}) {
  const [pattern, setPattern] = useState(initial?.pattern ?? '');
  const [meaning, setMeaning] = useState(initial?.meaning ?? '');
  const [formation, setFormation] = useState(initial?.formation ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [jlpt, setJlpt] = useState<Jlpt | ''>(initial?.jlpt ?? '');
  const [sentences, setSentences] = useState<SentenceDraft[]>(
    initial ? initial.sentences.map((s) => ({ jpRuby: s.jpRuby, vi: s.vi })) : blankSentences(),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const updateSentence = (index: number, patch: Partial<SentenceDraft>) =>
    setSentences((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: GrammarInput = {
      pattern,
      meaning,
      formation,
      note,
      jlpt: jlpt || null,
      sentences: sentences
        .filter((s) => s.jpRuby.trim() !== '' || s.vi.trim() !== '')
        .map((s) => ({ jpRuby: s.jpRuby, vi: s.vi })),
    };
    // The server validates again; this only saves a round trip to be told.
    const parsed = grammarInput.safeParse(input);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
      return;
    }
    setLocalError(null);
    onSubmit(input);
  }

  const shownError = localError ?? error;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
        <div>
          <label
            htmlFor="pattern"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Mẫu ngữ pháp
          </label>
          <input
            id="pattern"
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="〜てしまう"
            autoComplete="off"
            className="font-jp-serif w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-xl font-semibold text-[var(--text-primary)] shadow-xs focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
          />
        </div>
        <div>
          <label
            htmlFor="meaning"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Nghĩa tiếng Việt
          </label>
          <input
            id="meaning"
            type="text"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder="lỡ…, mất rồi (tiếc nuối / hoàn tất)"
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-base font-medium text-[var(--text-primary)] shadow-xs focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Cách chia (không bắt buộc)" htmlFor="formation">
          <input
            id="formation"
            type="text"
            value={formation}
            onChange={(e) => setFormation(e.target.value)}
            placeholder="V-て + しまう"
            className={`font-jp-sans ${INPUT}`}
          />
        </Field>
        <Field label="Cấp độ JLPT" htmlFor="grammar-jlpt">
          <select
            id="grammar-jlpt"
            value={jlpt}
            onChange={(e) => setJlpt(e.target.value as Jlpt | '')}
            className={INPUT}
          >
            <option value="">— chưa rõ —</option>
            {JLPT_VALUES.map((value) => (
              <option key={value} value={value}>
                {JLPT_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-muted)]/40 p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            Câu ví dụ ({sentences.length}/{MAX_GRAMMAR_SENTENCES})
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Thẻ hỏi bằng câu tiếng Việt, mỗi lần một câu khác
          </span>
        </div>

        {sentences.map((sentence, i) => (
          <div
            key={i}
            className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">Câu {i + 1}</span>
              {sentences.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSentences((list) => list.filter((_, j) => j !== i))}
                  className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                  aria-label={`Xoá câu ${i + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              type="text"
              value={sentence.vi}
              onChange={(e) => updateSentence(i, { vi: e.target.value })}
              placeholder="Tôi lỡ làm mất ví rồi."
              aria-label={`Câu ${i + 1} tiếng Việt`}
              className={INPUT}
            />
            <input
              type="text"
              value={sentence.jpRuby}
              onChange={(e) => updateSentence(i, { jpRuby: e.target.value })}
              placeholder="財布[さいふ]をなくしてしまった。"
              aria-label={`Câu ${i + 1} tiếng Nhật, furigana trong ngoặc vuông`}
              className={`font-jp-sans ${INPUT}`}
            />
            {sentence.jpRuby.trim() !== '' && (
              <div className="rounded-md bg-[var(--bg-muted)]/60 px-2.5 py-1.5">
                <Ruby text={sentence.jpRuby} className="font-jp-serif text-base" />
              </div>
            )}
          </div>
        ))}

        {sentences.length < MAX_GRAMMAR_SENTENCES && (
          <button
            type="button"
            onClick={() => setSentences((list) => [...list, { jpRuby: '', vi: '' }])}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm câu
          </button>
        )}
      </div>

      <Field label="Ghi chú riêng (không bắt buộc)" htmlFor="grammar-note">
        <input
          id="grammar-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Văn nói: 〜ちゃう"
          className={INPUT}
        />
      </Field>

      {shownError && (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {shownError}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <motion.button
          type="submit"
          whileTap={{ scale: 0.97 }}
          disabled={busy}
          className="flex flex-1 items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-[var(--brand-hover)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Đang lưu…' : submitLabel}
        </motion.button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[var(--border-subtle)] px-3.5 py-3 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            Huỷ
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}
