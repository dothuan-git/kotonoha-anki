'use client';

import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Search,
  StickyNote,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import { Ruby } from '@/components/Ruby';
import { deleteWord, updateWord } from '@/lib/actions/words';
import { playJapaneseAudio } from '@/lib/client/audio';
import {
  JLPT_VALUES,
  POS_LABELS,
  POS_VALUES,
  formatHanViet,
  formatPos,
  type Jlpt,
  type Pos,
  type WordView,
} from '@/lib/types';

/** The prototype's filter row: every JLPT level, plus an "everything" pill. */
const LEVELS = ['ALL', ...JLPT_VALUES] as const;
type Level = (typeof LEVELS)[number];

/**
 * The kho từ list, as the prototype draws it: one sheet of washi with hairline
 * rules between the rows, each row collapsed to headword / reading / meaning
 * and opening in place.
 *
 * The list here was a stack of separate cards with every detail already
 * showing, which is a fine shape for six words and unreadable at two hundred
 * — the screen you go to looking for one word is the screen that has the most
 * of them. Editing and deleting live inside the opened row rather than on the
 * collapsed one, so the resting state is only the three things you scan by.
 */
export function WordsScreen({ words }: { words: WordView[] }) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<Level>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    return words.filter((w) => {
      if (level !== 'ALL' && w.jlpt !== level) return false;
      if (!q) return true;
      return (
        w.headword.toLowerCase().includes(q) ||
        w.reading.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        formatHanViet(w.kanji).toLowerCase().includes(q)
      );
    });
  }, [words, query, level]);

  /** Opening a row closes whatever the last one had going on. */
  function toggle(id: string) {
    setExpandedId((current) => (current === id ? null : id));
    setEditingId(null);
    setConfirmingId(null);
  }

  function clearFilters() {
    setQuery('');
    setLevel('ALL');
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Kho từ</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {words.length} từ trong sổ. Chạm vào một dòng để mở rộng và sửa tại chỗ.
          </p>
        </div>
        <Link
          href="/add"
          className="shrink-0 rounded-xl bg-[var(--bamboo)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
        >
          Thêm từ
        </Link>
      </div>

      <div className="mb-4 space-y-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo Kanji, Hiragana, Hán Việt hoặc nghĩa…"
            aria-label="Tìm từ"
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2.5 pl-10 pr-14 text-sm text-[var(--text-primary)] shadow-xs transition-colors focus:border-[var(--bamboo)] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-3 cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Xoá
            </button>
          )}
        </div>

        {/* The count sits outside the scrolling pill row: inside it, `ml-auto`
            pushes it past the right edge on a narrow screen and it is never
            seen. */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {LEVELS.map((lvl) => (
              <motion.button
                key={lvl}
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => setLevel(lvl)}
                aria-pressed={level === lvl}
                className={`shrink-0 cursor-pointer rounded-lg px-3 py-1 font-medium transition-colors ${
                  level === lvl
                    ? 'bg-[var(--bamboo)] font-semibold text-white shadow-xs'
                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                {lvl === 'ALL' ? 'Tất cả' : lvl}
              </motion.button>
            ))}
          </div>
          <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">
            {filtered.length} từ
          </span>
        </div>
      </div>

      {words.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoMatches onClear={clearFilters} />
      ) : (
        <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
          {filtered.map((word) => {
            const isExpanded = expandedId === word.id;

            return (
              <div key={word.id} className="transition-colors hover:bg-[var(--bg-muted)]/30">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggle(word.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(word.id);
                    }
                  }}
                  className="flex cursor-pointer select-none items-center justify-between p-3.5 sm:p-4"
                >
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <span className="font-jp-serif shrink-0 text-lg font-semibold text-[var(--text-primary)] sm:text-xl">
                      {word.headword}
                    </span>
                    <span className="font-jp-serif shrink-0 text-xs font-medium text-[var(--bamboo)] sm:text-sm">
                      {word.reading}
                    </span>
                    <span className="truncate text-xs text-[var(--text-secondary)] sm:text-sm">
                      {word.meaning}
                    </span>
                  </div>

                  <div className="ml-2 flex shrink-0 items-center gap-1.5 sm:gap-2">
                    {word.suspended && (
                      <span className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]">
                        Tạm dừng
                      </span>
                    )}
                    <span className="rounded-md bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] sm:px-2 sm:text-[11px]">
                      {word.jlpt ?? '—'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playJapaneseAudio(word.headword);
                      }}
                      aria-label={`Đọc ${word.headword}`}
                      className="cursor-pointer p-1 text-[var(--text-muted)] hover:text-[var(--bamboo)]"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-page)]/40 px-3.5 pb-4 pt-3.5 text-sm sm:px-5 sm:pb-5 sm:pt-4">
                        {editingId === word.id ? (
                          <EditForm
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
                          <Details
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
                                setExpandedId(null);
                              })
                            }
                          />
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The expanded row, laid out as a dictionary entry rather than a form dump:
 * hierarchy carries the structure, so the only borders left are the ones that
 * mean something — the quote rule beside an example, the note's accent.
 */
function Details({
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
  const kanji = word.kanji.filter((k) => k.hanViet.length > 0);

  return (
    <>
      {/* Grammar and Hán Việt read as one line of credentials under the
          headword, the way a dictionary prints them. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded-full bg-[var(--bamboo-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--bamboo)]">
          {formatPos(word.pos, word.transitivity)}
        </span>

        {kanji.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {kanji.map((k) => (
              <span key={k.char} className="flex items-baseline gap-1.5">
                <span className="font-jp-serif text-base leading-none text-[var(--text-primary)]">
                  {k.char}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {k.hanViet.join('/')}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {word.sentences.length > 0 && (
        <div className="mt-3.5 space-y-3">
          {word.sentences.map((sentence) => (
            <div
              key={sentence.id}
              className="rounded-xl border border-[var(--border-subtle)] border-l-2 border-l-[var(--bamboo-border)] bg-[var(--bg-surface)] px-3.5 py-2.5"
            >
              {/* leading-loose, not relaxed: the <rt> furigana row needs the
                  headroom or it collides with the line above. */}
              <Ruby
                text={sentence.jpRuby}
                className="font-jp-serif block text-base leading-loose text-[var(--text-primary)]"
              />
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                {sentence.vi}
              </p>
            </div>
          ))}
        </div>
      )}

      {word.note && (
        <p className="mt-3.5 flex items-start gap-1.5 text-xs italic leading-relaxed text-[var(--text-muted)]">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{word.note}</span>
        </p>
      )}

      {/* Quiet by default: the entry is for reading, so the actions stay out of
          the way until the pointer asks for them. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-[11px] text-[var(--text-muted)]">
          Thêm ngày {formatAdded(word.createdAt)}
        </span>
        <div className="-mr-1 flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Sửa</span>
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Xoá</span>
          </button>
        </div>
      </div>

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2.5">
          <span className="text-xs font-medium leading-relaxed text-[var(--danger)]">
            Xoá từ này cùng câu ví dụ và lịch sử ôn tập?
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onCancelDelete}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={disabled}
              className="cursor-pointer rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Xoá
            </button>
          </div>
        </div>
      )}
    </>
  );
}


function EditForm({
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

  const field =
    'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none';

  return (
    <div className="space-y-2.5 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Từ">
          <input
            value={headword}
            onChange={(e) => setHeadword(e.target.value)}
            className={`font-jp-serif ${field} text-lg`}
          />
        </Labelled>
        <Labelled label="Cách đọc">
          <input
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            className={`font-jp-serif ${field}`}
          />
        </Labelled>
      </div>

      <Labelled label="Nghĩa tiếng Việt">
        <input
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          className={`${field} font-medium`}
        />
      </Labelled>

      <div className="grid grid-cols-3 gap-2">
        <Labelled label="Từ loại">
          <select
            value={pos}
            onChange={(e) => setPos(e.target.value as Pos)}
            className={`${field} px-2 text-xs`}
          >
            {POS_VALUES.map((v) => (
              <option key={v} value={v}>
                {POS_LABELS[v]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Tự / tha">
          <select
            value={transitivity}
            onChange={(e) => setTransitivity(e.target.value as typeof transitivity)}
            className={`${field} px-2 text-xs`}
          >
            <option value="">—</option>
            <option value="transitive">Tha động từ</option>
            <option value="intransitive">Tự động từ</option>
          </select>
        </Labelled>
        <Labelled label="JLPT">
          <select
            value={jlpt}
            onChange={(e) => setJlpt(e.target.value as Jlpt | '')}
            className={`${field} px-2 text-xs`}
          >
            <option value="">—</option>
            {JLPT_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Labelled>
      </div>

      <Labelled label="Ghi chú riêng">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Dễ lẫn với 開く…"
          className={`${field} text-xs`}
        />
      </Labelled>

      <div className="flex items-center gap-2 pt-1">
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
          className="flex cursor-pointer items-center gap-1 rounded-lg bg-[var(--bamboo)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--bamboo-hover)] disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          <span>Lưu thay đổi</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
        >
          <X className="h-3.5 w-3.5" />
          <span>Huỷ</span>
        </button>
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-12 text-center">
      <BookOpen className="mx-auto mb-3 h-8 w-8 text-[var(--text-muted)]" />
      <p className="text-sm font-semibold text-[var(--text-primary)]">Sổ từ còn trống.</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-[var(--text-muted)]">
        Thêm từ đầu tiên và hệ thống sẽ tự tra từ điển, âm Hán Việt và soạn câu ví dụ.
      </p>
      <Link
        href="/add"
        className="mt-4 inline-block rounded-xl bg-[var(--bamboo)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--bamboo-hover)]"
      >
        Thêm từ đầu tiên
      </Link>
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-12 text-center">
      <BookOpen className="mx-auto mb-3 h-8 w-8 text-[var(--text-muted)]" />
      <p className="text-sm font-semibold text-[var(--text-primary)]">
        Không tìm thấy từ vựng phù hợp
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Thử thay đổi từ khoá tìm kiếm hoặc chọn lại cấp độ JLPT.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 cursor-pointer rounded-xl bg-[var(--bamboo)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--bamboo-hover)]"
      >
        Xoá bộ lọc
      </button>
    </div>
  );
}

/** `2026-09-12T…` → `12/09/2026`. */
function formatAdded(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}
