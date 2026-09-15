'use client';

import { Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
  const [newPerDay, setNewPerDay] = useState(settings.newPerDay);
  const [reviewsPerDay, setReviewsPerDay] = useState(settings.reviewsPerDay);
  const [unlimited, setUnlimited] = useState(settings.unlimitedPerDay);
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
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Cài đặt</h1>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Giới hạn mỗi ngày áp dụng cho phiên ôn tập kế tiếp. Đổi mục tiêu ghi nhớ sẽ tính lại lịch
        của cả sổ từ — chạy “npm run recompute” sau khi đổi.
      </p>

      <section className="mt-5 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <Row
          label="Không giới hạn mỗi ngày"
          hint="Học hết mọi thẻ đến hạn hôm nay. Hai hạn mức bên dưới được giữ nguyên để phục hồi khi tắt."
        >
          <Switch checked={unlimited} onChange={setUnlimited} label="Không giới hạn mỗi ngày" />
        </Row>

        {/* Collapsed rather than merely disabled while unlimited: a cap that
            cannot apply is not a setting worth looking at right now, and
            hiding it says so more plainly than greying it out does. */}
        <AnimatePresence initial={false}>
          {!unlimited && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                await saveSettings({
                  newPerDay,
                  reviewsPerDay,
                  requestRetention: retention,
                  unlimitedPerDay: unlimited,
                });
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

/**
 * A pill toggle, not a checkbox — this flips both daily caps at once, so it
 * reads as a mode the settings are in rather than one option among several.
 * `role="switch"` over a styled `<input type="checkbox">` because the thumb's
 * position is the only visual state a checkbox has no box left to draw.
 */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors ${
        checked
          ? 'border-[var(--bamboo)] bg-[var(--bamboo)]'
          : 'border-[var(--border-strong)] bg-[var(--bg-muted)]'
      }`}
    >
      <motion.span
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className="absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-xs"
      />
    </button>
  );
}
