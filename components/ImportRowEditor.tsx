'use client';

import { useState, type FormEvent, type ReactNode } from 'react';

import { Ruby } from '@/components/Ruby';
import {
  grammarDraft,
  grammarPatch,
  wordDraft,
  wordPatch,
  type GrammarDraft,
  type RawRow,
  type SentenceDraft,
  type WordDraft,
} from '@/lib/import-edit';
import {
  JLPT_LABELS,
  JLPT_VALUES,
  POS_LABELS,
  POS_VALUES,
  type CardKind,
  type Jlpt,
  type Pos,
} from '@/lib/types';

const INPUT =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none';

/**
 * The form a previewed row is fixed in, filled from what the file has.
 *
 * It validates nothing: the patch goes back into the file and the file is
 * checked again by the same parser as before, whose reason is shown above the
 * form if the row is still refused. The submit buttons live in the dialog's
 * footer and reach this form by `id`.
 */
export function ImportRowEditor({
  id,
  kind,
  row,
  problem,
  onSubmit,
}: {
  id: string;
  kind: CardKind;
  row: RawRow;
  /** Why the row is refused or skipped, as the last check said. */
  problem?: string;
  onSubmit: (patch: RawRow) => void;
}) {
  return (
    <div className="space-y-4">
      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-3 py-2 text-xs font-medium text-[var(--danger)]"
        >
          {problem}
        </p>
      )}
      {kind === 'word' ? (
        <WordEditor id={id} row={row} onSubmit={onSubmit} />
      ) : (
        <GrammarEditor id={id} row={row} onSubmit={onSubmit} />
      )}
    </div>
  );
}

function WordEditor({
  id,
  row,
  onSubmit,
}: {
  id: string;
  row: RawRow;
  onSubmit: (patch: RawRow) => void;
}) {
  const [draft, setDraft] = useState<WordDraft>(() => wordDraft(row));
  const set = (patch: Partial<WordDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const isVerb = draft.pos.startsWith('Verb');

  return (
    <form id={id} onSubmit={submit(() => onSubmit(wordPatch(draft)))} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Từ">
          <input
            autoFocus
            lang="ja"
            value={draft.headword}
            onChange={(e) => set({ headword: e.target.value })}
            className={`font-jp-sans ${INPUT}`}
          />
        </Field>
        <Field label="Cách đọc (kana)">
          <input
            lang="ja"
            value={draft.reading}
            onChange={(e) => set({ reading: e.target.value })}
            className={`font-jp-sans ${INPUT}`}
          />
        </Field>
      </div>

      <Field label="Nghĩa tiếng Việt">
        <input
          value={draft.meaning}
          onChange={(e) => set({ meaning: e.target.value })}
          className={INPUT}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Từ loại">
          <select
            value={draft.pos}
            onChange={(e) => set({ pos: e.target.value as Pos | '' })}
            className={INPUT}
          >
            <option value="">— chọn —</option>
            {POS_VALUES.map((value) => (
              <option key={value} value={value}>
                {POS_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tự / tha động từ">
          <select
            value={isVerb ? draft.transitivity : ''}
            disabled={!isVerb}
            onChange={(e) => set({ transitivity: e.target.value as WordDraft['transitivity'] })}
            className={`${INPUT} disabled:opacity-50`}
          >
            <option value="">—</option>
            <option value="transitive">Tha động từ</option>
            <option value="intransitive">Tự động từ</option>
          </select>
        </Field>
        <JlptField value={draft.jlpt} onChange={(jlpt) => set({ jlpt })} />
      </div>

      <NoteField value={draft.note} onChange={(note) => set({ note })} />

      <Field label="Câu ví dụ" group>
        <SentenceInputs
          sentence={draft.sentence}
          onChange={(sentence) => set({ sentence })}
          japaneseFirst
        />
      </Field>
    </form>
  );
}

function GrammarEditor({
  id,
  row,
  onSubmit,
}: {
  id: string;
  row: RawRow;
  onSubmit: (patch: RawRow) => void;
}) {
  const [draft, setDraft] = useState<GrammarDraft>(() => grammarDraft(row));
  const set = (patch: Partial<GrammarDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <form id={id} onSubmit={submit(() => onSubmit(grammarPatch(draft)))} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mẫu ngữ pháp">
          <input
            autoFocus
            lang="ja"
            value={draft.pattern}
            onChange={(e) => set({ pattern: e.target.value })}
            className={`font-jp-sans ${INPUT}`}
          />
        </Field>
        <Field label="Cấu trúc">
          <input
            lang="ja"
            value={draft.formation}
            onChange={(e) => set({ formation: e.target.value })}
            placeholder="V-て + しまう"
            className={`font-jp-sans ${INPUT}`}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Nghĩa">
          <input
            value={draft.meaning}
            onChange={(e) => set({ meaning: e.target.value })}
            className={INPUT}
          />
        </Field>
        <JlptField value={draft.jlpt} onChange={(jlpt) => set({ jlpt })} />
      </div>

      <NoteField value={draft.note} onChange={(note) => set({ note })} />

      {draft.sentences.map((sentence, i) => (
        <Field key={i} label={`Câu ví dụ ${i + 1}`} group>
          <SentenceInputs
            sentence={sentence}
            onChange={(next) =>
              set({ sentences: draft.sentences.map((s, j) => (j === i ? next : s)) })
            }
          />
        </Field>
      ))}
    </form>
  );
}

/**
 * A sentence as two inputs and its ruby rendered underneath, so a bracket in
 * the wrong place shows before the file is checked again. A grammar card asks
 * with the Vietnamese, so that is what leads there.
 */
function SentenceInputs({
  sentence,
  onChange,
  japaneseFirst = false,
}: {
  sentence: SentenceDraft;
  onChange: (sentence: SentenceDraft) => void;
  japaneseFirst?: boolean;
}) {
  const japanese = (
    <input
      key="jp"
      lang="ja"
      value={sentence.jpRuby}
      onChange={(e) => onChange({ ...sentence, jpRuby: e.target.value })}
      placeholder="財布[さいふ]をなくした。"
      aria-label="Tiếng Nhật, furigana trong ngoặc vuông"
      className={`font-jp-sans ${INPUT}`}
    />
  );
  const vietnamese = (
    <input
      key="vi"
      value={sentence.vi}
      onChange={(e) => onChange({ ...sentence, vi: e.target.value })}
      placeholder="Tiếng Việt"
      aria-label="Tiếng Việt"
      className={INPUT}
    />
  );

  return (
    <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-2.5">
      {japaneseFirst ? [japanese, vietnamese] : [vietnamese, japanese]}
      {sentence.jpRuby.trim() !== '' && (
        <div className="px-1 pt-1">
          <Ruby text={sentence.jpRuby} className="font-jp-sans text-base text-[var(--text-primary)]" />
        </div>
      )}
    </div>
  );
}

function JlptField({ value, onChange }: { value: Jlpt | ''; onChange: (jlpt: Jlpt | '') => void }) {
  return (
    <Field label="JLPT">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Jlpt | '')}
        className={INPUT}
      >
        <option value="">— chưa rõ —</option>
        {JLPT_VALUES.map((jlpt) => (
          <option key={jlpt} value={jlpt}>
            {JLPT_LABELS[jlpt]}
          </option>
        ))}
      </select>
    </Field>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (note: string) => void }) {
  return (
    <Field label="Ghi chú">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={`resize-y ${INPUT}`}
      />
    </Field>
  );
}

/** A `<label>` around one control; `group` for several, which a label cannot name. */
function Field({
  label,
  group = false,
  children,
}: {
  label: string;
  group?: boolean;
  children: ReactNode;
}) {
  const Wrapper = group ? 'div' : 'label';
  return (
    <Wrapper className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
      {children}
    </Wrapper>
  );
}

function submit(save: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    save();
  };
}
