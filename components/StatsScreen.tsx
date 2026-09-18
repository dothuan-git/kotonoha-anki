'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ChartCard, DataTable, Legend } from '@/components/stats/ChartCard';
import { ColumnChart } from '@/components/stats/ColumnChart';
import { MaturityBar } from '@/components/stats/MaturityBar';
import { RetentionChart } from '@/components/stats/RetentionChart';
import {
  FORECAST_DAYS,
  HEATMAP_DAYS,
  RETENTION_WEEKS,
  VOLUME_DAYS,
  buildHeatmap,
  computeStreak,
  formatDayLabel,
  type HeatCell,
  type StatsView,
} from '@/lib/stats';

/**
 * The four /stats charts, over `review_logs`.
 *
 * Nothing here is mocked and nothing is smoothed: an empty collection gets
 * empty states saying so rather than a plausible-looking curve. Three of the
 * four read the log directly (the log is the source of truth), so they
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

      <StreakCard stats={stats} />

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Tile label="Tổng lượt chấm" value={stats.totals.ratings} />
        <Tile label="Thẻ đã học" value={stats.totals.cardsStudied} />
        <Tile label={`Ngày có học / ${VOLUME_DAYS}`} value={studiedDays} />
      </div>

      <div className="space-y-4">
        <Heatmap stats={stats} />

        <ChartCard
          title="Từ đã học mỗi ngày"
          caption="Số thẻ khác nhau đã học mỗi ngày, tính theo ngày học bắt đầu lúc 04:00. Một thẻ chỉ tính một lần dù nó quay lại trong phiên, và một ngày có thể gồm nhiều phiên."
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

        {/* The heatmap and the daily-volume chart are calendars — they want the
            whole width at any size. These four are not, so past xl they pair
            up rather than each stretching to 1100px of near-empty plot. */}
        <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Sắp đến hạn"
          caption={`${FORECAST_DAYS} ngày tới. Từ chưa học không nằm ở đây: chúng do phần từ mới của mỗi phiên thả ra, không phải do lịch.`}
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
          caption="Các thẻ đang chạy, xếp theo độ bền trí nhớ. Từ 21 ngày trở lên coi như đã nhớ chắc."
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
    </div>
  );
}

/**
 * The streak, and the kintsugi framing the design asks for.
 *
 * The gold seam is not a metaphor applied to a number here: the count is a
 * real run of study days and a missed day really does end it. What the design
 * is about is not hiding the break — so the card says how many empty days are
 * in the window rather than quietly dropping them, and the longest run stays
 * on screen after a gap resets the current one.
 */
function StreakCard({ stats }: { stats: StatsView }) {
  const streak = computeStreak(stats.volume);

  return (
    <section className="mb-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Chuỗi ngày học tập
        </span>
        <span className="shrink-0 rounded-full border border-[var(--warning)]/30 bg-[var(--warning-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--warning)]">
          Hàn gắn Kintsugi
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-extrabold tracking-tight text-[var(--text-primary)] tabular-nums">
          {streak.current}
        </span>
        <span className="text-sm font-medium text-[var(--text-muted)]">ngày liên tục</span>
        {streak.longest > streak.current && (
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            Dài nhất: <span className="font-semibold tabular-nums">{streak.longest}</span> ngày
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{streakNote(streak, stats)}</p>
    </section>
  );
}

/**
 * The line under the streak count.
 *
 * A collection with no history at all is not a collection with ninety broken
 * days — nothing has been interrupted yet, and the heatmap below marks none of
 * those days gold, because a gap needs study on both sides of it to be a gap.
 * Saying otherwise would have the card contradicting the map directly beneath.
 */
function streakNote(streak: ReturnType<typeof computeStreak>, stats: StatsView): string {
  if (stats.totals.ratings === 0) {
    return 'Chưa có lượt ôn nào được ghi lại. Chuỗi ngày bắt đầu từ phiên đầu tiên.';
  }
  if (streak.gaps === 0) {
    return `Chưa có ngày trống nào trong ${VOLUME_DAYS} ngày gần nhất.`;
  }
  return (
    `${streak.gaps} ngày trống trong ${VOLUME_DAYS} ngày gần nhất không bị xoá hay phạt — ` +
    'những ngày nằm giữa hai lần học được hàn lại bằng một đường chỉ vàng trên bản đồ bên dưới. ' +
    'Sự gián đoạn là một phần lịch sử học tập.'
  );
}

/** The 35-day density map. Five rows of seven, oldest cell first. */
function Heatmap({ stats }: { stats: StatsView }) {
  const cells = buildHeatmap(stats.volume, HEATMAP_DAYS);
  const total = cells.reduce((sum, cell) => sum + cell.ratings, 0);

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs sm:p-5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[var(--text-primary)]">
          Mật độ ôn tập {HEATMAP_DAYS} ngày qua
        </span>
        <span className="shrink-0 text-[11px] text-[var(--text-muted)] tabular-nums">
          {total} lượt chấm
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1.5 pt-1">
        {cells.map((cell) => (
          <div
            key={cell.day}
            title={
              cell.repaired
                ? `${formatDayLabel(cell.day)} — ngày gián đoạn, đã hàn gắn kintsugi`
                : `${formatDayLabel(cell.day)} — ${cell.ratings} lượt chấm`
            }
            className={`flex h-7 items-center justify-center rounded-md text-[10px] font-medium ${cellClass(cell)}`}
          >
            {cell.repaired ? '金' : ''}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1 text-[11px] text-[var(--text-muted)]">
        <span>Ít</span>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-xs bg-[var(--bg-muted)]" />
          <span className="h-2.5 w-2.5 rounded-xs bg-[var(--chart-seq-1)]" />
          <span className="h-2.5 w-2.5 rounded-xs bg-[var(--chart-seq-3)]" />
          <span className="h-2.5 w-2.5 rounded-xs bg-[var(--chart-seq-5)]" />
          <span className="h-2.5 w-2.5 rounded-xs border border-[var(--warning)] bg-[var(--warning-subtle)]" />
        </div>
        <span>Nhiều</span>
      </div>
    </section>
  );
}

/**
 * The ramp is the sequential one /stats already validated for these surfaces,
 * not the bamboo scale — the bamboo greens were picked to sit against washi as
 * UI chrome, and four of them in a row do not read as ordered.
 */
function cellClass(cell: HeatCell): string {
  if (cell.repaired) {
    return 'border border-[var(--warning)] bg-[var(--warning-subtle)] font-bold text-[var(--warning)]';
  }
  switch (cell.level) {
    case 4:
      return 'bg-[var(--chart-seq-5)] text-white';
    case 3:
      return 'bg-[var(--chart-seq-4)] text-white';
    case 2:
      return 'bg-[var(--chart-seq-3)] text-white';
    case 1:
      return 'bg-[var(--chart-seq-1)] text-[var(--text-primary)]';
    default:
      return 'bg-[var(--bg-muted)] text-[var(--text-muted)]';
  }
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
 * The confusion pairs.
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
