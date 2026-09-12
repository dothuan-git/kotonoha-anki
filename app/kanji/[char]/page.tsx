import { notFound } from 'next/navigation';

import { KanjiDetail } from '@/components/KanjiDetail';
import { getKanjiWithWords } from '@/lib/db/queries';

export default async function KanjiCharPage({
  params,
}: {
  params: Promise<{ char: string }>;
}) {
  const { char } = await params;
  const result = await getKanjiWithWords(decodeURIComponent(char));
  if (!result) notFound();

  return <KanjiDetail kanji={result.kanji} words={result.words} />;
}
