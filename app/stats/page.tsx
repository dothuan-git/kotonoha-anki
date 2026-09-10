import { PhaseGate } from '@/components/PhaseGate';
import { countWords } from '@/lib/db/queries';

export default async function StatsPage() {
  return (
    <PhaseGate
      title="Thống kê chưa có dữ liệu"
      body="Bốn biểu đồ được tính từ bảng review_logs, và bảng đó chỉ có dữ liệu sau phiên ôn tập đầu tiên. Không có số liệu nào được dựng sẵn ở đây."
      wordCount={await countWords()}
    />
  );
}
