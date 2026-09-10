'use client';

import { Check, Pencil, Search, Trash2, Volume2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import { Ruby } from '@/components/Ruby';
import { deleteWord, updateWord } from '@/lib/actions/words';
import { playJapaneseAudio } from '@/lib/client/audio';
import {
  JLPT_VALUES,
  POS_VALUES,
  formatHanViet,
  formatPos,
  type Jlpt,
  type Pos,
  type WordView,
} from '@/lib/types';

export function WordsScreen({ words }: { words: WordView[] }) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Filtering happens client-side over the rows already rendered. The server
   * query in listWords() covers the same fields for when the collection grows
   * past the page limit; for a few hundred words this keeps typing instant.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return words;
    return words.filter(
      (w) =>
        w.headword.toLowerCase().includes(q) ||
        w.reading.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        formatHanViet(w.kanji).toLowerCase().includes(q),
    );
  }, [words, query]);

  return (
    <div className="w-full">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Kho từ</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {words.length} từ trong sổ. Chạm vào bút chì để sửa ngay tại chỗ.
          </p>
        </div>
        <Link
          href="/add"
          className="shrink-0 rounded-xl bg-[var(--bamboo)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
        >
          Thêm từ
        </Link>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo từ, cách đọc, nghĩa, Hán Việt…"
          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
        />
      </div>

      {words.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">
          Không có từ nào khớp với “{query}”.
        </p>
      ) : (
        <ul className="space-y-2.5">
          <AnimatePresence initial={false}>
            {filtered.map((word) => (
              <motion.li
                key={word.id}
                layout
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs"
              >
                {editingId === word.id ? (
                  <EditRow
                    word={word}
                    disabled={pending}
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) =>
                      startTransition(async () => {
                        await updateWord({ id: word.id, ...patch });
                        setEditingId(null);
                      })
                    }
                  />
                ) : (
                  <ViewRow
                    word={word}
                    confirming={confirmingId === word.id}
                    disabled={pending}
                    onEdit={() => setEditingId(word.id)}
                    onAskDelete={() => setConfirmingId(word.id)}
                    onCancelDelete={() => setConfirmingId(null)}
                    onConfirmDelete={() =>
                      startTransition(async () => {
                        await deleteWord(word.id);
                        setConfirmingId(null);
                      })
                    }
                  />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
      <p className="text-sm font-medium text-[var(--text-secondary)]">Sổ từ còn trống.</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-[var(--text-muted)]">
        Thêm từ đầu tiên và hệ thống sẽ tự tra từ điển, âm Hán Việt và soạn câu ví dụ.
      </p>
      <Link
        href="/add"
        className="mt-5 inline-block rounded-xl bg-[var(--bamboo)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
      >
        Thêm từ đầu tiên
      </Link>
    </div>
  );
}

function ViewRow({
  word,
  confirming,
  disabled,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  word: WordView;
  confirming: boolean;
  disabled: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const sentence = word.sentences[0];

  return (
    <div className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-jp-serif text-2xl font-semibold leading-tight">
              {word.headword}
            </span>
            <span className="font-jp-serif truncate text-sm text-[var(--text-muted)]">
              {word.reading}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{word.meaning}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => playJapaneseAudio(word.headword)}
            aria-label={`Đọc ${word.headword}`}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <Volume2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Sửa ${word.headword}`}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            aria-label={`Xoá ${word.headword}`}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Tag>{formatPos(word.pos, word.transitivity)}</Tag>
        {word.jlpt && <Tag>{word.jlpt}</Tag>}
        <Tag>{formatHanViet(word.kanji)}</Tag>
        {word.suspended && <Tag tone="warning">Tạm dừng</Tag>}
      </div>

      {sentence && (
        <div className="mt-2.5 rounded-xl bg-[var(--bg-muted)]/50 px-3 py-2">
          <Ruby text={sentence.jpRuby} className="font-jp-serif text-base leading-loose" />
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{sentence.vi}</p>
        </div>
      )}

      {word.note && (
        <p className="mt-2 text-xs italic text-[var(--text-muted)]">{word.note}</p>
      )}

      {confirming && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2">
          <span className="text-xs font-medium text-[var(--danger)]">
            Xoá từ này cùng câu ví dụ và lịch sử ôn tập?
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--text-secondary)]"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={disabled}
              className="rounded-lg bg-[var(--danger)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
            >
              Xoá
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditRow({
  word,
  disabled,
  onCancel,
  onSave,
}: {
  word: WordView;
  disabled: boolean;
  onCancel: () => void;
  onSave: (patch: {
    headword: string;
    reading: string;
    meaning: string;
    pos: Pos;
    transitivity: 'transitive' | 'intransitive' | null;
    jlpt: Jlpt | null;
    note: string | null;
  }) => void;
}) {
  const [headword, setHeadword] = useState(word.headword);
  const [reading, setReading] = useState(word.reading);
  const [meaning, setMeaning] = useState(word.meaning);
  const [pos, setPos] = useState<Pos>(word.pos);
  const [transitivity, setTransitivity] = useState<'transitive' | 'intransitive' | ''>(
    word.transitivity ?? '',
  );
  const [jlpt, setJlpt] = useState<Jlpt | ''>(word.jlpt ?? '');
  const [note, setNote] = useState(word.note ?? '');

  return (
    <div className="space-y-2.5 bg-[var(--bg-muted)]/40 p-3.5">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={headword}
          onChange={(e) => setHeadword(e.target.value)}
          aria-label="Từ"
          className="font-jp-serif rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-lg"
        />
        <input
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          aria-label="Cách đọc"
          className="font-jp-serif rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm"
        />
      </div>

      <input
        value={meaning}
        onChange={(e) => setMeaning(e.target.value)}
        aria-label="Nghĩa"
        className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm font-medium"
      />

      <div className="grid grid-cols-3 gap-2">
        <select
          value={pos}
          onChange={(e) => setPos(e.target.value as Pos)}
          aria-label="Từ loại"
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs"
        >
          {POS_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={transitivity}
          onChange={(e) => setTransitivity(e.target.value as typeof transitivity)}
          aria-label="Tự / tha động từ"
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs"
        >
          <option value="">—</option>
          <option value="transitive">Tha động từ</option>
          <option value="intransitive">Tự động từ</option>
        </select>
        <select
          value={jlpt}
          onChange={(e) => setJlpt(e.target.value as Jlpt | '')}
          aria-label="Cấp độ JLPT"
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs"
        >
          <option value="">—</option>
          {JLPT_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Ghi chú riêng"
        aria-label="Ghi chú"
        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
      />

      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
        >
          <X className="h-3.5 w-3.5" />
          Huỷ
        </button>
        <button
          type="button"
          disabled={disabled || !headword.trim() || !meaning.trim()}
          onClick={() =>
            onSave({
              headword: headword.trim(),
              reading: reading.trim(),
              meaning: meaning.trim(),
              pos,
              transitivity: transitivity || null,
              jlpt: jlpt || null,
              note: note.trim() || null,
            })
          }
          className="flex items-center gap-1 rounded-lg bg-[var(--bamboo)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          Lưu
        </button>
      </div>
    </div>
  );
}

function Tag({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'warning';
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 ${
        tone === 'warning'
          ? 'border-[var(--warning)]/40 bg-[var(--warning-subtle)] text-[var(--warning)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/60 text-[var(--text-muted)]'
      }`}
    >
      {children}
    </span>
  );
}
