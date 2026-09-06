import React, { useState, useEffect } from 'react';
import { WordItem, KanjiItem, ScreenId, RatingChoice } from './types';
import { INITIAL_WORDS, INITIAL_KANJI } from './data';
import { ReviewScreen } from './components/ReviewScreen';
import { AddWordScreen } from './components/AddWordScreen';
import { WordsScreen } from './components/WordsScreen';
import { KanjiScreen } from './components/KanjiScreen';
import { StatsScreen } from './components/StatsScreen';
import { ModernNavigation } from './components/ModernNavigation';
import { KotonohaLogo } from './components/KotonohaLogo';
import { Moon, Sun, Smartphone, Monitor, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const STORAGE_KEY = 'kotonoha_words_v2';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('review');
  const [viewportMode, setViewportMode] = useState<'mobile' | 'desktop'>('mobile');
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Load words from localStorage or initialize with seed data
  const [words, setWords] = useState<WordItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return INITIAL_WORDS;
  });

  const [kanjiList, setKanjiList] = useState<KanjiItem[]>(INITIAL_KANJI);

  // Undo state
  const [lastRatedWord, setLastRatedWord] = useState<{ id: string; prevItem: WordItem } | null>(null);
  const [undoTimer, setUndoTimer] = useState<number | null>(null);

  // Persist words
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
    } catch (e) {
      console.error(e);
    }
  }, [words]);

  // Dark mode toggle
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Handle rating in Review Screen
  const handleRateWord = (wordId: string, rating: RatingChoice) => {
    const target = words.find((w) => w.id === wordId);
    if (!target) return;

    // Save previous state for undo
    setLastRatedWord({ id: wordId, prevItem: { ...target } });

    // Clear previous timer
    if (undoTimer) clearTimeout(undoTimer);
    const timer = window.setTimeout(() => {
      setLastRatedWord(null);
    }, 10000);
    setUndoTimer(timer);

    setWords((prev) =>
      prev.map((w) => {
        if (w.id === wordId) {
          const isCorrect = rating !== 'Quên';
          return {
            ...w,
            reviewCount: w.reviewCount + 1,
            correctStreak: isCorrect ? w.correctStreak + 1 : 0,
            lastRating: rating,
            nextDueDate: rating === 'Quên' ? 'Hôm nay' : '3 ngày tới',
          };
        }
        return w;
      })
    );
  };

  const handleUndo = () => {
    if (!lastRatedWord) return;
    setWords((prev) =>
      prev.map((w) => (w.id === lastRatedWord.id ? lastRatedWord.prevItem : w))
    );
    setLastRatedWord(null);
    if (undoTimer) clearTimeout(undoTimer);
  };

  const handleAddWord = (newWord: WordItem) => {
    setWords((prev) => [newWord, ...prev]);

    // Check if word contains any known kanji to update relations
    const kanjiChars = newWord.kanji.match(/[\u4e00-\u9faf]/g);
    if (kanjiChars) {
      setKanjiList((prev) =>
        prev.map((k) => {
          if (kanjiChars.includes(k.character) && !k.wordIds.includes(newWord.id)) {
            return { ...k, wordIds: [...k.wordIds, newWord.id] };
          }
          return k;
        })
      );
    }
  };

  const handleUpdateWord = (updatedWord: WordItem) => {
    setWords((prev) => prev.map((w) => (w.id === updatedWord.id ? updatedWord : w)));
  };

  const handleDeleteWord = (wordId: string) => {
    setWords((prev) => prev.filter((w) => w.id !== wordId));
  };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] flex flex-col justify-between transition-colors duration-200">
      {/* Top Header & Viewport Controls */}
      <header className="sticky top-0 z-40 bg-[var(--bg-surface)]/90 backdrop-blur-md border-b border-[var(--border-subtle)] px-4 py-2.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <KotonohaLogo size="md" />
          <span className="hidden sm:inline text-xs text-[var(--text-muted)] border-l border-[var(--border-subtle)] pl-3">
            Sổ tay tiếng Nhật cá nhân · Giấy Washi & Tre non
          </span>
        </div>

        {/* Viewport switch & Dark mode */}
        <div className="flex items-center gap-2">
          {/* Mobile / Desktop switcher */}
          <div className="flex items-center border border-[var(--border-subtle)] rounded-lg p-0.5 bg-[var(--bg-muted)] text-xs">
            <button
              type="button"
              onClick={() => setViewportMode('mobile')}
              className={`p-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                viewportMode === 'mobile'
                  ? 'bg-[var(--bg-surface)] text-[var(--bamboo)] shadow-xs font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              title="Khung điện thoại 390px (Sử dụng 1 tay trên tàu điện)"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">390px</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('desktop')}
              className={`p-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                viewportMode === 'desktop'
                  ? 'bg-[var(--bg-surface)] text-[var(--bamboo)] shadow-xs font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              title="Khung máy tính 1280px"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">1280px</span>
            </button>
          </div>

          {/* Dark / Light toggle */}
          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
            title={isDarkMode ? 'Chuyển sang nền Washi sáng' : 'Chuyển sang nền than tre tối'}
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content Area with generous padding around the viewport */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 md:p-10">
        <div
          className={`w-full transition-all duration-200 ${
            viewportMode === 'mobile'
              ? 'max-w-[420px] p-3 sm:p-4 rounded-[40px] border border-[var(--border-strong)] shadow-md bg-[var(--bg-muted)]/60 my-4 flex flex-col'
              : 'max-w-4xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-3xl p-6 sm:p-10 shadow-sm my-4'
          }`}
        >
          {/* Inner Phone Screen Container with dedicated padding so it doesn't touch screen edges */}
          <div
            className={`w-full flex-1 flex flex-col justify-between ${
              viewportMode === 'mobile'
                ? 'bg-[var(--bg-surface)] rounded-[32px] border border-[var(--border-subtle)] shadow-xs overflow-hidden min-h-[640px] p-3.5 sm:p-4'
                : 'min-h-[600px]'
            }`}
          >
            {/* In-app Brand Bar */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-subtle)]/70 select-none">
              <KotonohaLogo size="sm" showSubtitle={false} />
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] bg-[var(--bg-muted)]/70 px-2 py-0.5 rounded-full border border-[var(--border-subtle)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--bamboo)] inline-block" />
                <span className="font-medium">Sổ từ Washi</span>
              </div>
            </div>

            {/* Active Screen View */}
            <div className="flex-1 flex flex-col justify-between">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentScreen}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="w-full flex-1 flex flex-col justify-between"
                >
                  {currentScreen === 'review' && (
                    <ReviewScreen
                      words={words}
                      onRateWord={handleRateWord}
                      onUndoLastRating={handleUndo}
                      lastRatingUndoable={Boolean(lastRatedWord)}
                    />
                  )}

                  {currentScreen === 'add' && (
                    <AddWordScreen
                      onAddWord={handleAddWord}
                      onNavigateToWords={() => setCurrentScreen('words')}
                    />
                  )}

                  {currentScreen === 'words' && (
                    <WordsScreen
                      words={words}
                      onUpdateWord={handleUpdateWord}
                      onDeleteWord={handleDeleteWord}
                      onNavigateToAdd={() => setCurrentScreen('add')}
                    />
                  )}

                  {currentScreen === 'kanji' && (
                    <KanjiScreen
                      kanjiList={kanjiList}
                      allWords={words}
                    />
                  )}

                  {currentScreen === 'stats' && (
                    <StatsScreen words={words} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Navigation Bar (Nested on mobile screen with proper padding) */}
            {viewportMode === 'mobile' && (
              <div className="mt-4 pt-1">
                <ModernNavigation
                  currentScreen={currentScreen}
                  onSelectScreen={(screen) => setCurrentScreen(screen)}
                  dueCount={words.filter((w) => w.nextDueDate === 'Hôm nay').length}
                />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Persistent Navigation for Desktop Mode */}
      {viewportMode === 'desktop' && (
        <footer className="sticky bottom-0 z-40">
          <ModernNavigation
            currentScreen={currentScreen}
            onSelectScreen={(screen) => setCurrentScreen(screen)}
            dueCount={words.filter((w) => w.nextDueDate === 'Hôm nay').length}
          />
        </footer>
      )}
    </div>
  );
}
