import { Badge } from "@/components/ui/badge";
import type { Task, Role } from "@/lib/types";

export function ApprovalPill({ task, role }: { task: Task; role: Role }) {
  if (task.approval_approved_at) return <Badge variant="approved">Approved</Badge>;
  if (task.approval_sent_at) {
    return role === "operator"
      ? <Badge variant="needs_approval">Needs Approval</Badge>
      : <Badge variant="sent">Sent</Badge>;
  }
  return null;
}
