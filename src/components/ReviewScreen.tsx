import React, { useState, useEffect, useCallback } from 'react';
import { WordItem, RatingChoice } from '../types';
import { playJapaneseAudio } from '../utils/audio';
import { Volume2, RotateCcw, Sparkles, CheckCircle2, Keyboard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ReviewScreenProps {
  words: WordItem[];
  onRateWord: (wordId: string, rating: RatingChoice) => void;
  onUndoLastRating: () => void;
  lastRatingUndoable: boolean;
}

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  words,
  onRateWord,
  onUndoLastRating,
  lastRatingUndoable,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [testMode, setTestMode] = useState<'card' | 'type'>('card');
  const [typeInput, setTypeInput] = useState('');
  const [typeStatus, setTypeStatus] = useState<'neutral' | 'correct' | 'wrong'>('neutral');
  const [sessionFinished, setSessionFinished] = useState(false);
  const [fontStyle, setFontStyle] = useState<'mincho' | 'gothic'>('mincho');

  const currentWord: WordItem | undefined = words[currentIndex];

  // Reset card state when index changes
  useEffect(() => {
    setIsRevealed(false);
    setTypeInput('');
    setTypeStatus('neutral');
  }, [currentIndex]);

  const handleReveal = useCallback(() => {
    setIsRevealed(true);
    if (currentWord) {
      playJapaneseAudio(currentWord.kanji);
    }
  }, [currentWord]);

  const handleRate = useCallback(
    (choice: RatingChoice) => {
      if (!currentWord) return;
      onRateWord(currentWord.id, choice);

      if (currentIndex + 1 >= words.length) {
        setSessionFinished(true);
      } else {
        setCurrentIndex((prev) => prev + 1);
      }
    },
    [currentWord, currentIndex, words.length, onRateWord]
  );

  // Keyboard shortcut support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Enter' && testMode === 'type' && !isRevealed) {
          handleReveal();
        }
        return;
      }

      if (e.code === 'Space' && !isRevealed) {
        e.preventDefault();
        handleReveal();
      } else if (isRevealed) {
        if (e.key === '1') handleRate('Quên');
        if (e.key === '2') handleRate('Khó');
        if (e.key === '3') handleRate('Được');
        if (e.key === '4') handleRate('Dễ');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRevealed, testMode, handleReveal, handleRate]);

  // Handle typing input
  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setTypeInput(e.target.value);

    if (!currentWord || !val) {
      setTypeStatus('neutral');
      return;
    }

    if (val === currentWord.reading || val.toLowerCase() === currentWord.meaning.toLowerCase()) {
      setTypeStatus('correct');
      setIsRevealed(true);
    } else if (val.length >= currentWord.reading.length + 1) {
      setTypeStatus('wrong');
    } else {
      setTypeStatus('neutral');
    }
  };

  // State: No words due or Session Completed
  if (sessionFinished || words.length === 0) {
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
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          Phiên ôn tập đã hoàn thành
        </h2>
        <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed max-w-sm mx-auto">
          Bạn đã ôn tập xong các từ vựng đến hạn hôm nay. Hãy nghỉ ngơi hoặc tiếp tục mở rộng thư viện từ mới.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setCurrentIndex(0);
              setSessionFinished(false);
            }}
            className="px-5 py-2.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-page)] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-2 shadow-xs"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Ôn tập lại từ đầu</span>
          </motion.button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="w-full flex flex-col justify-between min-h-[580px] p-2">
      {/* Top Session Progress Bar & Controls */}
      <div className="w-full flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
        {/* Progress pill */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--text-primary)]">
            {currentIndex + 1} / {words.length}
          </span>
          <div className="w-24 h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--bamboo)] rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Mode Toggle & Audio button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTestMode(testMode === 'card' ? 'type' : 'card')}
            className={`px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
              testMode === 'type'
                ? 'bg-[var(--bamboo-subtle)] border-[var(--bamboo-border)] text-[var(--bamboo)] font-semibold'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>{testMode === 'type' ? 'Chế độ gõ' : 'Thẻ lật'}</span>
          </button>

          <button
            type="button"
            onClick={() => playJapaneseAudio(currentWord.kanji)}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--bamboo)] cursor-pointer transition-colors"
            title="Nghe phát âm"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Undo Toast Notification */}
      <AnimatePresence>
        {lastRatingUndoable && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full mt-2 py-2 px-3 rounded-lg bg-[var(--bamboo-subtle)]/70 border border-[var(--bamboo-border)]/50 flex items-center justify-between text-xs text-[var(--text-secondary)] overflow-hidden"
          >
            <span>Đã lưu kết quả trước đó</span>
            <button
              type="button"
              onClick={onUndoLastRating}
              className="text-[var(--bamboo)] font-semibold hover:underline cursor-pointer flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Hoàn tác (10s)</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Flashcard with Page-turn / Card Slide Animation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentWord ? currentWord.id : currentIndex}
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={!isRevealed && testMode === 'card' ? handleReveal : undefined}
          className={`w-full mt-3 flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 sm:p-7 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-colors ${
            !isRevealed && testMode === 'card' ? 'cursor-pointer hover:border-[var(--bamboo)]/50' : ''
          }`}
        >
          {/* Card Header Tags */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="px-2.5 py-0.5 rounded-md bg-[var(--bamboo-subtle)] border border-[var(--bamboo-border)]/50 text-[var(--bamboo)] text-xs font-semibold">
                {currentWord.level}
              </span>
              <span className="text-xs text-[var(--text-muted)] font-medium">
                {currentWord.partOfSpeech}
              </span>
            </div>

            {/* Dedicated Japanese Font Toggle (Mincho Serif vs Gothic Sans) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFontStyle(fontStyle === 'mincho' ? 'gothic' : 'mincho');
              }}
              className="px-2 py-0.5 rounded-md text-[11px] font-medium border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 hover:bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1 transition-colors"
              title="Đổi phông chữ tiếng Nhật (Mincho Serif / Gothic Sans)"
            >
              <span className={fontStyle === 'mincho' ? 'font-jp-serif font-bold text-[var(--bamboo)]' : 'font-jp-sans'}>
                {fontStyle === 'mincho' ? '明朝 (Serif)' : 'ゴシック (Sans)'}
              </span>
            </button>
          </div>

          {/* Center: Large Kanji Headword */}
          <div className="py-6 text-center">
            <h1
              className={`text-5xl sm:text-6xl text-[var(--text-primary)] select-all transition-all ${
                fontStyle === 'mincho'
                  ? 'font-jp-serif font-medium sm:font-semibold tracking-wide'
                  : 'font-jp-sans font-bold tracking-tight'
              }`}
            >
              {currentWord.kanji}
            </h1>

            {/* Hán Việt reading tag */}
            {currentWord.hanViet && currentWord.hanViet !== '—' && (
              <div className="mt-3">
                <span className="inline-block px-3 py-1 rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)] text-xs font-semibold tracking-wide border border-[var(--border-subtle)]">
                  Hán Việt: {currentWord.hanViet}
                </span>
              </div>
            )}

            {/* Typing test input */}
            {testMode === 'type' && !isRevealed && (
              <div className="mt-5 max-w-xs mx-auto">
                <input
                  type="text"
                  value={typeInput}
                  onChange={handleTypeChange}
                  placeholder="Gõ cách đọc hiragana..."
                  autoFocus
                  className={`w-full px-4 py-2.5 text-center text-sm rounded-xl border bg-[var(--bg-page)] text-[var(--text-primary)] outline-none transition-colors ${
                    typeStatus === 'correct'
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                      : typeStatus === 'wrong'
                      ? 'border-red-500 ring-2 ring-red-500/20'
                      : 'border-[var(--border-strong)] focus:border-[var(--bamboo)]'
                  }`}
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                  Nhấn Enter hoặc gõ đúng để kiểm tra
                </p>
              </div>
            )}

            {/* Click to reveal prompt */}
            {!isRevealed && testMode === 'card' && (
              <div className="mt-8 text-xs text-[var(--text-muted)] flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--bamboo)]" />
                <span>Chạm hoặc bấm Phím cách để xem đáp án</span>
              </div>
            )}
          </div>

          {/* Revealed Content: Meaning, Furigana & Example Sentence (Sans font for example) */}
          <AnimatePresence>
            {isRevealed && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: 6 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: 6 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="border-t border-[var(--border-subtle)] pt-5 space-y-3.5 overflow-hidden"
              >
                {/* Reading + Sound */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] block font-medium">Cách đọc</span>
                    <span className="font-jp-serif text-xl sm:text-2xl font-semibold text-[var(--bamboo)] tracking-wide">
                      {currentWord.reading}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playJapaneseAudio(currentWord.reading);
                    }}
                    className="p-2 rounded-xl bg-[var(--bg-muted)] hover:bg-[var(--bamboo-subtle)] hover:text-[var(--bamboo)] text-[var(--text-secondary)] cursor-pointer transition-colors"
                    title="Nghe cách đọc"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Vietnamese Meaning */}
                <div>
                  <span className="text-[11px] text-[var(--text-muted)] block font-medium">Nghĩa tiếng Việt</span>
                  <p className="text-base font-semibold text-[var(--text-primary)] mt-0.5 leading-snug">
                    {currentWord.meaning}
                  </p>
                </div>

                {/* Example Sentence with Furigana (using font-jp-sans) */}
                <div className="p-3 rounded-xl bg-[var(--bg-muted)]/70 border border-[var(--border-subtle)]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-jp-sans text-sm sm:text-base font-medium text-[var(--text-primary)] leading-relaxed">
                        {currentWord.exampleRuby ? (
                          currentWord.exampleRuby.map((seg, i) => (
                            <React.Fragment key={i}>
                              {seg.ruby ? (
                                <ruby className="px-0.5">
                                  {seg.text}
                                  <rt>{seg.ruby}</rt>
                                </ruby>
                              ) : (
                                seg.text
                              )}
                            </React.Fragment>
                          ))
                        ) : (
                          currentWord.exampleJa
                        )}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        {currentWord.exampleVi}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playJapaneseAudio(currentWord.exampleJa);
                      }}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--bamboo)] shrink-0 cursor-pointer"
                      title="Nghe câu ví dụ"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* Bottom Rating Controls with Spring Press Animations */}
      <div className="mt-3 pt-1">
        {isRevealed ? (
          <div className="grid grid-cols-4 gap-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRate('Quên')}
              className="py-2.5 px-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400 font-semibold text-xs sm:text-sm hover:bg-red-500/20 transition-colors cursor-pointer flex flex-col items-center"
            >
              <span>Quên</span>
              <span className="text-[10px] opacity-70 font-normal mt-0.5">Phím 1</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRate('Khó')}
              className="py-2.5 px-2 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold text-xs sm:text-sm hover:bg-amber-500/20 transition-colors cursor-pointer flex flex-col items-center"
            >
              <span>Khó</span>
              <span className="text-[10px] opacity-70 font-normal mt-0.5">Phím 2</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRate('Được')}
              className="py-2.5 px-2 rounded-xl border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)] text-[var(--bamboo)] font-semibold text-xs sm:text-sm hover:opacity-90 transition-colors cursor-pointer flex flex-col items-center"
            >
              <span>Được</span>
              <span className="text-[10px] opacity-70 font-normal mt-0.5">Phím 3</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRate('Dễ')}
              className="py-2.5 px-2 rounded-xl bg-[var(--bamboo)] text-white font-semibold text-xs sm:text-sm hover:opacity-90 transition-colors cursor-pointer flex flex-col items-center shadow-xs"
            >
              <span>Dễ</span>
              <span className="text-[10px] opacity-80 font-normal mt-0.5">Phím 4</span>
            </motion.button>
          </div>
        ) : (
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleReveal}
            className="w-full py-3.5 rounded-xl bg-[var(--bamboo)] hover:bg-[var(--bamboo-hover)] text-white text-sm font-semibold tracking-wide transition-colors cursor-pointer shadow-xs"
          >
            Hiện đáp án (Phím cách)
          </motion.button>
        )}
      </div>
    </div>
  );
};
