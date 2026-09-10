import { PhaseGate } from '@/components/PhaseGate';
import { countWords } from '@/lib/db/queries';

export default async function ReviewPage() {
  return (
    <PhaseGate
      title="Phiên ôn tập chưa mở"
      body="Bộ lập lịch FSRS thuộc giai đoạn 2. Hiện tại hãy tập trung thêm từ — mỗi từ mới đã được tạo sẵn một thẻ nhận biết, nên phiên ôn tập đầu tiên sẽ có đủ dữ liệu ngay khi tính năng này sẵn sàng."
      wordCount={await countWords()}
    />
  );
}
