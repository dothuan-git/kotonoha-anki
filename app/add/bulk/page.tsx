import { BulkImportScreen } from '@/components/BulkImportScreen';
import { listImportBatches } from '@/lib/db/imports';

export default async function BulkImportPage() {
  return <BulkImportScreen batches={await listImportBatches()} />;
}
