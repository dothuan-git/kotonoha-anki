import React from 'react';
import { ScreenId } from '../types';
import { Layers, PlusCircle, BookMarked, Grid, BarChart2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ModernNavigationProps {
  currentScreen: ScreenId;
  onSelectScreen: (screen: ScreenId) => void;
  dueCount?: number;
}

export const ModernNavigation: React.FC<ModernNavigationProps> = ({
  currentScreen,
  onSelectScreen,
  dueCount = 0,
}) => {
  const tabs: { id: ScreenId; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'review', label: 'Ôn tập', icon: Layers },
    { id: 'add', label: 'Thêm từ', icon: PlusCircle },
    { id: 'words', label: 'Kho từ', icon: BookMarked },
    { id: 'kanji', label: 'Hán tự', icon: Grid },
    { id: 'stats', label: 'Thống kê', icon: BarChart2 },
  ];

  return (
    <nav className="w-full bg-[var(--bg-surface)]/90 backdrop-blur-md border-t border-[var(--border-subtle)] px-2 py-1.5 sm:py-2">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentScreen === tab.id;

          return (
            <motion.button
              key={tab.id}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => onSelectScreen(tab.id)}
              className={`relative flex flex-col items-center py-1.5 px-3 rounded-xl transition-colors cursor-pointer select-none ${
                isActive
                  ? 'text-[var(--bamboo)] font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {/* Active Tab Spring Indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute inset-0 bg-[var(--bamboo-subtle)] border border-[var(--bamboo-border)]/60 rounded-xl -z-10 shadow-2xs"
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                />
              )}

              <div className="relative z-10">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'stroke-[2.5] scale-105' : 'stroke-[1.75]'}`} />
                {tab.id === 'review' && dueCount > 0 && (
                  <span className="absolute -top-1 -right-2 px-1 min-w-[14px] h-[14px] rounded-full bg-[var(--bamboo)] text-white text-[9px] font-bold flex items-center justify-center leading-none shadow-xs">
                    {dueCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-1 tracking-tight z-10">{tab.label}</span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
};
