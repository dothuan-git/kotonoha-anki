import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import { MAX_CONFUSION_BATCH, recordConfusions } from '@/lib/db/confusions';
import { syncReviews } from '@/lib/db/review';

export const runtime = 'nodejs';

/**
 * How many ratings one POST may carry. A day's caps are 12 + 100, so a device
 * that has been offline for a week still fits comfortably; the bound is here
 * so a corrupt outbox cannot ask the server to replay forever in one request.
 */
const MAX_BATCH = 500;

const batchSchema = z.object({
  reviews: z
    .array(
      z.object({
        id: z.string().uuid(),
        cardId: z.string().uuid(),
        rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        reviewedAt: z.iso.datetime(),
      }),
    )
    .max(MAX_BATCH),
  /**
   * Wrong answers that might name another word, riding along. Optional
   * because an older client build might not send them, and because most
   * batches have none.
   */
  confusions: z
    .array(
      z.object({
        id: z.string().uuid(),
        cardId: z.string().uuid(),
        typed: z.string().max(200),
        observedAt: z.iso.datetime(),
      }),
    )
    .max(MAX_CONFUSION_BATCH)
    .default([]),
});

/**
 * POST /api/sync — the offline log batch.
 *
 * The client posts its outbox and takes what comes back, discarding whatever
 * it scheduled locally. The server wins because it is the only party that
 * folded the card's whole log; the client only ever folded the slice it was
 * handed at session start.
 *
 * Idempotent by construction: `review_logs.id` is generated on the device, so
 * a batch that was applied but whose response never arrived can be POSTed
 * again with no effect beyond a second read.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 });
  }

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid review batch' }, { status: 400 });
  }

  try {
    const result = await syncReviews(parsed.data.reviews);
    // After the reviews, and never instead of them: a confusion is a note
    // about a miss that `review_logs` has already recorded, so it must not be
    // able to fail the thing it annotates. `recordConfusions` swallows its own
    // errors for the same reason.
    await recordConfusions(parsed.data.confusions);
    return NextResponse.json(result);
  } catch (error) {
    // The outbox is durable, so a 5xx costs nothing but a retry. Losing the
    // batch by answering 200 would cost the reviews themselves.
    console.error('[sync] failed', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 503 });
  }
}
