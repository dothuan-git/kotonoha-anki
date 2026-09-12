import type { Metadata, Viewport } from 'next';

import { AppNav } from '@/components/AppNav';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { ThemeScript } from '@/components/ThemeScript';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kotonoha',
  description: 'Sổ tay từ vựng tiếng Nhật cá nhân.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Kotonoha',
  /**
   * The icons are SVG, which Chrome on Android installs from happily. iOS does
   * not: `apple-touch-icon` has to be a PNG, so adding Kotonoha to an iOS home
   * screen gives a screenshot-derived icon until a PNG is dropped into
   * /public/icons and named here. The share target is Chrome-only anyway,
   * so Android is the platform this is actually built for.
   */
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Kotonoha',
    statusBarStyle: 'default',
  },
};

/**
 * Every page is live single-user data behind auth, so nothing is prerendered.
 * Declared here rather than repeated in each page.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Installed, the theme colour is the window chrome, so it follows the theme
  // rather than sitting on one of them.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F3EC' },
    { media: '(prefers-color-scheme: dark)', color: '#131713' },
  ],
  // The nav is fixed to the bottom edge; without this it sits under the home
  // indicator once the app is installed.
  viewportFit: 'cover',
};

const FONTS =
  'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700' +
  '&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500' +
  '&family=Noto+Sans+JP:wght@400;500;600;700' +
  '&family=Noto+Serif+JP:wght@400;500;600;700;900' +
  '&family=Plus+Jakarta+Sans:wght@400;500;600;700' +
  '&family=Shippori+Mincho:wght@400;500;600;700;800&display=swap';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-[var(--bg-page)] text-[var(--text-primary)] antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
          <main className="flex-1 px-4 pb-24 pt-4 sm:px-6">{children}</main>
          <AppNav />
        </div>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
