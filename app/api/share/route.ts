import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { shareQuery } from '@/lib/share';

export const runtime = 'nodejs';

/**
 * POST /api/share — the Web Share Target.
 *
 * Android POSTs here when Kotonoha is picked from a share sheet, then follows
 * the redirect. 303 rather than 302 so the browser turns the POST into a GET
 * of /add; a 302 would re-POST the form to the add page.
 *
 * Nothing is written here. The share only ever pre-fills the box the add form
 * already has — the word is saved when you save it, not because you shared it.
 */
export async function POST(request: Request) {
  const session = await auth();

  let q = '';
  try {
    const form = await request.formData();
    q = shareQuery({
      title: asText(form.get('title')),
      text: asText(form.get('text')),
      url: asText(form.get('url')),
    });
  } catch (error) {
    // A share sheet that sent something unreadable still deserves an open
    // form rather than an error page.
    console.error('[share] unreadable payload', error);
  }

  const target = q ? `/add?q=${encodeURIComponent(q)}` : '/add';
  const to = session?.user?.email
    ? target
    : `/signin?from=${encodeURIComponent(target)}`;

  return NextResponse.redirect(new URL(to, request.url), 303);
}

/** A share target field is a string; a file share is not something we want. */
function asText(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value : null;
}
