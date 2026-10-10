'use client';

import { AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';


/**
 * The leech prompt: shown once at six lapses on a card, asking for the
 * meaning to be rewritten or a note added. The word keeps running either way
 * — it is never auto-deleted, auto-suspended, or taken out of rotation.
 *
 * So the prompt *is* the editor — a rewrite is the point, and an alert that
 * only told you to go and do one somewhere else would be an alert you
 * dismiss. Saving and dismissing both count as having read it, because in
 * both cases you have made the decision the prompt exists to get.
 *
 * What it will not do is offer to suspend or delete the word. Both stay
 * manual, and putting them behind this button would be the same thing with
 * an extra tap: the moment you have just failed a word six times is the
 * worst moment to decide you are done with it.
 *
 * The editor itself is the caller's — a word and a grammar point are fixed
 * through different fields — and is expected to treat its cancel as "để
 * nguyên", which acknowledges the prompt like a save does.
 */
export function LeechPanel({
  lapses,
  children,
}: {
  lapses: number;
  /** The editor for this card's kind. */
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -6, height: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-3 overflow-hidden rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-subtle)] p-3"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Thẻ khó — đã quên {lapses} lần
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            Thường thì nghĩa đang ghi chưa khớp với cách bạn nhớ thẻ này. Viết lại nghĩa hoặc thêm
            một ghi chú để phân biệt. Thẻ vẫn tiếp tục xuất hiện — không bị xoá và cũng không bị tạm
            dừng.
          </p>
        </div>
      </div>

      {children}

      <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
        Nhắc một lần duy nhất cho thẻ này.
      </p>
    </motion.div>
  );
}
