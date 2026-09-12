'use client';

import { CloudOff, RefreshCw } from 'lucide-react';

/**
 * What the session is doing about the network, in the header strip.
 *
 * Three states worth distinguishing, because they mean different things to
 * someone on a train: offline with nothing waiting (carry on, this is fine),
 * offline with ratings queued (also fine, and here is the count so you can see
 * they are not lost), and actively sending.
 *
 * Nothing here is a warning. Reviewing offline is the feature, not a fault
 * state, so it gets an indicator rather than an alarm.
 */
export function SyncStatus({
  online,
  pending,
  syncing,
}: {
  online: boolean;
  pending: number;
  syncing: boolean;
}) {
  if (online && pending === 0 && !syncing) return null;

  const label = syncing
    ? 'Đang đồng bộ…'
    : pending > 0
      ? `${pending} lượt chờ gửi`
      : 'Ngoại tuyến';

  return (
    <span
      className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]"
      title={
        online
          ? 'Kết quả ôn tập được gửi lên máy chủ khi cửa sổ hoàn tác kết thúc.'
          : 'Không có mạng. Phiên ôn tập vẫn chạy; kết quả được lưu trên máy và gửi đi khi có mạng trở lại.'
      }
    >
      {syncing ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CloudOff className="h-3.5 w-3.5" />
      )}
      <span>{label}</span>
    </span>
  );
}
