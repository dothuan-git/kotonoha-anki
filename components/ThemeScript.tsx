import { MODE_COOKIE, modeFor } from '@/lib/mode';

/**
 * Applies the saved theme before first paint so a dark-mode user never sees a
 * washi-white flash. The prototype toggled a class in an effect, which is fine
 * in a SPA but flashes under SSR.
 *
 * The study mode's palette goes on in the same breath, for the same reason:
 * opening /grammar must not paint bamboo green first and then turn red. The
 * mode comes from `modeFor`, inlined from its own source rather than copied
 * into this string, so the URL rule exists once — `tests/mode.test.ts` checks
 * the inlined copy still runs.
 */
export function ThemeScript() {
  const js =
    `try{var t=localStorage.getItem('kotonoha-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` +
    `try{var m=document.cookie.match(/(?:^|; )${MODE_COOKIE}=([^;]*)/);document.documentElement.dataset.mode=(${modeFor.toString()})(location.pathname,m&&m[1])}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
