import Link from 'next/link';

/**
 * Phase 1 ships capture only. Review and Stats are honest about having no data
 * rather than showing invented numbers: both are projections over review_logs,
 * which stays empty until Phase 2 lands FSRS.
 */
export function PhaseGate({
  title,
  body,
  wordCount,
}: {
  title: string;
  body: string;
  wordCount: number;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--bamboo-border)] bg-[var(--bamboo-subtle)]">
        <span className="font-jp-serif text-2xl text-[var(--bamboo)]">未</span>
      </div>

      <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
        {body}
      </p>

      <p className="mt-5 text-xs text-[var(--text-secondary)]">
        {wordCount === 0
          ? 'Sổ từ còn trống.'
          : `Đã có ${wordCount} từ trong sổ, sẵn sàng cho phiên ôn tập đầu tiên.`}
      </p>

      <Link
        href="/add"
        className="mt-6 rounded-xl bg-[var(--bamboo)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
      >
        Thêm từ vựng
      </Link>
    </div>
  );
}
