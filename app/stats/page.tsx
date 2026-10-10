import { cookies } from 'next/headers';

import { StatsScreen } from '@/components/StatsScreen';
import { buildStats } from '@/lib/db/stats';
import { MODE_COOKIE } from '@/lib/mode';

/**
 * /stats. Read on every request rather than cached: the charts are a
 * fold over `review_logs`, and the log grows during the session that is
 * running in the next tab.
 *
 * About the study mode you came from — /stats is shared by both, and the mode
 * cookie is what says which one is in front of you — unless `?scope=all`
 * asks for both kinds together.
 */
export const dynamic = 'force-dynamic';

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const [{ scope }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const mode = cookieStore.get(MODE_COOKIE)?.value === 'grammar' ? 'grammar' : 'word';
  return <StatsScreen stats={await buildStats(new Date(), scope === 'all' ? 'all' : mode)} />;
}
