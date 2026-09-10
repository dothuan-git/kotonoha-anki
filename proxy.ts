import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

/**
 * Next 16 renamed `middleware` to `proxy`; same execution point.
 *
 * This is a redirect for browsers, not the authorisation boundary — see
 * `requireSession` in lib/auth.ts, which every action and handler calls.
 */
export default auth((req) => {
  if (req.auth) return NextResponse.next();

  const url = new URL('/signin', req.nextUrl.origin);
  if (req.nextUrl.pathname !== '/') {
    url.searchParams.set('from', req.nextUrl.pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(url);
});

export const config = {
  matcher: [
    // Pages only. /api/* is deliberately excluded so route handlers answer
    // 401 JSON via requireSession instead of redirecting a fetch() to HTML.
    '/((?!api/|signin|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)',
  ],
};
