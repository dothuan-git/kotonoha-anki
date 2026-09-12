import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/auth';
import { lookup } from '@/lib/dict/jotoba';

export const runtime = 'nodejs';

/**
 * GET /api/lookup?q=開ける — dictionary passthrough with cache (§10).
 *
 * A dictionary miss or a Jotoba outage returns an empty candidate list with
 * HTTP 200, never an error: §9 requires the add form to stay usable, and a
 * 5xx here would make the client treat a normal "no such word" as a fault.
 */
export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get('q') ?? '';
  if (!q.trim()) {
    return NextResponse.json({ query: '', cached: false, candidates: [] });
  }

  try {
    return NextResponse.json(await lookup(q));
  } catch (error) {
    console.error('[lookup] failed', error);
    return NextResponse.json({
      query: q,
      cached: false,
      candidates: [],
      unavailable: true,
    });
  }
}
