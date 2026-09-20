import { ReviewScreen } from '@/components/ReviewScreen';
import { buildPracticeSession } from '@/lib/db/practice';

export default async function PracticePage() {
  return <ReviewScreen session={await buildPracticeSession()} mode="practice" />;
}
