'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

import { KotonohaLogo } from '@/components/KotonohaLogo';
import { useTheme } from '@/lib/client/theme';

/**
 * The prototype's top header, minus its viewport switcher.
 *
 * That switcher was scaffolding — it framed the design at 390px and 1280px
 * inside a desktop page — and the real app is simply the thing it was
 * framing, so what carries over is the logo, the tagline and the theme
 * toggle. The toggle stays in /settings too: this is the one you reach for
 * mid-session, that one is where you go looking for it.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();

  // Sign-in renders its own centred logo; a header above it would be two.
  if (pathname === '/signin') return null;

  return (
    <header className="z-40 flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-4 py-2.5 shadow-xs backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" aria-label="Kotonoha — về trang ôn tập">
          <KotonohaLogo size="md" showSubtitle={false} />
        </Link>
        <span className="hidden truncate border-l border-[var(--border-subtle)] pl-3 text-xs text-[var(--text-muted)] sm:inline">
          Sổ tay tiếng Nhật cá nhân · Giấy Washi &amp; Tre non
        </span>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label="Đổi giao diện sáng / tối"
        title={dark ? 'Chuyển sang nền Washi sáng' : 'Chuyển sang nền than tre tối'}
        className="shrink-0 rounded-lg border border-[var(--border-subtle)] p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  );
}
