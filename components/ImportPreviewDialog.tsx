'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Ruby } from '@/components/Ruby';
import type { PreviewDetail, PreviewRow } from '@/lib/import';
import { JLPT_LABELS, formatPos } from '@/lib/types';

type Sentence = { jpRuby: string; vi: string };

/**
 * One previewed row in full — what the file says about it, before anything is
 * written. A native modal <dialog>, so Escape, the focus trap and the backdrop
 * come from the browser.
 */
export function ImportPreviewDialog({
  row,
  status,
  onClose,
}: {
  row: PreviewRow | null;
  status?: { label: string; className: string };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (row && !dialog.open) dialog.showModal();
    if (!row && dialog.open) dialog.close();
  }, [row]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // The panel fills the dialog box, so only a click on the backdrop lands
      // on the dialog element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      aria-label={row ? `Chi tiết ${row.headword}` : undefined}
      className="m-auto w-[min(32rem,calc(100%-2rem))] max-h-[85dvh] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-xl backdrop:bg-black/40"
    >
      {row?.detail && (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-jp-serif text-2xl font-bold leading-snug">{row.headword}</h2>
              {row.reading && (
                <p className="font-jp-sans text-sm text-[var(--text-muted)]">{row.reading}</p>
              )}
              <p className="mt-1 text-sm font-semibold text-[var(--text-secondary)]">
                {row.meaning}
              </p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Đóng"
              className="shrink-0 cursor-pointer rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {status && (
            <p className={`mt-2 text-[11px] font-semibold ${status.className}`}>
              {status.label}
              {row.reason && <span className="font-normal"> — {row.reason}</span>}
            </p>
          )}

          <div className="mt-4 space-y-3.5 border-t border-[var(--border-subtle)] pt-4">
            {row.detail.kind === 'word' ? (
              <WordDetail detail={row.detail} />
            ) : (
              <GrammarDetail detail={row.detail} />
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

function WordDetail({ detail }: { detail: Extract<PreviewDetail, { kind: 'word' }> }) {
  const hanViet = Object.entries(detail.hanViet)
    .map(([kanji, readings]) => `${kanji} ${readings.join('/')}`)
    .join(' · ');

  return (
    <>
      <Tags>
        <Tag>{formatPos(detail.pos, detail.transitivity)}</Tag>
        {detail.jlpt && <Tag>{JLPT_LABELS[detail.jlpt]}</Tag>}
      </Tags>
      {hanViet && <Field label="Hán Việt">{hanViet}</Field>}
      {detail.sentence && (
        <Field label="Câu ví dụ">
          <Example sentence={detail.sentence} />
        </Field>
      )}
      {detail.note && <Field label="Ghi chú">{detail.note}</Field>}
    </>
  );
}

function GrammarDetail({ detail }: { detail: Extract<PreviewDetail, { kind: 'grammar' }> }) {
  return (
    <>
      {detail.jlpt && (
        <Tags>
          <Tag>{JLPT_LABELS[detail.jlpt]}</Tag>
        </Tags>
      )}
      {detail.formation && (
        <Field label="Cấu trúc">
          <span className="font-jp-sans">{detail.formation}</span>
        </Field>
      )}
      <Field label={`Câu ví dụ (${detail.sentences.length})`}>
        <ol className="space-y-2.5">
          {detail.sentences.map((sentence, i) => (
            <li key={i}>
              <Example sentence={sentence} />
            </li>
          ))}
        </ol>
      </Field>
      {detail.note && <Field label="Ghi chú">{detail.note}</Field>}
    </>
  );
}

function Tags({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-[var(--brand-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="block text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
      <div className="mt-0.5 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</div>
    </div>
  );
}

function Example({ sentence }: { sentence: Sentence }) {
  return (
    <>
      <Ruby text={sentence.jpRuby} className="font-jp-serif text-base text-[var(--text-primary)]" />
      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{sentence.vi}</p>
    </>
  );
}
