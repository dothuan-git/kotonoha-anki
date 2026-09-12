/**
 * Applies the saved theme before first paint so a dark-mode user never sees a
 * washi-white flash. The prototype toggled a class in an effect, which is fine
 * in a SPA but flashes under SSR.
 */
export function ThemeScript() {
  const js = `try{var t=localStorage.getItem('kotonoha-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
