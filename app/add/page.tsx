import { AddWordScreen } from '@/components/AddWordScreen';

/** `?q=` is how /api/share hands a shared word to the form. */
export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <AddWordScreen initialQuery={q ?? ''} />;
}
