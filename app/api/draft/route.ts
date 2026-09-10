import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import { draftWord } from '@/lib/draft';

export const runtime = 'nodejs';
export const maxDuration = 30;

const bodySchema = z.object({
  headword: z.string().min(1),
  /** The chosen lookup candidate, if the dictionary had one. */
  candidate: z
    .object({
      headword: z.string(),
      reading: z.string(),
      glosses: z.array(z.string()).default([]),
      pos: z.string().nullable().default(null),
      transitivity: z.enum(['transitive', 'intransitive']).nullable().default(null),
      jlptHint: z.string().nullable().default(null),
      common: z.boolean().default(false),
      headwordRuby: z.string().nullable().default(null),
      kanji: z
        .array(z.object({ char: z.string(), hanViet: z.array(z.string()) }))
        .default([]),
    })
    .nullable()
    .optional(),
});

/**
 * POST /api/draft (§10) — Claude drafts the Vietnamese meaning and an example.
 *
 * Saving must never block on this (§9), so a failure returns 502 with a short
 * message and the client leaves the fields empty and the form usable.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const draft = await draftWord(
      parsed.data.headword,
      // The zod shape above is structurally the lookup candidate; the cast
      // keeps the wire contract validated without duplicating the type.
      (parsed.data.candidate ?? null) as Parameters<typeof draftWord>[1],
    );
    return NextResponse.json(draft);
  } catch (error) {
    console.error('[draft] failed', error);
    return NextResponse.json({ error: 'Drafting unavailable' }, { status: 502 });
  }
}
