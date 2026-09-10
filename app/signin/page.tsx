import { KotonohaLogo } from '@/components/KotonohaLogo';
import { signIn } from '@/lib/auth';

/**
 * §1: no registration. One Google account is allowlisted by ALLOWED_EMAIL and
 * the signIn callback refuses everything else, so this page is a single button.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <KotonohaLogo size="md" />

      <p className="mt-6 max-w-xs text-sm text-[var(--text-muted)]">
        Sổ tay từ vựng riêng. Chỉ một tài khoản được phép truy cập.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-[var(--danger)]">
          Tài khoản này không có quyền truy cập.
        </p>
      )}

      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: from ?? '/' });
        }}
      >
        <button
          type="submit"
          className="mt-7 rounded-xl bg-[var(--bamboo)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--bamboo-hover)]"
        >
          Đăng nhập bằng Google
        </button>
      </form>
    </div>
  );
}
