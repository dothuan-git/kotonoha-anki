'use client';

import { AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';

import { ReviewEditPanel, type ReviewEdit } from '@/components/ReviewEditPanel';
import type { WordView } from '@/lib/types';

/**
 * The leech prompt: shown once at six lapses on a card, asking for the
 * meaning to be rewritten or a note added. Once dismissed, the production
 * card goes `active = false` and recognition keeps running — the word is
 * never auto-deleted or auto-suspended.
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
 */
export function LeechPanel({
  word,
  lapses,
  saving,
  onSave,
  onDismiss,
}: {
  word: WordView;
  lapses: number;
  saving: boolean;
  onSave: (patch: ReviewEdit) => void;
  onDismiss: () => void;
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
            Thường thì nghĩa đang ghi chưa khớp với cách bạn nhớ từ này. Viết lại nghĩa hoặc thêm
            một ghi chú để phân biệt. Thẻ gõ của từ sẽ tạm nghỉ, thẻ lật vẫn chạy tiếp — từ không bị
            xoá và cũng không bị tạm dừng.
          </p>
        </div>
      </div>

      <ReviewEditPanel
        word={word}
        saving={saving}
        onCancel={onDismiss}
        onSave={onSave}
        cancelLabel="Để nguyên"
      />

      <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
        Nhắc một lần duy nhất cho thẻ này.
      </p>
    </motion.div>
  );
}
