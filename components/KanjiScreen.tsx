'use client';

import Link from 'next/link';
import { motion } from 'motion/react';

import type { KanjiView } from '@/lib/types';

/**
 * The kanji index shows only characters that appear in a saved word — the
 * Unihan seed puts ~10k reference rows in the table, and this screen is meant
 * to be the user's own collection.
 */
export function KanjiScreen({ kanji }: { kanji: KanjiView[] }) {
  return (
    <div className="w-full">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Mạng lưới Hán tự & Hán Việt
        </h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Âm Hán Việt là sợi chỉ đỏ xâu chuỗi các từ vựng. Chạm vào một Hán tự để xem các từ cùng
          gốc.
        </p>
      </div>

      {kanji.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            Chưa có Hán tự nào trong sổ.
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-[var(--text-muted)]">
            Hán tự xuất hiện ở đây khi bạn thêm từ có chứa chúng.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
          {kanji.map((item) => (
            <motion.div key={item.char} whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.96 }}>
              <Link
                href={`/kanji/${encodeURIComponent(item.char)}`}
                className="group flex min-h-[105px] select-none flex-col items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-center transition-colors hover:border-[var(--bamboo)] hover:shadow-xs sm:p-4"
              >
                <div className="flex w-full items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{item.jlpt ?? '—'}</span>
                  <span className="font-semibold text-[var(--bamboo)]">{item.wordCount} từ</span>
                </div>

                <span className="font-jp-serif text-4xl leading-none text-[var(--text-primary)]">
                  {item.char}
                </span>

                <span className="w-full truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {item.hanViet.length > 0 ? item.hanViet.join(' / ').toUpperCase() : '—'}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
