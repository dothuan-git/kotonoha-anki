import type { Viewport } from 'next';

/**
 * The installed app's window chrome follows the palette: momiji washi and
 * yoru-momiji charcoal here, as the root layout gives bamboo everywhere else.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F2EB' },
    { media: '(prefers-color-scheme: dark)', color: '#171312' },
  ],
};

export default function GrammarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
