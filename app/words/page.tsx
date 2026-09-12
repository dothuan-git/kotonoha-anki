import { WordsScreen } from '@/components/WordsScreen';
import { listWords } from '@/lib/db/queries';

export default async function WordsPage() {
  return <WordsScreen words={await listWords()} />;
}
