import type { ReactNode } from 'react';

/**
 * The frame every chart on /stats sits in: a title that says what is plotted,
 * a caption that says how to read it, the plot, and — folded away — the same
 * numbers as a table.
 *
 * The table is not a nicety. Colour is one channel and it fails for some
 * readers and every printer, so the values have to be reachable without it;
 * it also happens to be the fastest way to answer "how many exactly" without
 * hunting for a tooltip.
 */
export function ChartCard({
  title,
  caption,
  legend,
  children,
  table,
}: {
  title: string;
  caption: string;
  legend?: ReactNode;
  children: ReactNode;
  table?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{caption}</p>
        </div>
        {legend}
      </div>

      <div className="mt-4">{children}</div>

      {table && (
        <details className="mt-3 border-t border-[var(--border-subtle)] pt-2">
          <summary className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            Xem số liệu
          </summary>
          <div className="mt-2 max-h-56 overflow-auto">{table}</div>
        </details>
      )}
    </section>
  );
}

/** A legend is always present once a chart carries more than one series. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** The table view behind every chart. Columns of numbers, so tabular figures. */
export function DataTable({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead>
        <tr className="text-left text-[var(--text-muted)]">
          {head.map((cell, index) => (
            <th key={cell} className={`pb-1 font-medium ${index === 0 ? '' : 'text-right'}`}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-[var(--text-secondary)]">
        {rows.map((row) => (
          <tr key={String(row[0])} className="border-t border-[var(--border-subtle)]">
            {row.map((cell, index) => (
              <td
                key={index}
                className={`py-1 ${index === 0 ? '' : 'text-right'}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
