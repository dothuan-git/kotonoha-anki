import { PhaseGate } from '@/components/PhaseGate';
import { countWords } from '@/lib/db/queries';

export default async function StatsPage() {
  return (
    <PhaseGate
      title="Thống kê chưa mở"
      body="Bốn biểu đồ thuộc giai đoạn 5. Dữ liệu thì đã có: mỗi lượt chấm trong phiên ôn tập ghi một dòng vào review_logs, nên biểu đồ sẽ dựng được từ lịch sử thật chứ không phải số liệu mẫu."
      wordCount={await countWords()}
    />
  );
}
