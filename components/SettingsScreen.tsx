'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { saveSettings, signOutAction } from '@/lib/actions/settings';
import { forgetLocalData } from '@/lib/client/forget';
import type { Settings } from '@/lib/db/schema';

export function SettingsScreen({
  settings,
  email,
}: {
  settings: Settings;
  email: string | null;
}) {
  const [cardsPerSession, setCardsPerSession] = useState(settings.cardsPerSession);
  const [practiceWords, setPracticeWords] = useState(settings.practiceWords);
  const [retention, setRetention] = useState(settings.requestRetention);
  const [dark, setDark] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The class is applied pre-paint by ThemeScript; mirror it into state once
  // mounted so the toggle starts in the right position.
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('kotonoha-theme', next ? 'dark' : 'light');
    } catch {
      // Private mode or blocked storage: the toggle still works for this session.
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Cài đặt</h1>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Kích thước phiên áp dụng cho phiên ôn tập kế tiếp. Đổi mục tiêu ghi nhớ sẽ tính lại lịch
        của cả sổ từ — chạy “npm run recompute” sau khi đổi.
      </p>

      <section className="mt-5 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <Row
          label="Số thẻ mỗi phiên"
          hint="Mặc định 50. Mỗi thẻ được hỏi hai lượt, nên 50 thẻ là 100 lượt hiện. Hết phiên là bắt đầu được phiên mới."
        >
          <input
            type="number"
            min={5}
            max={500}
            value={cardsPerSession}
            onChange={(e) => setCardsPerSession(Number(e.target.value))}
            className="w-20 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] px-2 py-1.5 text-right text-sm"
          />
        </Row>

        <Row
          label="Số từ mỗi phiên luyện tập"
          hint="Mặc định 50. Luyện tập không ghi lại kết quả và không đổi lịch ôn."
        >
          <input
            type="number"
            min={5}
            max={500}
            value={practiceWords}
            onChange={(e) => setPracticeWords(Number(e.target.value))}
            className="w-20 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] px-2 py-1.5 text-right text-sm"
          />
        </Row>

        <Row label="Mục tiêu ghi nhớ" hint="Mặc định 0.90. Cao hơn nghĩa là ôn dày hơn.">
          <input
            type="number"
            min={0.7}
            max={0.99}
            step={0.01}
            value={retention}
            onChange={(e) => setRetention(Number(e.target.value))}
            className="w-20 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] px-2 py-1.5 text-right text-sm"
          />
        </Row>

        <div className="flex items-center justify-end gap-3 pt-1">
          {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
          {saved && <span className="text-xs text-[var(--bamboo)]">Đã lưu</span>}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await saveSettings({
                  cardsPerSession,
                  practiceWords,
                  requestRetention: retention,
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              })
            }
            className="rounded-xl bg-[var(--bamboo)] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)] disabled:opacity-60"
          >
            Lưu
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <Row label="Giao diện" hint={dark ? 'Nền than tre tối' : 'Nền giấy washi sáng'}>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Đổi giao diện sáng / tối"
            className="rounded-lg border border-[var(--border-subtle)] p-2 text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </Row>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <Row label="Đăng nhập" hint={email ?? '—'}>
          {/*
            Signing out leaves the service worker holding cached documents for
            an account that is no longer signed in, and IndexedDB holding the
            day's queue. Both are cleared on the way out — see forgetLocalData.
          */}
          <form action={signOutAction} onSubmit={forgetLocalData}>
            <button
              type="submit"
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            >
              Đăng xuất
            </button>
          </form>
        </Row>
      </section>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
