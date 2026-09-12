'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { saveSettings, signOutAction } from '@/lib/actions/settings';
import type { Settings } from '@/lib/db/schema';

export function SettingsScreen({
  settings,
  email,
}: {
  settings: Settings;
  email: string | null;
}) {
  const [newPerDay, setNewPerDay] = useState(settings.newPerDay);
  const [reviewsPerDay, setReviewsPerDay] = useState(settings.reviewsPerDay);
  const [retention, setRetention] = useState(settings.requestRetention);
  const [dark, setDark] = useState(false);
  const [saved, setSaved] = useState(false);
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
    <div className="w-full">
      <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Cài đặt</h1>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Giới hạn mỗi ngày và mục tiêu ghi nhớ sẽ có hiệu lực khi bộ lập lịch hoạt động (giai đoạn
        2).
      </p>

      <section className="mt-5 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <Row label="Từ mới mỗi ngày" hint="Mặc định 12. Hết hạn mức là kết thúc phiên.">
          <input
            type="number"
            min={0}
            max={100}
            value={newPerDay}
            onChange={(e) => setNewPerDay(Number(e.target.value))}
            className="w-20 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] px-2 py-1.5 text-right text-sm"
          />
        </Row>

        <Row label="Lượt ôn mỗi ngày" hint="Mặc định 100.">
          <input
            type="number"
            min={0}
            max={1000}
            value={reviewsPerDay}
            onChange={(e) => setReviewsPerDay(Number(e.target.value))}
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
          {saved && <span className="text-xs text-[var(--bamboo)]">Đã lưu</span>}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await saveSettings({ newPerDay, reviewsPerDay, requestRetention: retention });
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
          <form action={signOutAction}>
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
