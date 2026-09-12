'use client';

import { Check, X } from 'lucide-react';
import { useState } from 'react';

import type { WordView } from '@/lib/types';

export interface ReviewEdit {
  headword: string;
  reading: string;
  meaning: string;
  note: string | null;
}

/**
 * Fixing a word without leaving the session (§13).
 *
 * A wrong meaning is most visible at the moment it is wrong, and the
 * alternative — remember it, finish the session, go to /words — is how a
 * mistake survives for months. Narrower than the /words editor on purpose:
 * the fields you can be wrong about while looking at the card, and nothing
 * that changes what the card *is*. Part of speech and JLPT belong to the word,
 * not to the review, and they are two taps away on /words.
 *
 * Editing the reading rewrites what a production card accepts (§6), which is
 * the whole point of being able to correct it here.
 */
export function ReviewEditPanel({
  word,
  saving,
  onCancel,
  onSave,
}: {
  word: WordView;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: ReviewEdit) => void;
}) {
  const [headword, setHeadword] = useState(word.headword);
  const [reading, setReading] = useState(word.reading);
  const [meaning, setMeaning] = useState(word.meaning);
  const [note, setNote] = useState(word.note ?? '');

  const field =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 outline-none focus:border-[var(--bamboo)]';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-3 space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <input
          value={headword}
          onChange={(e) => setHeadword(e.target.value)}
          aria-label="Từ"
          className={`${field} font-jp-serif text-lg`}
        />
        <input
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          aria-label="Cách đọc"
          className={`${field} font-jp-serif text-sm`}
        />
      </div>

      <input
        value={meaning}
        onChange={(e) => setMeaning(e.target.value)}
        aria-label="Nghĩa"
        className={`${field} text-sm font-medium`}
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
          Huỷ
        </button>
        <button
          type="button"
          disabled={saving || !headword.trim() || !reading.trim() || !meaning.trim()}
          onClick={() =>
            onSave({
              headword: headword.trim(),
              reading: reading.trim(),
              meaning: meaning.trim(),
              note: note.trim() || null,
            })
          }
          className="flex cursor-pointer items-center gap-1 rounded-lg bg-[var(--bamboo)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          Lưu
        </button>
      </div>
    </div>
  );
}
