'use client';

import { ArrowRight, Bot, Check, Sparkles, UserCheck, Volume2, VolumeX } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { bind, unbind } from 'wanakana';

import { Ruby } from '@/components/Ruby';
import { createWord } from '@/lib/actions/words';
import { hasJapaneseVoice, onVoicesReady, playJapaneseAudio } from '@/lib/client/audio';
import { rubyToPlain } from '@/lib/ruby';
import {
  JLPT_VALUES,
  POS_LABELS,
  POS_VALUES,
  type Jlpt,
  type LookupCandidate,
  type Pos,
} from '@/lib/types';

const JLPT_LABELS: Record<Jlpt, string> = {
  N5: 'N5 (Cơ bản)',
  N4: 'N4 (Sơ cấp)',
  N3: 'N3 (Trung cấp)',
  N2: 'N2 (Trung-Cao cấp)',
  N1: 'N1 (Cao cấp)',
};

type Status = 'idle' | 'looking' | 'saving' | 'saved';

/** Per-kanji Hán Việt, editable — for typing over the gaps in the Unihan data by hand. */
type HanVietDraft = Array<{ char: string; reading: string }>;

export function AddWordScreen({ initialQuery = '' }: { initialQuery?: string }) {
  const [headword, setHeadword] = useState(initialQuery);
  const [reading, setReading] = useState('');
  const [meaning, setMeaning] = useState('');
  const [pos, setPos] = useState<Pos | ''>('');
  const [transitivity, setTransitivity] = useState<'transitive' | 'intransitive' | ''>('');
  const [jlpt, setJlpt] = useState<Jlpt | ''>('');
  const [note, setNote] = useState('');
  const [hanViet, setHanViet] = useState<HanVietDraft>([]);
  const [sentenceRuby, setSentenceRuby] = useState('');
  const [sentenceVi, setSentenceVi] = useState('');

  const [status, setStatus] = useState<Status>('idle');
  const [autofilled, setAutofilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null until the voice list has loaded — see the TTS check in lib/client/audio. */
  const [canSpeak, setCanSpeak] = useState<boolean | null>(null);

  const headwordRef = useRef<HTMLInputElement>(null);
  const readingRef = useRef<HTMLInputElement>(null);
  /** Guards against a slow earlier lookup landing after a newer one. */
  const requestSeq = useRef(0);

  /**
   * The reading input is uncontrolled because wanakana.bind writes kana
   * directly into the node; a controlled `value` would fight it mid-word. Any
   * programmatic fill therefore has to go through the node too.
   */
  const setReadingValue = (value: string) => {
    if (readingRef.current) readingRef.current.value = value;
    setReading(value);
  };

  // Romaji -> kana as you type, so the reading field never needs an IME.
  useEffect(() => {
    const el = readingRef.current;
    if (!el) return;
    bind(el, { IMEMode: 'toHiragana' });
    return () => unbind(el);
  }, []);

  /**
   * The TTS check, run where it can still be acted on.
   *
   * Nothing is generated or stored: the voice is the platform's and it is on
   * the device, which is why it works on the train. What is worth knowing at
   * save time is whether it exists at all — a phone with no Japanese voice
   * reads 開ける in English, and discovering that in the middle of a session is
   * both too late and easy to mistake for a bad recording.
   */
  useEffect(() => onVoicesReady(() => setCanSpeak(hasJapaneseVoice())), []);

  useEffect(() => {
    const q = headword.trim();
    if (!q) {
      setAutofilled(false);
      setStatus('idle');
      return;
    }

    const seq = ++requestSeq.current;
    setStatus('looking');
    const timer = setTimeout(() => void runLookup(q, seq), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headword]);

  async function runLookup(query: string, seq: number) {
    let candidate: LookupCandidate | null = null;

    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as { candidates?: LookupCandidate[] };
      candidate = data.candidates?.[0] ?? null;
    } catch {
      candidate = null;
    }

    if (seq !== requestSeq.current) return;

    if (candidate) {
      // Only fill what the user has not already typed — the dictionary is a
      // suggestion and must never clobber a deliberate correction.
      if (!reading.trim()) setReadingValue(candidate.reading);
      setPos((prev) => prev || candidate!.pos || '');
      setTransitivity((prev) => prev || candidate!.transitivity || '');
      setJlpt((prev) => prev || candidate!.jlptHint || '');
      setHanViet(
        candidate.kanji.map((k) => ({ char: k.char, reading: k.hanViet.join(' ') })),
      );
      setAutofilled(true);
    }

    setStatus('idle');
  }

  function reset() {
    requestSeq.current++;
    setHeadword('');
    setReadingValue('');
    setMeaning('');
    setPos('');
    setTransitivity('');
    setJlpt('');
    setNote('');
    setHanViet([]);
    setSentenceRuby('');
    setSentenceVi('');
    setAutofilled(false);
    setStatus('idle');
    headwordRef.current?.focus();
  }

  const canSave = headword.trim() !== '' && meaning.trim() !== '' && pos !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || status === 'saving') return;

    setStatus('saving');
    setError(null);

    const result = await createWord({
      headword: headword.trim(),
      reading: reading.trim() || headword.trim(),
      meaning: meaning.trim(),
      pos: pos as Pos,
      transitivity: transitivity || null,
      jlpt: jlpt || null,
      note: note.trim() || null,
      hanViet: Object.fromEntries(
        hanViet
          .filter((h) => h.reading.trim() !== '')
          .map((h) => [h.char, h.reading.trim().split(/\s+/)]),
      ),
      sentence:
        sentenceRuby.trim() && sentenceVi.trim()
          ? {
              jp: rubyToPlain(sentenceRuby.trim()),
              jpRuby: sentenceRuby.trim(),
              vi: sentenceVi.trim(),
              source: 'manual' as const,
            }
          : null,
    });

    if (!result.ok) {
      setError(result.error);
      setStatus('idle');
      return;
    }

    setStatus('saved');
    setTimeout(reset, 900);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Thêm từ vựng mới
        </h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Nhập từ tiếng Nhật (ví dụ: 開ける, 勉強), hệ thống sẽ tra từ điển để gợi ý cách đọc, từ loại và Hán Việt.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="headword"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Từ tiếng Nhật (Kanji / Kana)
          </label>
          <div className="relative">
            <input
              id="headword"
              ref={headwordRef}
              type="text"
              value={headword}
              onChange={(e) => setHeadword(e.target.value)}
              autoFocus
              autoComplete="off"
              className="font-jp-serif w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-2xl font-semibold text-[var(--text-primary)] shadow-xs transition-all focus:border-[var(--bamboo)] focus:outline-none focus:ring-2 focus:ring-[var(--bamboo)]/20"
            />
            {/* Overlay stands in for ::placeholder: a smaller placeholder than
                the input's own font sits on its baseline, which reads as
                bottom-aligned. Flex centering is the only reliable fix. */}
            {headword === '' && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3.5 right-3.5 flex items-center truncate text-sm text-[var(--text-muted)]"
              >
                Nhập 開ける, 勉強, 静か...
              </span>
            )}
            {status === 'looking' ? (
              <div className="absolute right-3.5 top-3.5 flex animate-pulse items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Sparkles className="h-4 w-4 text-[var(--bamboo)]" />
                <span>Đang tra cứu…</span>
              </div>
            ) : (
              headword.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => playJapaneseAudio(reading.trim() || headword.trim())}
                  disabled={canSpeak === false}
                  title={
                    canSpeak === false
                      ? 'Thiết bị này chưa có giọng tiếng Nhật'
                      : 'Nghe thử trước khi lưu'
                  }
                  aria-label="Nghe thử cách đọc"
                  className="absolute right-3 top-3 rounded-lg border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)] transition-colors hover:border-[var(--bamboo)] hover:text-[var(--bamboo)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {canSpeak === false ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
              )
            )}
          </div>
          {canSpeak === false && (
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
              Thiết bị này chưa cài giọng đọc tiếng Nhật, nên nút loa trong phiên ôn tập sẽ im
              hoặc đọc sai. Từ vẫn lưu bình thường.
            </p>
          )}
        </div>

        {/* The user's own note — visually the primary field, as in the design. */}
        <div className="rounded-xl border-2 border-[var(--bamboo)]/40 bg-[var(--bamboo-subtle)]/30 p-3.5 shadow-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="meaning"
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--bamboo)]"
            >
              <UserCheck className="h-4 w-4" />
              <span>Nghĩa tiếng Việt (Ghi chú của bạn)</span>
            </label>
            <span className="text-[11px] font-medium text-[var(--text-muted)]">Bắt buộc</span>
          </div>
          <div className="relative">
            <input
              id="meaning"
              type="text"
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2 text-base font-medium text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
              required
            />
            {meaning === '' && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 right-3 flex items-center truncate text-xs text-[var(--text-muted)]"
              >
                Nghĩa súc tích, theo cách hiểu của bạn...
              </span>
            )}
          </div>
        </div>

        {/* Everything the dictionary drafted. The dashed rule is the design's
            way of saying provisional: the block above is yours, this one is a
            suggestion you are expected to overwrite. */}
        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-muted)]/40 p-3.5">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              <span className="font-semibold text-[var(--text-secondary)]">
                Thông tin máy gợi ý (có thể chỉnh sửa)
              </span>
            </div>
            {autofilled && (
              <span className="text-[11px] font-semibold text-[var(--bamboo)]">
                Đã tự động điền
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="Cách đọc (Hiragana)" htmlFor="reading">
              <input
                id="reading"
                ref={readingRef}
                type="text"
                onChange={(e) => setReading(e.target.value)}
                placeholder="akeru → あける"
                className="font-jp-serif w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
              />
            </Field>

            <Field label="Từ loại" htmlFor="pos">
              <select
                id="pos"
                value={pos}
                onChange={(e) => setPos(e.target.value as Pos | '')}
                required
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
              >
                <option value="">— chọn —</option>
                {POS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {POS_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Tự / tha động từ" htmlFor="transitivity">
              <select
                id="transitivity"
                value={transitivity}
                onChange={(e) =>
                  setTransitivity(e.target.value as 'transitive' | 'intransitive' | '')
                }
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
              >
                <option value="">—</option>
                <option value="transitive">Tha động từ</option>
                <option value="intransitive">Tự động từ</option>
              </select>
            </Field>

            <Field label="Cấp độ JLPT" htmlFor="jlpt">
              <select
                id="jlpt"
                value={jlpt}
                onChange={(e) => setJlpt(e.target.value as Jlpt | '')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
              >
                <option value="">— chưa rõ —</option>
                {JLPT_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {JLPT_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {hanViet.length > 0 && (
            <Field label="Hán Việt (mỗi Hán tự một âm)">
              <div className="flex flex-wrap gap-2">
                {hanViet.map((entry, i) => (
                  <div
                    key={`${entry.char}-${i}`}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1"
                  >
                    <span className="font-jp-serif text-lg leading-none">{entry.char}</span>
                    <input
                      type="text"
                      value={entry.reading}
                      onChange={(e) =>
                        setHanViet((prev) =>
                          prev.map((h, j) =>
                            j === i ? { ...h, reading: e.target.value } : h,
                          ),
                        )
                      }
                      placeholder="khai"
                      aria-label={`Âm Hán Việt của ${entry.char}`}
                      className="w-20 bg-transparent text-sm uppercase text-[var(--text-primary)] focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </Field>
          )}

          <Field label="Câu ví dụ tiếng Nhật (furigana trong ngoặc vuông)" htmlFor="sentenceRuby">
            <input
              id="sentenceRuby"
              type="text"
              value={sentenceRuby}
              onChange={(e) => setSentenceRuby(e.target.value)}
              placeholder="窓[まど]を開[あ]けてください。"
              className="font-jp-sans w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
            />
            {sentenceRuby.trim() !== '' && (
              <div className="mt-1.5 rounded-lg bg-[var(--bg-surface)] px-2.5 py-2">
                <Ruby text={sentenceRuby} className="font-jp-serif text-lg" />
              </div>
            )}
          </Field>

          <Field label="Dịch nghĩa câu ví dụ" htmlFor="sentenceVi">
            <input
              id="sentenceVi"
              type="text"
              value={sentenceVi}
              onChange={(e) => setSentenceVi(e.target.value)}
              placeholder="Xin hãy mở cửa sổ."
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
            />
          </Field>

          <Field label="Ghi chú riêng (không bắt buộc)" htmlFor="note">
            <input
              id="note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Dễ lẫn với 開く…"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--bamboo)] focus:outline-none"
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <motion.button
            type="submit"
            whileHover={canSave ? { scale: 1.01 } : {}}
            whileTap={canSave ? { scale: 0.97 } : {}}
            disabled={!canSave || status === 'saving'}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-xs transition-colors ${
              status === 'saved'
                ? 'bg-emerald-600 text-white'
                : !canSave
                  ? 'cursor-not-allowed bg-[var(--bg-muted)] text-[var(--text-muted)]'
                  : 'cursor-pointer bg-[var(--bamboo)] text-white hover:bg-[var(--bamboo-hover)]'
            }`}
          >
            {status === 'saved' ? (
              <>
                <Check className="h-4 w-4" />
                <span>Đã lưu vào kho từ!</span>
              </>
            ) : (
              <span>{status === 'saving' ? 'Đang lưu…' : 'Lưu từ vựng'}</span>
            )}
          </motion.button>

          <Link
            href="/words"
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-3.5 py-3 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <span>Kho từ</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
