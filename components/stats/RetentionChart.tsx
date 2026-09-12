'use client';

import { useState } from 'react';

import type { RetentionWeek } from '@/lib/stats';

/**
 * Chart 3 — the share of reviews recalled, by week, against the scheduler's target.
 *
 * One series, so no legend: the title says what the line is. The target is a
 * reference rule rather than a second series — it is not data, it is the
 * number the data is supposed to sit near, and drawing it as a second line
 * would invite reading the gap as a trend.
 *
 * A week with no reviews draws no point and breaks the line. Joining across it
 * would draw a segment through a fortnight nobody studied and imply a
 * measurement that was never taken.
 */
const WIDTH = 480;
const HEIGHT = 176;
const PAD = { top: 12, right: 10, bottom: 20, left: 30 };

export function RetentionChart({
  weeks,
  target,
}: {
  weeks: RetentionWeek[];
  target: number;
}) {
  const [active, setActive] = useState<number | null>(null);

  const measured = weeks.filter((week) => week.rate !== null);
  if (measured.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-[var(--text-muted)]">
        Chưa đủ lượt ôn để tính tỉ lệ nhớ.
      </p>
    );
  }

  // Fixed band rather than a fitted one: retention is a percentage read
  // against a target, and a y-axis that rescaled to the data would turn a
  // one-point wobble into a cliff.
  const LOW = 0.5;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (weeks.length <= 1 ? plotW / 2 : (index / (weeks.length - 1)) * plotW);
  const y = (rate: number) => PAD.top + (1 - (rate - LOW) / (1 - LOW)) * plotH;

  const segments = toSegments(weeks);
  const last = measured[measured.length - 1];
  const shown = active !== null ? weeks[active] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Tỉ lệ nhớ theo tuần; gần nhất ${percent(last?.rate ?? null)}, mục tiêu ${percent(target)}`}
      >
        {[1, 0.75, 0.5].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-[var(--text-muted)] text-[9px] tabular-nums"
            >
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}

        {/* request_retention — a rule, labelled, not a series. */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(target)}
          y2={y(target)}
          stroke="var(--text-muted)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text
          x={WIDTH - PAD.right}
          y={y(target) - 4}
          textAnchor="end"
          className="fill-[var(--text-muted)] text-[9px]"
        >
          mục tiêu {Math.round(target * 100)}%
        </text>

        {segments.map((segment) => (
          <polyline
            key={segment[0]?.index}
            points={segment.map((p) => `${x(p.index)},${y(p.rate)}`).join(' ')}
            fill="none"
            stroke="var(--chart-review)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* The end point, ringed in the surface colour so it stays legible
            where it crosses the target rule. */}
        {last?.rate !== null && last !== undefined && (
          <circle
            cx={x(weeks.indexOf(last))}
            cy={y(last.rate!)}
            r={4}
            fill="var(--chart-review)"
            stroke="var(--bg-surface)"
            strokeWidth={2}
          />
        )}

        {/* Hit targets far wider than the 2px line. */}
        {weeks.map((week, index) => (
          <rect
            key={week.weekStart}
            x={x(index) - plotW / Math.max(1, weeks.length - 1) / 2}
            y={PAD.top}
            width={plotW / Math.max(1, weeks.length - 1)}
            height={plotH}
            fill="transparent"
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive(null)}
            onClick={() => setActive(index)}
          />
        ))}

        {shown?.rate != null && (
          <line
            x1={x(active!)}
            x2={x(active!)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        )}
      </svg>

      <p
        aria-live="polite"
        className="mt-1 min-h-[1.25rem] text-[11px] tabular-nums text-[var(--text-secondary)]"
      >
        {shown ? (
          shown.rate === null ? (
            <>
              <span className="font-medium text-[var(--text-primary)]">
                Tuần {formatWeek(shown.weekStart)}
              </span>
              <span className="ml-2.5 text-[var(--text-muted)]">không có lượt ôn</span>
            </>
          ) : (
            <>
              <span className="font-medium text-[var(--text-primary)]">
                Tuần {formatWeek(shown.weekStart)}
              </span>
              <span className="ml-2.5">
                {percent(shown.rate)} · {shown.recalled}/{shown.reviews} lượt
              </span>
            </>
          )
        ) : (
          <span className="text-[var(--text-muted)]">
            Gần nhất {percent(last?.rate ?? null)} trên {last?.reviews ?? 0} lượt ôn.
          </span>
        )}
      </p>
    </div>
  );
}

/** Runs of consecutive measured weeks. A gap ends a run rather than being bridged. */
function toSegments(weeks: readonly RetentionWeek[]): { index: number; rate: number }[][] {
  const segments: { index: number; rate: number }[][] = [];
  let current: { index: number; rate: number }[] = [];

  weeks.forEach((week, index) => {
    if (week.rate === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, rate: week.rate });
  });
  if (current.length > 0) segments.push(current);

  // A lone measured week has no line to draw; give it a two-point stub so the
  // week is visible rather than silently missing.
  return segments.map((segment) =>
    segment.length === 1 && segment[0] ? [segment[0], segment[0]] : segment,
  );
}

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function formatWeek(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}
