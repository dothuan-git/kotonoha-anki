import { ReviewScreen } from '@/components/ReviewScreen';
import { buildSession } from '@/lib/db/review';

/** The grammar review: the same reviewer and scheduler, dealing grammar cards. */
export default async function GrammarReviewPage() {
  return <ReviewScreen session={await buildSession(new Date(), 'grammar')} />;
}
