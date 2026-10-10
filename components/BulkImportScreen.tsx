'use client';

import { ArrowLeft, Check, ClipboardPaste, FileJson, Trash2, Undo2, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';

import { ImportPreviewDialog, type Direction } from '@/components/ImportPreviewDialog';
import { deleteImportBatch } from '@/lib/actions/imports';
import { applyExclusions, countRows } from '@/lib/import';
import type { ImportReport, PreviewRow, RowStatus } from '@/lib/import';
import { readRow, replaceRow, unfence, type RawRow } from '@/lib/import-edit';
import type { CardKind, ImportBatchView } from '@/lib/types';

/** What the screen calls one row of the file, and where "add one" lives. */
const COPY: Record<
  CardKind,
  {
    noun: string;
    list: string;
    addOne: string;
    addHref: '/add' | '/grammar/add';
    /** The envelope's row key, for the paste box's placeholder. */
    rowsKey: 'words' | 'grammar';
  }
> = {
  word: {
    noun: 'từ',
    list: 'danh sách từ',
    addOne: 'Thêm từng từ',
    addHref: '/add',
    rowsKey: 'words',
  },
  grammar: {
    noun: 'mẫu',
    list: 'danh sách mẫu ngữ pháp',
    addOne: 'Thêm từng mẫu',
    addHref: '/grammar/add',
    rowsKey: 'grammar',
  },
};

type Status = 'idle' | 'reading' | 'previewing' | 'importing' | 'done';

/** Where the JSON comes from. Either way it is posted as a file. */
type Input = 'file' | 'paste';

const INPUTS: readonly { input: Input; label: string; Icon: typeof Upload }[] = [
  { input: 'file', label: 'Chọn tệp', Icon: Upload },
  { input: 'paste', label: 'Dán JSON', Icon: ClipboardPaste },
];

/**
 * The name a paste is posted under. The server takes a file without a
 * `source` to be named after itself, so this is what such a batch is called.
 */
const PASTE_FILENAME = 'JSON đã dán.json';

const STATUS_STYLE: Record<RowStatus, { label: string; className: string }> = {
  ok: { label: 'Sẽ nhập', className: 'text-[var(--brand)]' },
  duplicate: { label: 'Bỏ qua', className: 'text-[var(--warning)]' },
  invalid: { label: 'Lỗi', className: 'text-[var(--danger)]' },
  excluded: { label: 'Đã bỏ', className: 'text-[var(--text-muted)]' },
};

/**
 * Posts the file and returns the report, or throws with the server's
 * Vietnamese reason. The same bytes go up twice — once to preview, once to
 * commit — so the server never holds a half-finished import between them.
 * Only the list of struck-off rows travels with the second post.
 */
async function postImport(
  kind: CardKind,
  file: File,
  dryRun: boolean,
  excluded: ReadonlySet<number>,
): Promise<ImportReport> {
  const body = new FormData();
  body.set('kind', kind);
  body.set('file', file);
  body.set('dryRun', dryRun ? '1' : '0');
  // By file position: the server re-parses the same bytes, so the index names
  // the same row there.
  body.set('exclude', JSON.stringify([...excluded]));

  const res = await fetch('/api/import', { method: 'POST', body });
  const data = (await res.json()) as Partial<ImportReport> & { error?: string };

  if (!res.ok) throw new Error(data.error ?? 'Không nhập được tệp');
  return data as ImportReport;
}

export function BulkImportScreen({
  batches,
  kind = 'word',
}: {
  batches: ImportBatchView[];
  kind?: CardKind;
}) {
  const router = useRouter();
  const copy = COPY[kind];

  const [input, setInput] = useState<Input>('file');
  /** The paste box. Kept across a switch to the file picker and back. */
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  /**
   * The file's text, kept so a row can be edited: the edit is written into
   * this text and the result posted as the file from then on. Null if the
   * browser could not read it, which only turns editing off.
   */
  const [text, setText] = useState<string | null>(null);
  /** File positions edited in this preview, for a mark in the list. */
  const [edited, setEdited] = useState<ReadonlySet<number>>(new Set());
  const [report, setReport] = useState<ImportReport | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  // File positions the user struck off in the preview. Cleared with the file,
  // because the next file's row 3 is a different word.
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  /** The row open in the detail dialog, by file position, and which way it was reached. */
  const [viewing, setViewing] = useState<{ index: number; direction: Direction } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setText(null);
    setEdited(new Set());
    setReport(null);
    setError(null);
    setExcluded(new Set());
    setViewing(null);
    setStatus('idle');
    if (fileRef.current) fileRef.current.value = '';
  }

  /** The preview belongs to the input it came from, so switching drops it. */
  function switchInput(next: Input) {
    if (next === input || status === 'reading' || status === 'importing') return;
    reset();
    setInput(next);
  }

  /** A preview of text that has since changed would be a preview of nothing on screen. */
  function changeDraft(next: string) {
    setDraft(next);
    if (report && status !== 'importing') reset();
  }

  function handlePaste() {
    const pasted = unfence(draft).trim();
    // Only from idle: the preview on screen is already of this text.
    if (!pasted || status !== 'idle') return;
    void handleFile(new File([pasted], PASTE_FILENAME, { type: 'application/json' }));
  }

  async function handleFile(picked: File | undefined) {
    if (!picked) return;

    setFile(picked);
    setEdited(new Set());
    setReport(null);
    setError(null);
    setExcluded(new Set());
    setViewing(null);
    setStatus('reading');

    try {
      setText(await picked.text());
    } catch (e) {
      console.error('[import] could not read the file for editing', e);
      setText(null);
    }

    try {
      setReport(await postImport(kind, picked, true, new Set()));
      setStatus('previewing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được tệp');
      setStatus('idle');
    }
  }

  async function handleImport() {
    if (!file || status === 'importing') return;

    setStatus('importing');
    setError(null);

    try {
      setReport(await postImport(kind, file, false, excluded));
      setStatus('done');
      // The batch list is server-rendered; the new row is not in this render.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không nhập được tệp');
      setStatus('previewing');
    }
  }

  /**
   * An edited row, written into the file and the file checked again. The
   * edited file is what is posted from here on, the import included, so the
   * server judges the edit exactly as it would have judged the file —
   * nothing about the row is trusted from the form.
   */
  async function saveEdit(index: number, patch: RawRow): Promise<string | null> {
    if (!file || text === null || status !== 'previewing') return 'Không sửa được lúc này';

    const next = replaceRow(text, kind, index, { ...readRow(text, kind, index), ...patch });
    if (next === null) return 'Không tìm thấy dòng này trong tệp';
    const nextFile = new File([next], file.name, { type: 'application/json' });

    try {
      const nextReport = await postImport(kind, nextFile, true, new Set());
      setFile(nextFile);
      setText(next);
      // The box shows what will be imported, the fix included.
      if (input === 'paste') setDraft(next);
      setReport(nextReport);
      setEdited((current) => new Set(current).add(index));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Không kiểm tra lại được tệp';
    }
  }

  /** Toggling costs nothing until the import runs: nothing is written yet. */
  function toggleExcluded(index: number) {
    if (status !== 'previewing') return;

    setExcluded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  // Struck-off rows are folded in here rather than asked of the server again:
  // the same function decides it on both sides, and re-uploading the file on
  // every click would be a lot of traffic for a local decision.
  const rows: PreviewRow[] = useMemo(
    () => (report ? applyExclusions(report.rows, excluded) : []),
    [report, excluded],
  );
  const counts = useMemo(() => countRows(rows), [rows]);
  const canImport = status === 'previewing' && counts.ok > 0;
  const canEdit = status === 'previewing' && text !== null;
  // The rows the dialog can step through, and the one it shows — looked up
  // from `rows`, so it follows a row struck off or fixed from inside it. A
  // refused row has no card, so it opens only while it can be fixed.
  const openable = useMemo(
    () => rows.filter((row) => row.detail || (canEdit && row.status === 'invalid')),
    [rows, canEdit],
  );
  const at = viewing ? openable.findIndex((row) => row.index === viewing.index) : -1;
  const viewed = openable[at] ?? null;
  const viewedRaw = useMemo(
    () => (canEdit && text !== null && viewed ? readRow(text, kind, viewed.index) : null),
    [canEdit, text, kind, viewed],
  );
  const step = (by: -1 | 1) => {
    const target = openable[at + by];
    return target ? () => setViewing({ index: target.index, direction: by }) : null;
  };
  const viewedRemovable =
    viewed && status === 'previewing' && (viewed.status === 'ok' || viewed.status === 'excluded');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4">
        <Link
          href={copy.addHref}
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--brand)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {copy.addOne}
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Nhập hàng loạt
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
          Chọn tệp .json hoặc dán JSON chứa {copy.list}. Bạn sẽ xem trước kết quả trước khi
          lưu, và có thể hoàn tác cả lần nhập sau đó.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Nguồn dữ liệu"
        className="mb-3 inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)]/70 p-0.5"
      >
        {INPUTS.map(({ input: option, label, Icon }) => {
          const active = option === input;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => switchInput(option)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? 'border-[var(--brand-border)]/70 bg-[var(--bg-surface)] font-semibold text-[var(--brand)] shadow-xs'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {input === 'file' ? (
        <label
          htmlFor="import-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-8 text-center transition-colors hover:border-[var(--brand)]"
        >
          <Upload className="h-6 w-6 text-[var(--brand)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {file ? file.name : 'Chọn tệp .json'}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {status === 'reading' ? 'Đang kiểm tra…' : `Tối đa 1000 ${copy.noun}, 2 MB`}
          </span>
          <input
            id="import-file"
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
      ) : (
        <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2 transition-colors focus-within:border-[var(--brand)]">
          <label htmlFor="import-paste" className="sr-only">
            JSON chứa {copy.list}
          </label>
          <textarea
            id="import-paste"
            value={draft}
            onChange={(e) => changeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handlePaste();
              }
            }}
            readOnly={status === 'reading' || status === 'importing'}
            rows={10}
            spellCheck={false}
            placeholder={`{\n  "source": "…",\n  "${copy.rowsKey}": [ … ]\n}`}
            className="block max-h-[50vh] min-h-32 w-full resize-y bg-transparent px-2 py-1.5 font-mono text-xs leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1.5">
            <span className="text-xs text-[var(--text-muted)]">
              Tối đa 1000 {copy.noun}, 2 MB
            </span>
            <button
              type="button"
              onClick={handlePaste}
              disabled={!draft.trim() || status !== 'idle'}
              title="Ctrl+Enter"
              className="cursor-pointer rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors enabled:hover:border-[var(--brand)] enabled:hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === 'reading' ? 'Đang kiểm tra…' : 'Xem trước'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      )}

      {report && (
        <section className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <Summary label="Sẽ nhập" value={counts.ok} className="text-[var(--brand)]" />
              <Summary
                label="Đã có sẵn"
                value={counts.duplicate}
                className="text-[var(--warning)]"
              />
              <Summary label="Lỗi" value={counts.invalid} className="text-[var(--danger)]" />
              {counts.excluded > 0 && (
                <Summary
                  label="Đã bỏ"
                  value={counts.excluded}
                  className="text-[var(--text-secondary)]"
                />
              )}
            </div>

            {status === 'done' ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
                  <Check className="h-4 w-4" />
                  Đã nhập {report.inserted} {copy.noun}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setDraft('');
                  }}
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {input === 'paste' ? 'Dán JSON khác' : 'Nhập tệp khác'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={!canImport}
                className="cursor-pointer rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === 'importing' ? 'Đang nhập…' : `Nhập ${counts.ok} ${copy.noun}`}
              </button>
            )}
          </div>

          <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {rows.map((row) => (
              <PreviewItem
                key={row.index}
                row={row}
                editable={status === 'previewing'}
                openable={Boolean(row.detail) || (canEdit && row.status === 'invalid')}
                edited={edited.has(row.index)}
                onToggle={() => toggleExcluded(row.index)}
                onOpen={() => setViewing({ index: row.index, direction: 0 })}
              />
            ))}
          </ul>
        </section>
      )}

      <ImportPreviewDialog
        kind={kind}
        row={viewed}
        raw={viewedRaw}
        onSave={canEdit && viewed ? (patch) => saveEdit(viewed.index, patch) : null}
        direction={viewing?.direction ?? 0}
        position={viewed ? { current: at + 1, total: openable.length } : null}
        onClose={() => setViewing(null)}
        onPrev={step(-1)}
        onNext={step(1)}
        onToggle={viewedRemovable ? () => toggleExcluded(viewed.index) : null}
      />

      <BatchHistory batches={batches} noun={copy.noun} />
    </div>
  );
}

function Summary({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <span className="text-[var(--text-muted)]">
      {label} <strong className={`font-bold ${className}`}>{value}</strong>
    </span>
  );
}

/**
 * One previewed row. Only a row that would actually be written can be struck
 * off — a duplicate or an invalid row is already being skipped, and offering
 * to remove it again would say nothing.
 *
 * A row that parsed opens its detail on click; a refused one opens in the
 * form while it can still be fixed, and is plain text after.
 */
function PreviewItem({
  row,
  editable,
  openable,
  edited,
  onToggle,
  onOpen,
}: {
  row: PreviewRow;
  editable: boolean;
  openable: boolean;
  edited: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const style = STATUS_STYLE[row.status];
  const removable = row.status === 'ok' || row.status === 'excluded';
  const dropped = row.status === 'excluded';
  const body = (
    <>
      <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">
        {row.index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={`font-jp-serif text-base font-semibold text-[var(--text-primary)] ${
              dropped ? 'line-through' : ''
            }`}
          >
            {row.headword || '—'}
          </span>
          {row.reading && (
            <span className="font-jp-sans text-xs text-[var(--text-muted)]">{row.reading}</span>
          )}
        </div>
        {row.meaning && (
          <p className="truncate text-xs text-[var(--text-secondary)]">{row.meaning}</p>
        )}
        {row.reason && (
          <p className={`mt-0.5 text-[11px] leading-relaxed ${style.className}`}>{row.reason}</p>
        )}
      </div>
      <span className={`shrink-0 text-[11px] font-semibold ${style.className}`}>
        {edited && <span className="font-normal text-[var(--text-muted)]">Đã sửa · </span>}
        {style.label}
      </span>
    </>
  );
  const bodyClass = `flex min-w-0 flex-1 items-baseline gap-3 px-3.5 py-2.5 text-left ${
    dropped ? 'opacity-55' : ''
  }`;

  return (
    <li className="flex items-center">
      {openable ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className={`${bodyClass} cursor-pointer transition-colors hover:bg-[var(--bg-muted)]/60`}
        >
          {body}
        </button>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}
      {removable && editable && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            dropped
              ? `Nhập lại ${row.headword}`
              : `Bỏ ${row.headword} khỏi lần nhập này`
          }
          className="mr-2 shrink-0 cursor-pointer rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
        >
          {dropped ? <Undo2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
    </li>
  );
}

function BatchHistory({ batches, noun }: { batches: ImportBatchView[]; noun: string }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (batches.length === 0) return null;

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteImportBatch(id);
      setConfirming(null);
      setError(result.ok ? null : result.error);
    });
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Các lần nhập trước
      </h2>

      {error && (
        <p role="alert" className="mb-2 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      )}

      <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {batches.map((batch) => (
          <li key={batch.id} className="px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileJson className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {batch.source}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {formatDate(batch.createdAt)} · {batch.wordCount} {noun} còn lại
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirming(batch.id)}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Hoàn tác</span>
              </button>
            </div>

            {confirming === batch.id && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2.5">
                <span className="text-xs font-medium leading-relaxed text-[var(--danger)]">
                  Xoá {batch.wordCount} {noun} của lần nhập này, cùng câu ví dụ và lịch sử ôn tập?
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(batch.id)}
                    disabled={pending}
                    className="cursor-pointer rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Xoá
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}
