import React, { useState } from 'react';
import { KanjiItem, WordItem } from '../types';
import { playJapaneseAudio } from '../utils/audio';
import { Volume2, X, Sparkles, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface KanjiScreenProps {
  kanjiList: KanjiItem[];
  allWords: WordItem[];
  onSelectWordForReview?: (wordId: string) => void;
}

export const KanjiScreen: React.FC<KanjiScreenProps> = ({
  kanjiList,
  allWords,
}) => {
  const [activeKanji, setActiveKanji] = useState<KanjiItem | null>(null);

  // Find all words containing the selected kanji
  const linkedWords = activeKanji
    ? allWords.filter(
        (w) => activeKanji.wordIds.includes(w.id) || w.kanji.includes(activeKanji.character)
      )
    : [];

  return (
    <div className="w-full py-2 px-1 sm:px-2">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Mạng lưới Hán tự & Hán Việt
        </h2>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Âm Hán Việt là sợi chỉ đỏ xâu chuỗi các từ vựng. Chạm vào một Hán tự để khám phá các từ cùng gốc.
        </p>
      </div>

      {/* Kanji Grid with Tap and Hover Animations */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
        {kanjiList.map((item) => {
          const count = allWords.filter(
            (w) => item.wordIds.includes(w.id) || w.kanji.includes(item.character)
          ).length;

          return (
            <motion.div
              key={item.character}
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setActiveKanji(item)}
              className="group p-3 sm:p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--bamboo)] hover:shadow-xs transition-colors cursor-pointer flex flex-col items-center justify-between min-h-[105px] text-center select-none"
            >
              {/* Level indicator */}
              <div className="w-full flex justify-between items-center text-[10px] text-[var(--text-muted)]">
                <span>{item.level}</span>
                <span className="font-semibold text-[var(--bamboo)]">
                  {count} từ
                </span>
              </div>

              {/* Large Kanji Character */}
              <div className="font-jp-serif text-3xl sm:text-4xl font-semibold text-[var(--text-primary)] my-1">
                {item.character}
              </div>

              {/* Prominent Hán Việt reading (The visual anchor!) */}
              <div className="w-full pt-1 border-t border-[var(--border-subtle)]">
                <span className="text-xs font-bold text-[var(--text-primary)] tracking-wider">
                  {item.hanViet}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Kanji Detail Modal / Drawer with Motion */}
      <AnimatePresence>
        {activeKanji && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setActiveKanji(null)}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 8 }}
              transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-3xl p-5 sm:p-6 shadow-xl"
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between pb-4 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[var(--bamboo-subtle)] text-[var(--bamboo)] border border-[var(--bamboo-border)] flex items-center justify-center font-jp-serif text-3xl sm:text-4xl font-semibold">
                    {activeKanji.character}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold tracking-wide text-[var(--text-primary)]">
                        {activeKanji.hanViet}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--bg-muted)] text-[var(--text-muted)]">
                        {activeKanji.level}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Nghĩa Hán: {activeKanji.meaning}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveKanji(null)}
                  className="p-1.5 rounded-full hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Linked Vocabulary Section */}
              <div className="mt-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--bamboo)]" />
                    <span>Các từ vựng đã học chứa chữ này ({linkedWords.length})</span>
                  </span>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {linkedWords.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                      Chưa có từ vựng nào trong kho từ.
                    </p>
                  ) : (
                    linkedWords.map((word) => (
                      <div
                        key={word.id}
                        className="p-3 rounded-xl bg-[var(--bg-page)] border border-[var(--border-subtle)] flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="font-jp-serif text-base font-semibold text-[var(--text-primary)]">
                              {word.kanji}
                            </span>
                            <span className="font-jp-serif text-xs text-[var(--bamboo)] font-medium">
                              {word.reading}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            {word.meaning}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => playJapaneseAudio(word.kanji)}
                          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--bamboo)] cursor-pointer"
                          title="Nghe phát âm"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Close Button */}
              <div className="mt-5 pt-3 border-t border-[var(--border-subtle)]">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setActiveKanji(null)}
                  className="w-full py-2.5 rounded-xl bg-[var(--bamboo)] hover:bg-[var(--bamboo-hover)] text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                >
                  Đóng
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
