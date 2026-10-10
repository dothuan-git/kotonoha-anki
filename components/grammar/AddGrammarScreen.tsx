'use client';

import { Check, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { GrammarForm } from '@/components/grammar/GrammarForm';
import { createGrammar } from '@/lib/actions/grammar';
import type { GrammarInput } from '@/lib/grammar';

export function AddGrammarScreen() {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** Bumped after a save to remount the form empty. */
  const [formKey, setFormKey] = useState(0);
  const [busy, startTransition] = useTransition();

  function handleSubmit(input: GrammarInput) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await createGrammar(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(result.data.pattern);
      setFormKey((k) => k + 1);
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Thêm mẫu ngữ pháp
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Mỗi thẻ hỏi một câu tiếng Việt dùng mẫu này — bạn dịch sang tiếng Nhật rồi tự chấm.
          </p>
        </div>
        <Link
          href="/grammar/add/bulk"
          className="mt-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
        >
          <Upload className="h-3.5 w-3.5" />
          Nhập hàng loạt
        </Link>
      </div>

      {saved && (
        <p className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-subtle)] px-3 py-2 text-sm text-[var(--brand)]">
          <Check className="h-4 w-4" />
          <span>
            Đã lưu <span className="font-jp-serif font-semibold">{saved}</span>
          </span>
        </p>
      )}

      <GrammarForm
        key={formKey}
        submitLabel="Lưu mẫu ngữ pháp"
        busy={busy}
        error={error}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
