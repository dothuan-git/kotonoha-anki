import React from 'react';

interface KotonohaLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  className?: string;
}

export const KotonohaLogo: React.FC<KotonohaLogoProps> = ({
  size = 'md',
  showSubtitle = true,
  className = '',
}) => {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* Handcrafted Emblem: Bamboo Leaf + Hanko Seal Stamp */}
      <div className="relative flex items-center justify-center shrink-0">
        {/* Hanko Vermilion / Bamboo Seal Base */}
        <div
          className={`relative rounded-xl flex items-center justify-center transition-transform hover:scale-105 ${
            isSm
              ? 'w-7 h-7 bg-[var(--bamboo-subtle)] border border-[var(--bamboo-border)]'
              : isLg
              ? 'w-11 h-11 bg-[var(--bamboo-subtle)] border-1.5 border-[var(--bamboo-border)] shadow-xs'
              : 'w-8.5 h-8.5 bg-[var(--bamboo-subtle)] border border-[var(--bamboo-border)] shadow-2xs'
          }`}
        >
          {/* Stylized Bamboo Leaf Accent (Top right corner sprig) */}
          <svg
            className={`absolute -top-1.5 -right-1 text-[var(--bamboo)] pointer-events-none drop-shadow-xs ${
              isSm ? 'w-3 h-3' : isLg ? 'w-4.5 h-4.5 -top-2 -right-1.5' : 'w-3.5 h-3.5'
            }`}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Elegant double bamboo leaves */}
            <path
              d="M12 2C12 2 15 7 19 8C23 9 22 13 18 12C14 11 12 7 12 2Z"
              opacity="0.95"
            />
            <path
              d="M11 6C11 6 8 9 5 11C2 13 4 16 7 14C10 12 11 9 11 6Z"
              opacity="0.8"
            />
          </svg>

          {/* Central Seal Kanji: 言 (Koto / Speech) in Classical Mincho */}
          <span
            className={`font-jp-serif font-bold text-[var(--bamboo)] leading-none ${
              isSm ? 'text-xs' : isLg ? 'text-lg' : 'text-sm'
            }`}
          >
            言
          </span>
        </div>
      </div>

      {/* Brand Name Typography */}
      <div className="flex flex-col justify-center leading-none">
        <div className="flex items-baseline gap-1.5">
          {/* Latin Brandname with Refined Serif and Optical Tracking */}
          <span
            className={`font-brand font-bold tracking-[0.14em] text-[var(--text-primary)] ${
              isSm ? 'text-base' : isLg ? 'text-2xl' : 'text-lg'
            }`}
          >
            kotonoha
          </span>

          {/* Japanese Word Companion */}
          <span
            className={`font-jp-serif text-[var(--bamboo)] font-medium tracking-[0.18em] ${
              isSm ? 'text-[10px]' : isLg ? 'text-xs' : 'text-[11px]'
            }`}
          >
            言の葉
          </span>
        </div>

        {showSubtitle && !isSm && (
          <span className="font-serif italic text-[10.5px] text-[var(--text-muted)] tracking-wider mt-0.5">
            leaves of words
          </span>
        )}
      </div>
    </div>
  );
};
