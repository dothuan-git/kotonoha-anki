'use client';

import { useState } from 'react';

/**
 * The column chart both history charts use: one stacked, one not.
 *
 * Built from elements rather than SVG so that it reflows at any width without
 * a measuring pass — 30 columns on a phone and 90 on a laptop come out of the
 * same markup. The marks follow the fixed specs: capped thickness with the
 * band's leftover left as air, a 4px rounded cap on the top segment and a
 * square foot on the baseline, and a 2px gap in the surface colour separating
 * every touching fill rather than a stroke drawn around it.
 */
export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnPoint {
  key: string;
  label: string;
  /** One value per series, in the order `series` gives them. */
  values: number[];
}

export function ColumnChart({
  series,
  points,
  height = 132,
  emptyLabel,
  valueSuffix = '',
}: {
  series: ColumnSeries[];
  points: ColumnPoint[];
  height?: number;
  emptyLabel: string;
  valueSuffix?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const totals = points.map((point) => point.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 0);

  /**
   * The surface gap between adjacent columns, narrowed when they get thin.
   *
   * Two pixels is the spec, and it is right until ninety columns have to fit a
   * phone — at which point the bar is thinner than the gap meant to separate
   * it and the chart reads as a picket fence rather than as a shape. A gap
   * that is wider than the mark is not doing the job the gap exists for.
   */
  const gap = points.length > 45 ? 1 : 2;

  if (max === 0) {
    return (
      <p className="py-8 text-center text-xs text-[var(--text-muted)]">{emptyLabel}</p>
    );
  }

  // Clean round ceiling, so the axis tick carries the values that are not
  // directly labelled.
  const ceiling = niceCeiling(max);
  const shown = active !== null ? points[active] : null;

  return (
    <div>
      <div className="flex gap-2">
        <div
          className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-[var(--text-muted)]"
          style={{ height }}
          aria-hidden
        >
          <span>{ceiling}</span>
          <span>{Math.round(ceiling / 2)}</span>
          <span>0</span>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Hairline, solid, one step off the surface. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {[0, 50, 100].map((offset) => (
              <div
                key={offset}
                className="absolute left-0 right-0 border-t border-[var(--chart-grid)]"
                style={{ top: `${offset}%` }}
              />
            ))}
          </div>

          <div
            className="relative flex items-end"
            style={{ height, gap }}
            onPointerLeave={() => setActive(null)}
          >
            {points.map((point, index) => {
              const total = totals[index] ?? 0;
              return (
                <button
                  key={point.key}
                  type="button"
                  aria-label={`${point.label}: ${total}${valueSuffix}`}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onClick={() => setActive(index)}
                  className="group flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
                >
                  <span
                    className={`flex max-w-6 flex-1 flex-col-reverse justify-start transition-opacity ${
                      active !== null && active !== index ? 'opacity-55' : ''
                    }`}
                    style={{ height: `${(total / ceiling) * 100}%` }}
                  >
                    {series.map((item, seriesIndex) => {
                      const value = point.values[seriesIndex] ?? 0;
                      if (value === 0) return null;
                      const isCap = series
                        .slice(seriesIndex + 1)
                        .every((_, offset) => (point.values[seriesIndex + 1 + offset] ?? 0) === 0);
                      return (
                        <span
                          key={item.key}
                          className={isCap ? 'rounded-t-[4px]' : ''}
                          style={{
                            backgroundColor: item.color,
                            height: `${(value / total) * 100}%`,
                            // The surface gap, in the surface colour, between
                            // touching segments — never a border.
                            marginTop: seriesIndex === 0 ? 0 : gap,
                            minHeight: 2,
                          }}
                        />
                      );
                    })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between pl-8 text-[10px] text-[var(--text-muted)]">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>

      {/*
        The hover layer, in a fixed slot under the plot rather than floating
        over it: a tooltip that covers the neighbouring columns hides the thing
        being compared, and on a phone there is no hover at all — tapping a
        column fills this in.
      */}
      <p
        aria-live="polite"
        className="mt-1 min-h-[1.25rem] text-[11px] tabular-nums text-[var(--text-secondary)]"
      >
        {shown ? (
          <>
            <span className="font-medium text-[var(--text-primary)]">{shown.label}</span>
            {series.map((item, index) => (
              <span key={item.key} className="ml-2.5 whitespace-nowrap">
                <span
                  aria-hidden
                  className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ backgroundColor: item.color }}
                />
                {item.label} {shown.values[index] ?? 0}
                {valueSuffix}
              </span>
            ))}
          </>
        ) : (
          <span className="text-[var(--text-muted)]">Chạm hoặc rê chuột vào một cột để xem số.</span>
        )}
      </p>
    </div>
  );
}

/** 0 / 10 / 25 / 50 / 100 rather than 0 / 37 / 74. */
function niceCeiling(max: number): number {
  if (max <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return Math.round(candidate);
  }
  return Math.round(10 * magnitude);
}
