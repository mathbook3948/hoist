import type { Deployment } from "../../server/src/models";

export const isActive = (value?: Pick<Deployment, "status"> | null) =>
  value?.status === "running";
export const byNewest = <T>(items: T[], key: keyof T) =>
  [...items].sort(
    (a, b) =>
      (Date.parse(String(b[key])) || 0) - (Date.parse(String(a[key])) || 0),
  );
export function formatSize(size: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${index ? size.toFixed(1) : size} ${units[index]}`;
}
export const formatDate = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "시간 정보 없음";
export function statusDetails(status?: string): [string, string] {
  const values: Record<string, [string, string]> = {
    running: ["실행 중", "running"],
    succeeded: ["완료", "success"],
    failed: ["실패", "failed"],
    timed_out: ["시간 초과", "failed"],
    interrupted: ["중단됨", "cancelled"],
    cancelled: ["취소됨", "cancelled"],
  };
  return values[status || ""] || ["배포 대기", "neutral"];
}

export function formatDuration(deployment: Deployment) {
  if (!deployment.finishedAt) return isActive(deployment) ? "진행 중" : "-";
  const seconds = Math.max(
    0,
    Math.round(
      (Date.parse(deployment.finishedAt) - Date.parse(deployment.startedAt)) /
        1000,
    ),
  );
  if (!Number.isFinite(seconds)) return "-";
  return seconds < 60
    ? `${seconds}초`
    : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}
