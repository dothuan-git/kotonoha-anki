import { BulkImportScreen } from '@/components/BulkImportScreen';
import { listImportBatches } from '@/lib/db/imports';

export default async function GrammarBulkImportPage() {
  return <BulkImportScreen kind="grammar" batches={await listImportBatches('grammar')} />;
}
