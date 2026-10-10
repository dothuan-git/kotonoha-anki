import { GrammarListScreen } from '@/components/grammar/GrammarListScreen';
import { listGrammar } from '@/lib/db/grammar';

export default async function GrammarListPage() {
  return <GrammarListScreen points={await listGrammar()} />;
}
