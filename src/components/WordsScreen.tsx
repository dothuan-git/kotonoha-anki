import React, { useState, useMemo } from 'react';
import { WordItem } from '../types';
import { playJapaneseAudio } from '../utils/audio';
import { Search, Volume2, ChevronDown, ChevronUp, Edit3, Trash2, Check, X, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WordsScreenProps {
  words: WordItem[];
  onUpdateWord: (updatedWord: WordItem) => void;
  onDeleteWord: (wordId: string) => void;
  onNavigateToAdd: () => void;
}

export const WordsScreen: React.FC<WordsScreenProps> = ({
  words,
  onUpdateWord,
  onDeleteWord,
  onNavigateToAdd,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit form states
  const [editMeaning, setEditMeaning] = useState('');
  const [editExampleJa, setEditExampleJa] = useState('');
  const [editExampleVi, setEditExampleVi] = useState('');

  // Filter and search
  const filteredWords = useMemo(() => {
    return words.filter((item) => {
      const matchesLevel = selectedLevel === 'ALL' || item.level === selectedLevel;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.kanji.toLowerCase().includes(q) ||
        item.reading.toLowerCase().includes(q) ||
        item.meaning.toLowerCase().includes(q) ||
        item.hanViet.toLowerCase().includes(q);

      return matchesLevel && matchesSearch;
    });
  }, [words, searchQuery, selectedLevel]);

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
    } else {
      setExpandedId(id);
      setEditingId(null);
    }
  };

  const startEdit = (word: WordItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(word.id);
    setEditMeaning(word.meaning);
    setEditExampleJa(word.exampleJa);
    setEditExampleVi(word.exampleVi);
  };

  const saveEdit = (word: WordItem, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateWord({
      ...word,
      meaning: editMeaning.trim() || word.meaning,
      exampleJa: editExampleJa.trim() || word.exampleJa,
      exampleVi: editExampleVi.trim() || word.exampleVi,
    });
    setEditingId(null);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  return (
    <div className="w-full py-2 px-1 sm:px-2">
      {/* Search and Filters Bar */}
      <div className="mb-4 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm kiếm theo Kanji, Hiragana, Hán Việt hoặc nghĩa..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--bamboo)] transition-colors shadow-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
            >
              Xoá
            </button>
          )}
        </div>

        {/* Level filter tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {['ALL', 'N5', 'N4', 'N3', 'N2', 'N1'].map((lvl) => (
            <motion.button
              key={lvl}
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setSelectedLevel(lvl)}
              className={`px-3 py-1 rounded-lg font-medium cursor-pointer transition-colors ${
                selectedLevel === lvl
                  ? 'bg-[var(--bamboo)] text-white font-semibold shadow-xs'
                  : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {lvl === 'ALL' ? 'Tất cả' : lvl}
            </motion.button>
          ))}
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">
            {filteredWords.length} từ
          </span>
        </div>
      </div>

      {/* Words List */}
      {filteredWords.length === 0 ? (
        <div className="text-center py-12 px-4 border border-dashed border-[var(--border-strong)] rounded-2xl bg-[var(--bg-surface)]">
          <BookOpen className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Không tìm thấy từ vựng phù hợp
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Thử thay đổi từ khoá tìm kiếm hoặc thêm từ mới vào kho từ.
          </p>
          <button
            type="button"
            onClick={onNavigateToAdd}
            className="mt-4 px-4 py-2 rounded-xl bg-[var(--bamboo)] text-white text-xs font-semibold cursor-pointer hover:bg-[var(--bamboo-hover)]"
          >
            Thêm từ mới ngay
          </button>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-surface)] shadow-xs overflow-hidden">
          {filteredWords.map((word) => {
            const isExpanded = expandedId === word.id;
            const isEditing = editingId === word.id;

            return (
              <div
                key={word.id}
                className="transition-colors hover:bg-[var(--bg-muted)]/30"
              >
                {/* Collapsed Row Header */}
                <div
                  onClick={() => toggleExpand(word.id)}
                  className="p-3.5 sm:p-4 flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-baseline gap-2.5 min-w-0">
                    <span className="font-jp-serif text-lg sm:text-xl font-semibold text-[var(--text-primary)]">
                      {word.kanji}
                    </span>
                    <span className="font-jp-serif text-xs sm:text-sm font-medium text-[var(--bamboo)]">
                      {word.reading}
                    </span>
                    <span className="text-xs sm:text-sm text-[var(--text-secondary)] truncate">
                      {word.meaning}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                    <span className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-md bg-[var(--bg-muted)] text-[var(--text-muted)] font-medium">
                      {word.level}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playJapaneseAudio(word.kanji);
                      }}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--bamboo)] cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
                    )}
                  </div>
                </div>

                {/* Expanded In-Place Details with Animation */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-3.5 sm:px-4 pb-3.5 sm:pb-4 pt-1 border-t border-[var(--border-subtle)] bg-[var(--bg-page)]/40 text-sm space-y-2.5">
                        {isEditing ? (
                          /* Inline Edit Mode */
                          <div className="space-y-2.5 pt-2">
                            <div>
                              <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">
                                Nghĩa tiếng Việt
                              </label>
                              <input
                                type="text"
                                value={editMeaning}
                                onChange={(e) => setEditMeaning(e.target.value)}
                                className="w-full text-sm py-1.5 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">
                                Câu ví dụ
                              </label>
                              <input
                                type="text"
                                value={editExampleJa}
                                onChange={(e) => setEditExampleJa(e.target.value)}
                                className="w-full text-sm font-jp-sans py-1.5 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)] mb-1.5"
                              />
                              <input
                                type="text"
                                value={editExampleVi}
                                onChange={(e) => setEditExampleVi(e.target.value)}
                                className="w-full text-sm py-1.5 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--bamboo)]"
                              />
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={(e) => saveEdit(word, e)}
                                className="px-3 py-1.5 rounded-lg bg-[var(--bamboo)] hover:bg-[var(--bamboo-hover)] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Lưu thay đổi</span>
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] flex items-center gap-1 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Huỷ</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Read-Only Details Mode */
                          <>
                            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] pt-1">
                              <div>
                                <span className="text-[var(--text-muted)]">Hán Việt: </span>
                                <span className="font-semibold text-[var(--text-primary)]">
                                  {word.hanViet}
                                </span>
                              </div>
                              <div>
                                <span className="text-[var(--text-muted)]">Từ loại: </span>
                                <span>{word.partOfSpeech}</span>
                              </div>
                            </div>

                            {/* Example sentence */}
                            <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                              <p className="font-jp-sans text-sm font-medium text-[var(--text-primary)]">
                                {word.exampleJa}
                              </p>
                              <p className="text-xs text-[var(--text-secondary)] mt-1">
                                {word.exampleVi}
                              </p>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-1 text-xs">
                              <div className="text-[var(--text-muted)] text-[11px]">
                                Đã ôn: {word.reviewCount} lần · Chuỗi đúng: {word.correctStreak}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => startEdit(word, e)}
                                  className="px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Sửa</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Bạn chắc chắn muốn xoá từ "${word.kanji}"?`)) {
                                      onDeleteWord(word.id);
                                    }
                                  }}
                                  className="px-2.5 py-1 rounded-lg border border-red-500/20 text-red-600 hover:bg-red-500/10 flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Xoá</span>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
