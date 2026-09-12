'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ChartCard, DataTable, Legend } from '@/components/stats/ChartCard';
import { ColumnChart } from '@/components/stats/ColumnChart';
import { MaturityBar } from '@/components/stats/MaturityBar';
import { RetentionChart } from '@/components/stats/RetentionChart';
import {
  FORECAST_DAYS,
  RETENTION_WEEKS,
  VOLUME_DAYS,
  formatDayLabel,
  type StatsView,
} from '@/lib/stats';

/**
 * §10's four charts, over `review_logs`.
 *
 * Nothing here is mocked and nothing is smoothed: an empty collection gets
 * empty states saying so rather than a plausible-looking curve. Three of the
 * four read the log directly (§5 — the log is the source of truth), so they
 * stay right across a `npm run recompute`; only the forecast reads the
 * projection, because "when is this due" is what the projection is for.
 */
const SERIES = [
  { key: 'review', label: 'Ôn lại', color: 'var(--chart-review)' },
  { key: 'new', label: 'Từ mới', color: 'var(--chart-new)' },
];

const FORECAST_SERIES = [{ key: 'due', label: 'Đến hạn', color: 'var(--chart-review)' }];

export function StatsScreen({ stats }: { stats: StatsView }) {
  const [span, setSpan] = useState<30 | 90>(30);

  const volume = stats.volume.slice(-span);
  const studiedDays = stats.volume.filter((day) => day.ratings > 0).length;

  return (
    <div className="w-full pb-4">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Thống kê</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Dựng từ lịch sử ôn tập thật — mỗi lượt chấm là một dòng trong sổ, không có số liệu mẫu.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Tile label="Tổng lượt chấm" value={stats.totals.ratings} />
        <Tile label="Thẻ đã học" value={stats.totals.cardsStudied} />
        <Tile label={`Ngày có học / ${VOLUME_DAYS}`} value={studiedDays} />
      </div>

      <div className="space-y-4">
        <ChartCard
          title="Lượt ôn mỗi ngày"
          caption="Số thẻ khác nhau đã học mỗi ngày, tính theo ngày học bắt đầu lúc 04:00 — đúng cách hạn mức mỗi ngày đếm. Một thẻ chỉ tính một lần dù nó quay lại trong phiên."
          legend={
            <div className="flex items-center gap-3">
              <Legend items={SERIES} />
              <div className="flex overflow-hidden rounded-lg border border-[var(--border-subtle)] text-[11px]">
                {([30, 90] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSpan(option)}
                    className={`px-2 py-1 transition-colors ${
                      span === option
                        ? 'bg-[var(--bamboo-subtle)] font-semibold text-[var(--bamboo)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {option} ngày
                  </button>
                ))}
              </div>
            </div>
          }
          table={
            <DataTable
              head={['Ngày', 'Từ mới', 'Ôn lại', 'Lượt chấm']}
              rows={volume
                .filter((day) => day.ratings > 0)
                .reverse()
                .map((day) => [
                  formatDayLabel(day.day),
                  day.newCards,
                  day.reviewCards,
                  day.ratings,
                ])}
            />
          }
        >
          <ColumnChart
            series={SERIES}
            points={volume.map((day) => ({
              key: day.day,
              label: formatDayLabel(day.day),
              values: [day.reviewCards, day.newCards],
            }))}
            emptyLabel="Chưa có lượt ôn nào trong khoảng này."
            valueSuffix=" thẻ"
          />
        </ChartCard>

        <ChartCard
          title="Sắp đến hạn"
          caption={`${FORECAST_DAYS} ngày tới. Từ chưa học không nằm ở đây: chúng do hạn mức mỗi ngày thả ra, không phải do lịch.`}
          legend={
            stats.overdue > 0 ? (
              <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {stats.overdue}
                </span>{' '}
                thẻ quá hạn
              </span>
            ) : undefined
          }
          table={
            <DataTable
              head={['Ngày', 'Thẻ']}
              rows={stats.forecast.map((day) => [formatDayLabel(day.day), day.count])}
            />
          }
        >
          <ColumnChart
            series={FORECAST_SERIES}
            points={stats.forecast.map((day) => ({
              key: day.day,
              label: formatDayLabel(day.day),
              values: [day.count],
            }))}
            emptyLabel="Không có thẻ nào đến hạn trong 30 ngày tới."
            valueSuffix=" thẻ"
          />
        </ChartCard>

        <ChartCard
          title="Tỉ lệ nhớ"
          caption={`Phần trăm lượt ôn được chấm Được hoặc Dễ, theo tuần, trong ${RETENTION_WEEKS} tuần gần nhất. Lần đầu gặp một thẻ không được tính — chưa nhớ thì chưa quên.`}
          table={
            <DataTable
              head={['Tuần', 'Nhớ', 'Lượt', 'Tỉ lệ']}
              rows={stats.retention
                .filter((week) => week.reviews > 0)
                .reverse()
                .map((week) => [
                  formatDayLabel(week.weekStart),
                  week.recalled,
                  week.reviews,
                  `${Math.round((week.rate ?? 0) * 100)}%`,
                ])}
            />
          }
        >
          <RetentionChart weeks={stats.retention} target={stats.requestRetention} />
        </ChartCard>

        <ChartCard
          title="Độ chín của sổ từ"
          caption="Các thẻ đang chạy, xếp theo độ bền trí nhớ. Mốc 21 ngày là mốc §4 dùng để mở thẻ gõ."
          table={
            <DataTable
              head={['Nhóm', 'Thẻ']}
              rows={stats.maturity.map((slice) => [slice.label, slice.count])}
            />
          }
        >
          <MaturityBar slices={stats.maturity} />
        </ChartCard>

        <ConfusionCard confusions={stats.confusions} />
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
      <p className="text-[10px] leading-tight text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
        {value.toLocaleString('vi-VN')}
      </p>
    </div>
  );
}

/**
 * §13's confusion pairs.
 *
 * A list and not a chart on purpose: there are a handful of them, each one is
 * a pair of words you need to read, and the only number that matters is how
 * many times. A bar chart of six rows would be a table with extra steps.
 */
function ConfusionCard({ confusions }: { confusions: StatsView['confusions'] }) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Hay nhầm lẫn</h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Khi gõ sai một thẻ và thứ bạn gõ lại đúng là một từ khác trong sổ. Gõ nhầm phím thì không
        tính — chỉ những lần nhầm sang một từ bạn đã có.
      </p>

      {confusions.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">
          Chưa ghi nhận cặp nào.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {confusions.map((pair) => (
            <li
              key={`${pair.word.id}-${pair.typed.id}`}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-jp-serif text-base text-[var(--text-primary)]">
                  {pair.word.headword}
                  <span className="mx-2 font-sans text-xs text-[var(--text-muted)]">gõ thành</span>
                  {pair.typed.headword}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                  {pair.word.meaning} · {pair.typed.meaning}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                {pair.count}×
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/words"
        className="mt-3 inline-block text-[11px] font-medium text-[var(--bamboo)] hover:underline"
      >
        Sửa nghĩa hoặc thêm ghi chú ở Kho từ →
      </Link>
    </section>
  );
}
