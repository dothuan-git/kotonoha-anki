'use client';

import { ArrowLeft, Check, FileJson, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { deleteImportBatch } from '@/lib/actions/imports';
import type { ImportReport, PreviewRow, RowStatus } from '@/lib/import';
import type { ImportBatchView } from '@/lib/types';

type Status = 'idle' | 'reading' | 'previewing' | 'importing' | 'done';

const STATUS_STYLE: Record<RowStatus, { label: string; className: string }> = {
  ok: { label: 'Sẽ nhập', className: 'text-[var(--bamboo)]' },
  duplicate: { label: 'Bỏ qua', className: 'text-[var(--warning)]' },
  invalid: { label: 'Lỗi', className: 'text-[var(--danger)]' },
};

/**
 * Posts the file and returns the report, or throws with the server's
 * Vietnamese reason. The same bytes go up twice — once to preview, once to
 * commit — so the server never holds a half-finished import between them.
 */
async function postImport(file: File, dryRun: boolean): Promise<ImportReport> {
  const body = new FormData();
  body.set('file', file);
  body.set('dryRun', dryRun ? '1' : '0');

  const res = await fetch('/api/import', { method: 'POST', body });
  const data = (await res.json()) as Partial<ImportReport> & { error?: string };

  if (!res.ok) throw new Error(data.error ?? 'Không nhập được tệp');
  return data as ImportReport;
}

export function BulkImportScreen({ batches }: { batches: ImportBatchView[] }) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setReport(null);
    setError(null);
    setStatus('idle');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleFile(picked: File | undefined) {
    if (!picked) return;

    setFile(picked);
    setReport(null);
    setError(null);
    setStatus('reading');

    try {
      setReport(await postImport(picked, true));
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
      setReport(await postImport(file, false));
      setStatus('done');
      // The batch list is server-rendered; the new row is not in this render.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không nhập được tệp');
      setStatus('previewing');
    }
  }

  const counts = report?.counts;
  const canImport = status === 'previewing' && (counts?.ok ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4">
        <Link
          href="/add"
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--bamboo)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Thêm từng từ
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Nhập hàng loạt
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
          Chọn tệp .json chứa danh sách từ. Bạn sẽ xem trước kết quả trước khi lưu, và có
          thể hoàn tác cả lần nhập sau đó.
        </p>
      </div>

      <label
        htmlFor="import-file"
        className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-8 text-center transition-colors hover:border-[var(--bamboo)]"
      >
        <Upload className="h-6 w-6 text-[var(--bamboo)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {file ? file.name : 'Chọn tệp .json'}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {status === 'reading' ? 'Đang kiểm tra…' : 'Tối đa 1000 từ, 2 MB'}
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

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      )}

      {report && counts && (
        <section className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <Summary label="Sẽ nhập" value={counts.ok} className="text-[var(--bamboo)]" />
              <Summary
                label="Đã có sẵn"
                value={counts.duplicate}
                className="text-[var(--warning)]"
              />
              <Summary label="Lỗi" value={counts.invalid} className="text-[var(--danger)]" />
            </div>

            {status === 'done' ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--bamboo)]">
                  <Check className="h-4 w-4" />
                  Đã nhập {report.inserted} từ
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Nhập tệp khác
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={!canImport}
                className="cursor-pointer rounded-xl bg-[var(--bamboo)] px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-[var(--bamboo-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === 'importing' ? 'Đang nhập…' : `Nhập ${counts.ok} từ`}
              </button>
            )}
          </div>

          <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {report.rows.map((row) => (
              <PreviewItem key={row.index} row={row} />
            ))}
          </ul>
        </section>
      )}

      <BatchHistory batches={batches} />
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

function PreviewItem({ row }: { row: PreviewRow }) {
  const style = STATUS_STYLE[row.status];

  return (
    <li className="flex items-baseline gap-3 px-3.5 py-2.5">
      <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">
        {row.index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-jp-serif text-base font-semibold text-[var(--text-primary)]">
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
        {style.label}
      </span>
    </li>
  );
}

function BatchHistory({ batches }: { batches: ImportBatchView[] }) {
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
                    {formatDate(batch.createdAt)} · {batch.wordCount} từ còn lại
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
                  Xoá {batch.wordCount} từ của lần nhập này, cùng câu ví dụ và lịch sử ôn tập?
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
