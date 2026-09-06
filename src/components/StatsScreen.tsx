import React from 'react';
import { WordItem } from '../types';

interface StatsScreenProps {
  words: WordItem[];
}

export const StatsScreen: React.FC<StatsScreenProps> = ({ words }) => {
  // Generate mock heatmap for the last 35 days (5 weeks)
  const days = Array.from({ length: 35 }).map((_, i) => {
    const isRepairedGap = i === 12; // Kintsugi repaired break
    const count = isRepairedGap ? 0 : (i * 7 + 3) % 15;
    return {
      day: i + 1,
      count,
      isRepairedGap,
    };
  });

  // Calculate stats
  const totalReviewed = words.reduce((acc, w) => acc + w.reviewCount, 0);
  const retentionRate = 92.5; // High retention

  return (
    <div className="w-full py-2 px-1 sm:px-2 space-y-4">
      {/* 1. Kintsugi Streak Header */}
      <div className="p-4 sm:p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Chuỗi ngày học tập
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
            Hàn gắn Kintsugi
          </span>
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tracking-tight text-[var(--text-primary)]">
            14
          </span>
          <span className="text-sm font-medium text-[var(--text-muted)]">ngày liên tục</span>
        </div>

        <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
          Khoảng trống ngày 28/08 không bị xoá hay phạt mà được hàn lại bằng một đường chỉ vàng. 
          Sự gián đoạn là một phần lịch sử học tập được trân trọng.
        </p>
      </div>

      {/* 2. Review Heatmap */}
      <div className="p-4 sm:p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[var(--text-primary)]">
            Mật độ ôn tập 35 ngày qua
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {totalReviewed} lượt ôn
          </span>
        </div>

        {/* Heatmap Grid */}
        <div className="grid grid-cols-7 gap-1.5 pt-1">
          {days.map((d, idx) => (
            <div
              key={idx}
              title={
                d.isRepairedGap
                  ? 'Ngày gián đoạn — đã hàn gắn kintsugi'
                  : `${d.count} từ ôn tập`
              }
              className={`h-7 rounded-md flex items-center justify-center text-[10px] font-medium transition-all ${
                d.isRepairedGap
                  ? 'border border-amber-500 bg-amber-400/20 text-amber-700 dark:text-amber-300 font-bold'
                  : d.count > 10
                  ? 'bg-[var(--bamboo)] text-white'
                  : d.count > 6
                  ? 'bg-[var(--bamboo-hover)] text-white opacity-90'
                  : d.count > 0
                  ? 'bg-[var(--bamboo-subtle)] text-[var(--bamboo)] font-semibold'
                  : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
              }`}
            >
              {d.isRepairedGap ? '金' : ''}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1">
          <span>Ít</span>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--bg-muted)]" />
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--bamboo-subtle)]" />
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--bamboo-hover)] opacity-90" />
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--bamboo)]" />
            <span className="w-2.5 h-2.5 rounded-xs border border-amber-500 bg-amber-400/20" />
          </div>
          <span>Nhiều</span>
        </div>
      </div>

      {/* 3. Retention Rate Over Time (Hairline ink on paper) */}
      <div className="p-4 sm:p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs space-y-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-[var(--text-primary)]">
            Tỉ lệ ghi nhớ tích luỹ
          </span>
          <span className="text-base font-bold text-[var(--bamboo)]">
            {retentionRate}%
          </span>
        </div>

        {/* Minimalist Hairline Graph */}
        <div className="w-full h-28 pt-2">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 300 80">
            {/* Guide line */}
            <line
              x1="0"
              y1="70"
              x2="300"
              y2="70"
              stroke="var(--border-subtle)"
              strokeWidth="0.75"
            />
            <line
              x1="0"
              y1="20"
              x2="300"
              y2="20"
              stroke="var(--border-subtle)"
              strokeWidth="0.75"
              strokeDasharray="3 3"
            />

            {/* Retention curve hairline */}
            <path
              d="M 0 65 Q 40 55, 80 40 T 160 28 T 240 18 T 300 14"
              fill="none"
              stroke="currentColor"
              className="text-[var(--bamboo)]"
              strokeWidth="2"
            />

            {/* Endpoint dot */}
            <circle cx="300" cy="14" r="3.5" fill="var(--bamboo)" />
          </svg>
        </div>
      </div>

      {/* 4. 30-Day Review Forecast */}
      <div className="p-4 sm:p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs space-y-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-[var(--text-primary)]">
            Dự báo lượng từ cần ôn trong 30 ngày tới
          </span>
          <span className="text-xs text-[var(--text-muted)] font-medium">Trung bình 8 từ/ngày</span>
        </div>

        <div className="w-full h-24 flex items-end justify-between gap-1 pt-4">
          {[12, 10, 8, 14, 6, 9, 11, 7, 5, 8, 10, 12, 6, 4, 7].map((val, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-[var(--text-primary)]/75 rounded-t-xs hover:bg-[var(--bamboo)] transition-colors"
                style={{ height: `${val * 4.5}px` }}
              />
              <span className="text-[9px] text-[var(--text-muted)]">{i * 2 + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
