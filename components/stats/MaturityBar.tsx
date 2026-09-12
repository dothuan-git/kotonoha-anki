'use client';

import type { MaturitySlice } from '@/lib/stats';

/**
 * Chart 4 — the collection, split by how well it is known.
 *
 * Part-to-whole, so one stacked bar rather than five columns: the question is
 * what share of the collection has made it past §4's 21-day line, and a bar
 * answers that without the reader adding anything up.
 *
 * The buckets are ordered, so they wear a single-hue ramp, light to dark.
 * Five unrelated hues would say these are five kinds of thing; they are one
 * thing at five depths, and the ramp says so.
 */
export function MaturityBar({ slices }: { slices: MaturitySlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-muted)]">Chưa có thẻ nào.</p>;
  }

  const present = slices.filter((slice) => slice.count > 0);

  return (
    <div>
      <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-lg">
        {present.map((slice, index) => (
          <div
            key={slice.bucket}
            title={`${slice.label}: ${slice.count}`}
            className={`h-full min-w-[3px] ${index === 0 ? 'rounded-l-lg' : ''} ${
              index === present.length - 1 ? 'rounded-r-lg' : ''
            }`}
            style={{
              backgroundColor: colourOf(slice.bucket),
              flexGrow: slice.count,
              flexBasis: 0,
            }}
          />
        ))}
      </div>

      {/*
        The legend doubles as the value table. Five labels with a count each
        read better in a column than as direct labels crammed into segments
        that are often only a few pixels wide — and a label that would not fit
        inside its segment does not get put there (§ marks: never clipped).
      */}
      <ul className="mt-3 space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.bucket} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colourOf(slice.bucket) }}
            />
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
              {slice.label}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
              {Math.round((slice.count / total) * 100)}%
            </span>
            <span className="w-10 shrink-0 text-right font-medium tabular-nums text-[var(--text-primary)]">
              {slice.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function colourOf(bucket: MaturitySlice['bucket']): string {
  const step = { new: 1, learning: 2, young: 3, mature: 4, retired: 5 }[bucket];
  return `var(--chart-seq-${step})`;
}
