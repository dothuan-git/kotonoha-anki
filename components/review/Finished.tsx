'use client';

import { Check, CheckCircle2, Copy, Play, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { formatDueIn } from '@/lib/fsrs/format';
import { toCsv, type MissedWord } from '@/lib/recap';
import type { FinishState } from '@/lib/session-end';
import type { CardKind, RemainingWork } from '@/lib/types';

/**
 * The prototype's completion screen, rebuilt around the fact that finishing a
 * session is no longer the end of the day.
 *
 * Its old "Ôn tập lại từ đầu" button replayed the same deck, which against a
 * real scheduler means re-rating cards already answered. "Phiên tiếp theo"
 * is not that: it deals the cards the budget did not reach.
 *
 * The button is offered on what the action can find, never on `remaining` —
 * that number is counted when the session is built, so it cannot see the
 * learning cards the session made for itself every time you answered Quên.
 * Gating on it would say "done" with a session's work still waiting.
 */
export function Finished({
  state,
  kind = 'word',
  summary,
  missed,
  now,
  busy,
  error,
  onNext,
}: {
  state: FinishState;
  /** Which collection the copy and the "add" link talk about. */
  kind?: CardKind;
  summary: string | null;
  missed: MissedWord[];
  now: string;
  busy: boolean;
  error: string | null;
  onNext: () => void;
}) {
  const copy = finishCopy(state, now, kind);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 25 }}
      className="w-full max-w-lg mx-auto py-16 px-6 text-center"
    >
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.1 }}
        className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shadow-xs"
      >
        <CheckCircle2 className="w-8 h-8" />
      </motion.div>
      <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{copy.title}</h2>

      {summary && (
        <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed max-w-sm mx-auto">
          {summary}
        </p>
      )}
      <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed max-w-sm mx-auto">
        {copy.detail}
      </p>

      {error && <p className="mt-3 text-xs text-[var(--rust)]">{error}</p>}

      {missed.length > 0 && <Recap words={missed} unit={kind === 'grammar' ? 'mẫu' : 'từ'} />}

      <div className="mt-8 flex flex-col items-center gap-2">
        <div className="flex items-center justify-center gap-3">
          {copy.next && (
            <button
              type="button"
              onClick={onNext}
              disabled={busy || !copy.next.enabled}
              className="px-5 py-2.5 rounded-xl bg-[var(--brand)] text-white text-sm font-semibold hover:bg-[var(--brand-hover)] transition-opacity cursor-pointer flex items-center gap-2 shadow-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="w-4 h-4" />
              <span>{busy ? 'Đang chuẩn bị…' : copy.next.label}</span>
            </button>
          )}
          <Link
            href={kind === 'grammar' ? '/grammar/add' : '/add'}
            className="px-5 py-2.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-page)] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-2 shadow-xs"
          >
            <Sparkles className="w-4 h-4" />
            <span>{kind === 'grammar' ? 'Thêm ngữ pháp' : 'Thêm từ vựng'}</span>
          </Link>
        </div>
        {copy.next && !copy.next.enabled && (
          <span className="text-[11px] text-[var(--text-muted)]">{copy.next.blocked}</span>
        )}
      </div>
    </motion.div>
  );
}

/** What each finish state says, and what it offers. */
function finishCopy(
  state: FinishState,
  now: string,
  kind: CardKind,
): {
  title: string;
  detail: string;
  next?: { label: string; enabled: boolean; blocked: string };
} {
  switch (state.kind) {
    case 'empty-collection':
      return {
        title: 'Chưa có thẻ nào',
        detail:
          kind === 'grammar'
            ? 'Chưa có mẫu ngữ pháp nào. Thêm mẫu đầu tiên và nó sẽ xuất hiện ở đây ngay.'
            : 'Chưa có thẻ nào trong sổ. Thêm từ đầu tiên và nó sẽ xuất hiện ở đây ngay.',
      };

    case 'waiting-for-sync':
      return {
        title: 'Xong phiên này',
        detail: 'Đang gửi các lượt vừa chấm. Thử lại sau vài giây.',
        next: { label: 'Thử lại', enabled: true, blocked: '' },
      };

    case 'more-waiting': {
      const rest = describeRemaining(state.remaining, kind);
      return {
        title: 'Xong phiên này',
        detail: state.canDeal
          ? `Còn ${rest} đang chờ.`
          : `Còn ${rest} đang chờ. Cần có mạng để nhận phiên tiếp theo — mở lại khi có mạng là học tiếp được ngay.`,
        next: {
          label: 'Phiên tiếp theo',
          enabled: state.canDeal,
          blocked: 'Đang ngoại tuyến',
        },
      };
    }

    case 'all-clear': {
      const due = state.nextDue
        ? `Thẻ gần nhất ${formatDueIn(new Date(now), new Date(state.nextDue))}.`
        : 'Không còn thẻ nào chờ đến hạn.';
      return {
        title: 'Đã ôn hết',
        detail: state.outOfNewWords
          ? kind === 'grammar'
            ? `${due} Không còn mẫu ngữ pháp mới nào — thêm mẫu để học tiếp.`
            : `${due} Sổ từ không còn từ mới nào — thêm từ để học tiếp.`
          : due,
      };
    }

    case 'nothing-due':
      return {
        title: 'Không còn thẻ đến hạn',
        detail: state.nextDue
          ? `Bạn đã ôn xong các thẻ đến hạn. Thẻ gần nhất ${formatDueIn(new Date(now), new Date(state.nextDue))}.`
          : 'Bạn đã ôn xong các thẻ đến hạn.',
      };

    case 'practice-empty':
      return {
        title: 'Chưa có từ để luyện tập',
        detail:
          'Luyện tập ôn lại những từ bạn đã học. Hãy ôn tập vài từ trước đã — chúng sẽ xuất hiện ở đây ngay sau đó.',
      };

    case 'practice-done': {
      // The page number is shown because the set moves under you: the newest
      // page today is not the newest page after the next import, and without
      // a position there is no way to tell one drill from another.
      const where = `Trang ${state.page + 1}/${state.pages}.`;
      const last = state.page + 1 >= state.pages;
      const rest = last
        ? 'Hết sổ từ — trang sau quay lại những từ mới nhất.'
        : 'Trang sau là những từ cũ hơn.';
      return {
        title: 'Xong phiên luyện tập',
        // Practice queues nothing, so nothing is ever in flight. The one
        // thing that can block the next page is a spent lookahead with no
        // network — the page has to be fetched, and only the server knows
        // which words are on it.
        detail: state.canDeal
          ? `${where} ${rest}`
          : `${where} Cần có mạng để nhận trang tiếp theo.`,
        next: {
          label: last ? 'Quay lại từ đầu' : 'Trang tiếp theo',
          enabled: state.canDeal,
          blocked: 'Đang ngoại tuyến',
        },
      };
    }
  }
}

/**
 * The day's misses, and a way to take them somewhere else.
 *
 * Three fields and no fourth. The grade is not a column because the list is
 * already ordered by it — Quên before Khó — and a badge on every row would
 * make the loudest thing on the screen the scoring rather than the words.
 *
 * The CSV is on the page whether or not the button works. `navigator.clipboard`
 * is absent outside a secure context and can reject inside one, and a copy
 * button that fails silently on a list you are about to close is a list lost.
 */
function Recap({ words, unit }: { words: MissedWord[]; unit: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const csv = toCsv(words);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(csv);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Cần ôn thêm</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {words.length} {unit} bạn chấm Quên hoặc Khó trong phiên này.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            copied
              ? 'border-[var(--brand-border)] bg-[var(--brand-subtle)] text-[var(--brand)]'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Đã sao chép' : 'Sao chép CSV'}</span>
        </button>
      </div>

      {copyFailed && (
        <p className="mt-2 text-[11px] text-[var(--danger)]">
          Không sao chép được — hãy mở “Xem CSV” bên dưới và chọn thủ công.
        </p>
      )}

      <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
        {words.map((word) => (
          <li key={word.cardId} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="font-jp-serif text-base text-[var(--text-primary)]">{word.headword}</p>
              {/* A kana-only word is its own reading; printing it twice reads
                  as a mistake rather than as a fact about the word. */}
              {word.reading && word.reading !== word.headword && (
                <p className="mt-0.5 font-jp-sans text-xs text-[var(--text-muted)]">
                  {word.reading}
                </p>
              )}
            </div>
            <p className="max-w-[55%] shrink-0 text-right text-xs text-[var(--text-secondary)]">
              {word.meaning}
            </p>
          </li>
        ))}
      </ul>

      <details className="mt-3 border-t border-[var(--border-subtle)] pt-2">
        <summary className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          Xem CSV
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--bg-muted)] p-2 text-[11px] whitespace-pre text-[var(--text-secondary)]">
          {csv}
        </pre>
      </details>
    </section>
  );
}

/** "Còn 12 thẻ đến hạn và 3 từ mới", dropping whichever half is zero. */
function describeRemaining(remaining: RemainingWork, kind: CardKind): string {
  const parts: string[] = [];
  if (remaining.reviewCards > 0) parts.push(`${remaining.reviewCards} thẻ đến hạn`);
  if (remaining.newCards > 0) {
    parts.push(`${remaining.newCards} ${kind === 'grammar' ? 'mẫu mới' : 'từ mới'}`);
  }
  return parts.join(' và ');
}
