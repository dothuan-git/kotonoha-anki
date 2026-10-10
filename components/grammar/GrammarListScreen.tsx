'use client';

import { ChevronDown, Pause, Pencil, Play, Plus, Search, Trash2, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import { GrammarForm } from '@/components/grammar/GrammarForm';
import { Ruby } from '@/components/Ruby';
import { deleteGrammar, setGrammarSuspended, updateGrammar } from '@/lib/actions/grammar';
import { playSentenceAudio } from '@/lib/client/audio';
import type { GrammarInput } from '@/lib/grammar';
import type { GrammarView } from '@/lib/types';

/**
 * /grammar/list — every grammar point, searchable, with inline edit, suspend
 * and delete. The collection is small enough to filter on the device.
 */
export function GrammarListScreen({ points: initial }: { points: GrammarView[] }) {
  const [points, setPoints] = useState(initial);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return points;
    return points.filter(
      (p) =>
        p.pattern.toLowerCase().includes(q) ||
        p.meaning.toLowerCase().includes(q) ||
        p.sentences.some((s) => s.jp.includes(q) || s.vi.toLowerCase().includes(q)),
    );
  }, [points, query]);

  const replace = (next: GrammarView) =>
    setPoints((list) => list.map((p) => (p.id === next.id ? next : p)));

  function handleSave(id: string, input: GrammarInput) {
    setError(null);
    startTransition(async () => {
      const result = await updateGrammar(id, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      replace(result.data);
      setEditing(null);
    });
  }

  function handleSuspend(point: GrammarView) {
    setError(null);
    startTransition(async () => {
      const result = await setGrammarSuspended(point.id, !point.suspended);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      replace({ ...point, suspended: !point.suspended });
    });
  }

  function handleDelete(point: GrammarView) {
    if (!window.confirm(`Xoá ${point.pattern} cùng toàn bộ lịch sử ôn tập của nó?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteGrammar(point.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPoints((list) => list.filter((p) => p.id !== point.id));
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Kho ngữ pháp
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{points.length} mẫu ngữ pháp</p>
        </div>
        <Link
          href="/grammar/add"
          className="mt-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Thêm mẫu
        </Link>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm mẫu, nghĩa hoặc câu ví dụ…"
          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--text-muted)]">
          {points.length === 0 ? 'Chưa có mẫu ngữ pháp nào.' : 'Không tìm thấy mẫu nào.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((point) => {
            const expanded = open === point.id;
            return (
              <li
                key={point.id}
                className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${
                  point.suspended ? 'opacity-60' : ''
                }`}
              >
                {editing === point.id ? (
                  <div className="p-3.5">
                    <GrammarForm
                      initial={point}
                      submitLabel="Lưu thay đổi"
                      busy={busy}
                      error={null}
                      onSubmit={(input) => handleSave(point.id, input)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : point.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-jp-serif text-lg font-semibold text-[var(--text-primary)]">
                            {point.pattern}
                          </span>
                          {point.jlpt && (
                            <span className="rounded-md bg-[var(--brand-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
                              {point.jlpt}
                            </span>
                          )}
                          {point.suspended && (
                            <span className="text-[10px] font-medium text-[var(--text-muted)]">
                              Tạm dừng
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
                          {point.meaning}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                        {point.sentences.length} câu
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {expanded && (
                      <div className="space-y-3 border-t border-[var(--border-subtle)] px-3.5 py-3">
                        {point.formation && (
                          <p className="font-jp-sans text-sm text-[var(--text-secondary)]">
                            {point.formation}
                          </p>
                        )}
                        {point.note && (
                          <p className="text-xs text-[var(--text-muted)]">{point.note}</p>
                        )}
                        <ul className="space-y-2">
                          {point.sentences.map((sentence) => (
                            <li
                              key={sentence.id}
                              className="flex items-start justify-between gap-2 rounded-lg bg-[var(--bg-muted)]/60 p-2.5"
                            >
                              <div className="min-w-0">
                                <Ruby
                                  text={sentence.jpRuby}
                                  className="font-jp-sans text-sm text-[var(--text-primary)]"
                                />
                                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                                  {sentence.vi}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => playSentenceAudio(sentence)}
                                className="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--brand)] cursor-pointer"
                                aria-label="Nghe câu"
                              >
                                <Volume2 className="h-4 w-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap gap-2">
                          <ActionButton onClick={() => setEditing(point.id)} disabled={busy}>
                            <Pencil className="h-3.5 w-3.5" />
                            Sửa
                          </ActionButton>
                          <ActionButton onClick={() => handleSuspend(point)} disabled={busy}>
                            {point.suspended ? (
                              <Play className="h-3.5 w-3.5" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                            {point.suspended ? 'Học lại' : 'Tạm dừng'}
                          </ActionButton>
                          <ActionButton onClick={() => handleDelete(point)} disabled={busy} danger>
                            <Trash2 className="h-3.5 w-3.5" />
                            Xoá
                          </ActionButton>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  danger = false,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
        danger
          ? 'text-[var(--danger)] hover:border-[var(--danger)]'
          : 'text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)]'
      }`}
    >
      {children}
    </button>
  );
}
