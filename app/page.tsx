import { ReviewScreen } from '@/components/ReviewScreen';
import { buildSession } from '@/lib/db/review';

export default async function ReviewPage() {
  return <ReviewScreen session={await buildSession()} />;
}
