'use client';

import { Check, X } from 'lucide-react';
import { useState } from 'react';

import type { GrammarView } from '@/lib/types';

/** What the in-review editor can change about a grammar point. */
export interface GrammarEditPatch {
  meaning: string;
  formation: string | null;
  note: string | null;
}

/**
 * Fixing a grammar point without leaving the session — the grammar twin of
 * `ReviewEditPanel`, and narrow for the same reason: the fields you can be
 * wrong about while looking at the card. The pattern and the sentences are
 * edited on /grammar/list.
 */
export function GrammarEditPanel({
  grammar,
  saving,
  onCancel,
  onSave,
  cancelLabel = 'Huỷ',
}: {
  grammar: GrammarView;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: GrammarEditPatch) => void;
  /** The leech prompt reuses this panel, where leaving it is not a cancel. */
  cancelLabel?: string;
}) {
  const [meaning, setMeaning] = useState(grammar.meaning);
  const [formation, setFormation] = useState(grammar.formation ?? '');
  const [note, setNote] = useState(grammar.note ?? '');

  const field =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 outline-none focus:border-[var(--brand)]';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-3 space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-3"
    >
      <input
        value={meaning}
        onChange={(e) => setMeaning(e.target.value)}
        aria-label="Nghĩa"
        className={`${field} text-sm font-medium`}
      />
      <input
        value={formation}
        onChange={(e) => setFormation(e.target.value)}
        placeholder="Cách chia: V-て + しまう"
        aria-label="Cách chia"
        className={`${field} font-jp-sans text-sm`}
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Ghi chú riêng"
        aria-label="Ghi chú"
        className={`${field} text-xs`}
      />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
        >
          <X className="h-3.5 w-3.5" />
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={saving || !meaning.trim()}
          onClick={() =>
            onSave({
              meaning: meaning.trim(),
              formation: formation.trim() || null,
              note: note.trim() || null,
            })
          }
          className="flex cursor-pointer items-center gap-1 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          Lưu
        </button>
      </div>
    </div>
  );
}
