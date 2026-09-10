import { KanjiScreen } from '@/components/KanjiScreen';
import { listKanjiInUse } from '@/lib/db/queries';

export default async function KanjiPage() {
  return <KanjiScreen kanji={await listKanjiInUse()} />;
}
