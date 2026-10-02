import { Badge } from "./ui/badge";
import { statusDetails } from "../display";
export function StatusBadge({ status }: { status?: string }) {
  const [label, kind] = statusDetails(status);
  return (
    <Badge
      variant={
        kind === "failed"
          ? "destructive"
          : kind === "running"
            ? "default"
            : "secondary"
      }
    >
      {label}
    </Badge>
  );
}
