import React, { useState } from 'react';
import { WordItem } from '../types';
import { AUTOFILL_DICTIONARY } from '../data';
import { Sparkles, Check, ArrowRight, UserCheck, Bot } from 'lucide-react';
import { motion } from 'motion/react';

interface AddWordScreenProps {
  onAddWord: (word: WordItem) => void;
  onNavigateToWords: () => void;
}

export const AddWordScreen: React.FC<AddWordScreenProps> = ({
  onAddWord,
  onNavigateToWords,
}) => {
  const [headword, setHeadword] = useState('');
  const [reading, setReading] = useState('');
  const [meaning, setMeaning] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [level, setLevel] = useState<'N5' | 'N4' | 'N3' | 'N2' | 'N1'>('N5');
  const [hanViet, setHanViet] = useState('');
  const [exampleJa, setExampleJa] = useState('');
  const [exampleVi, setExampleVi] = useState('');

  const [isLookingUp, setIsLookingUp] = useState(false);
  const [hasAutofilled, setHasAutofilled] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Auto-fill logic when user inputs a word
  const handleHeadwordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHeadword(val);
    setIsSaved(false);

    if (!val.trim()) {
      setHasAutofilled(false);
      return;
    }

    // Check if word exists in auto-fill dictionary
    setIsLookingUp(true);
    setTimeout(() => {
      const match = AUTOFILL_DICTIONARY[val.trim()];
      if (match) {
        setReading(match.reading || '');
        setMeaning(match.meaning || '');
        setPartOfSpeech(match.partOfSpeech || 'Verb');
        setLevel(match.level as 'N5' | 'N4' | 'N3' | 'N2' | 'N1' || 'N5');
        setHanViet(match.hanViet || '');
        setExampleJa(match.exampleJa || '');
        setExampleVi(match.exampleVi || '');
        setHasAutofilled(true);
      } else {
        // Fallback draft for new words
        if (!reading) setReading(val);
        if (!partOfSpeech) setPartOfSpeech('Từ vựng');
        setHasAutofilled(true);
      }
      setIsLookingUp(false);
    }, 180);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!headword.trim() || !meaning.trim()) return;

    const newWord: WordItem = {
      id: `w_${Date.now()}`,
      kanji: headword.trim(),
      reading: reading.trim() || headword.trim(),
      meaning: meaning.trim(),
      partOfSpeech: partOfSpeech.trim() || 'Từ mới',
      level,
      hanViet: hanViet.trim() || '—',
      exampleJa: exampleJa.trim() || `${headword}。`,
      exampleVi: exampleVi.trim() || meaning.trim(),
      createdAt: new Date().toISOString().split('T')[0],
      reviewCount: 0,
      correctStreak: 0,
      nextDueDate: 'Hôm nay',
    };

    onAddWord(newWord);
    setIsSaved(true);

    // Reset form after short feedback
    setTimeout(() => {
      setHeadword('');
      setReading('');
      setMeaning('');
      setPartOfSpeech('');
      setHanViet('');
      setExampleJa('');
      setExampleVi('');
      setHasAutofilled(false);
    }, 1200);
  };

  return (
    <div className="w-full py-2 px-1 sm:px-2">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Thêm từ vựng mới
        </h2>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Nhập từ tiếng Nhật (ví dụ: 開ける, 勉強), hệ thống tự động điền các trường còn lại.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        {/* Primary Headword Input */}
        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
            Từ tiếng Nhật (Kanji / Kana)
          </label>
          <div className="relative">
            <input
              type="text"
              value={headword}
              onChange={handleHeadwordChange}
              placeholder="Nhập 開ける, 勉強, 静か..."
              autoFocus
              className="w-full text-2xl font-jp-serif font-semibold py-2.5 px-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--bamboo)]/20 focus:border-[var(--bamboo)] transition-all shadow-xs"
            />
            {isLookingUp && (
              <div className="absolute right-3.5 top-3.5 text-xs text-[var(--text-muted)] flex items-center gap-1.5 animate-pulse">
                <Sparkles className="w-4 h-4 text-[var(--bamboo)]" />
                <span>Đang tra cứu...</span>
              </div>
            )}
          </div>
        </div>

        {/* The Core distinction: Vietnamese Meaning (The User's Personal Note) */}
        <div className="p-3.5 rounded-xl border-2 border-[var(--bamboo)]/40 bg-[var(--bamboo-subtle)]/30 shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-[var(--bamboo)] flex items-center gap-1.5">
              <UserCheck className="w-4 h-4" />
              <span>Nghĩa tiếng Việt (Ghi chú của bạn)</span>
            </label>
            <span className="text-[11px] text-[var(--text-muted)] font-medium">Bắt buộc</span>
          </div>
          <input
            type="text"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder="Nghĩa súc tích, theo cách hiểu của bạn..."
            className="w-full text-base font-medium py-2 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
            required
          />
        </div>

        {/* Machine-Drafted / Provisional Fields */}
        <div className="p-3.5 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-muted)]/40 space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5" />
              <span className="font-semibold text-[var(--text-secondary)]">
                Thông tin máy gợi ý (Có thể chỉnh sửa)
              </span>
            </div>
            {hasAutofilled && (
              <span className="text-[11px] text-[var(--bamboo)] font-semibold">
                Đã tự động điền
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Reading */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Cách đọc (Hiragana)
              </label>
              <input
                type="text"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                placeholder="あける"
                className="w-full text-sm font-jp-serif py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
              />
            </div>

            {/* Hán Việt */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Hán Việt
              </label>
              <input
                type="text"
                value={hanViet}
                onChange={(e) => setHanViet(e.target.value)}
                placeholder="開 KHAI"
                className="w-full text-sm py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
              />
            </div>

            {/* Part of Speech */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Từ loại
              </label>
              <input
                type="text"
                value={partOfSpeech}
                onChange={(e) => setPartOfSpeech(e.target.value)}
                placeholder="Verb 2, tha động từ..."
                className="w-full text-sm py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
              />
            </div>

            {/* JLPT Level */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Cấp độ JLPT
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as any)}
                className="w-full text-sm py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
              >
                <option value="N5">N5 (Cơ bản)</option>
                <option value="N4">N4 (Sơ cấp)</option>
                <option value="N3">N3 (Trung cấp)</option>
                <option value="N2">N2 (Trung-Cao cấp)</option>
                <option value="N1">N1 (Cao cấp)</option>
              </select>
            </div>
          </div>

          {/* Example Sentence Japanese */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
              Câu ví dụ tiếng Nhật
            </label>
            <input
              type="text"
              value={exampleJa}
              onChange={(e) => setExampleJa(e.target.value)}
              placeholder="窓を開けてください。"
              className="w-full text-sm font-jp-sans py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
            />
          </div>

          {/* Example Sentence Vietnamese */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
              Dịch nghĩa câu ví dụ
            </label>
            <input
              type="text"
              value={exampleVi}
              onChange={(e) => setExampleVi(e.target.value)}
              placeholder="Xin hãy mở cửa sổ."
              className="w-full text-sm py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
            />
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center gap-3 pt-1">
          <motion.button
            type="submit"
            whileHover={!headword.trim() || !meaning.trim() ? {} : { scale: 1.01 }}
            whileTap={!headword.trim() || !meaning.trim() ? {} : { scale: 0.97 }}
            disabled={!headword.trim() || !meaning.trim()}
            className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs ${
              isSaved
                ? 'bg-emerald-600 text-white'
                : !headword.trim() || !meaning.trim()
                ? 'bg-[var(--bg-muted)] text-[var(--text-muted)] cursor-not-allowed'
                : 'bg-[var(--bamboo)] hover:bg-[var(--bamboo-hover)] text-white'
            }`}
          >
            {isSaved ? (
              <>
                <Check className="w-4 h-4" />
                <span>Đã lưu vào danh sách!</span>
              </>
            ) : (
              <span>Lưu từ vựng (Dưới 5 giây)</span>
            )}
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            onClick={onNavigateToWords}
            className="py-3 px-3.5 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
          >
            <span>Kho từ</span>
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </div>
      </form>
    </div>
  );
};
