'use client';

import { ArrowLeft, Check, Pencil, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Ruby } from '@/components/Ruby';
import { setKanjiDetails } from '@/lib/actions/words';
import { playJapaneseAudio } from '@/lib/client/audio';
import { formatHanViet, formatPos, type KanjiView, type WordView } from '@/lib/types';

export function KanjiDetail({ kanji, words }: { kanji: KanjiView; words: WordView[] }) {
  const [editing, setEditing] = useState(false);
  const [hanViet, setHanViet] = useState(kanji.hanViet.join(' '));
  const [meaningVi, setMeaningVi] = useState(kanji.meaningVi ?? '');
  const [pending, startTransition] = useTransition();

  return (
    <div className="w-full">
      <Link
        href="/kanji"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Mạng lưới Hán tự
      </Link>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          {/* The prototype's modal header seal: the glyph set in a bamboo tile
              rather than loose on the page. */}
          <span className="font-jp-serif flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-3xl font-semibold text-[var(--bamboo)] sm:h-16 sm:w-16 sm:text-4xl">
            {kanji.char}
          </span>

          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <input
                  value={hanViet}
                  onChange={(e) => setHanViet(e.target.value)}
                  placeholder="khai"
                  aria-label="Âm Hán Việt"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] px-2.5 py-1.5 text-sm uppercase"
                />
                <input
                  value={meaningVi}
                  onChange={(e) => setMeaningVi(e.target.value)}
                  placeholder="Mở, bắt đầu"
                  aria-label="Nghĩa tiếng Việt"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] px-2.5 py-1.5 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-lg px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await setKanjiDetails(kanji.char, {
                          hanViet: hanViet.trim() ? hanViet.trim().split(/\s+/) : [],
                          meaningVi: meaningVi.trim() || null,
                        });
                        setEditing(false);
                      })
                    }
                    className="flex items-center gap-1 rounded-lg bg-[var(--bamboo)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Lưu
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold uppercase tracking-wide text-[var(--bamboo)]">
                    {kanji.hanViet.length > 0 ? kanji.hanViet.join(' / ').toUpperCase() : '—'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Sửa âm Hán Việt và nghĩa"
                    className="rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                  {kanji.meaningVi ?? 'Chưa có nghĩa — chạm bút chì để thêm.'}
                </p>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  {kanji.jlpt ? `${kanji.jlpt} · ` : ''}
                  {words.length} từ trong sổ
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-[var(--text-primary)]">
        Các từ cùng gốc
      </h2>

      <ul className="space-y-2">
        {words.map((word) => {
          const sentence = word.sentences[0];
          return (
            <li
              key={word.id}
              className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-jp-serif text-xl font-semibold">{word.headword}</span>
                    <span className="font-jp-serif text-xs text-[var(--text-muted)]">
                      {word.reading}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--text-primary)]">{word.meaning}</p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {formatPos(word.pos, word.transitivity)} · {formatHanViet(word.kanji)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => playJapaneseAudio(word.headword)}
                  aria-label={`Đọc ${word.headword}`}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              </div>

              {sentence && (
                <div className="mt-2 rounded-xl bg-[var(--bg-muted)]/50 px-3 py-2">
                  <Ruby text={sentence.jpRuby} className="font-jp-serif text-base leading-loose" />
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{sentence.vi}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
