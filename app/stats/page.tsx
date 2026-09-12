import { StatsScreen } from '@/components/StatsScreen';
import { buildStats } from '@/lib/db/stats';

/**
 * /stats. Read on every request rather than cached: the charts are a
 * fold over `review_logs`, and the log grows during the session that is
 * running in the next tab.
 */
export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  return <StatsScreen stats={await buildStats()} />;
}
