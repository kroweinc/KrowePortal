"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { withdrawTaskApproval } from "@/lib/actions/tasks";
import type { Task, Role } from "@/lib/types";

export function ApprovalPill({
  task,
  role,
  onUnsent,
}: {
  task: Task;
  role: Role;
  onUnsent?: () => void;
}) {
  if (task.approval_approved_at) return <Badge variant="approved">Approved</Badge>;
  if (!task.approval_sent_at) return null;

  // Operators only see the status — the builder who sent it is the one who can
  // pull it back, so only they get the interactive "hover to unsend" pill.
  if (role === "operator") return <Badge variant="needs_approval">Needs Approval</Badge>;

  return <UnsendPill task={task} onUnsent={onUnsent} />;
}

// Reads "Sent" at rest; hover/focus cross-fades it to an "Unsend" affordance
// that withdraws the task from approval. Lives inside cards that open the detail
// sheet on click, so the handler keeps the event to itself.
function UnsendPill({ task, onUnsent }: { task: Task; onUnsent?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function runUnsend() {
    if (pending) return;
    startTransition(async () => {
      const result = await withdrawTaskApproval(task.id);
      if (result && "error" in result) {
        toast.error(result.error || "Couldn't unsend from approval");
        return;
      }
      toast.success("Pulled back from approval");
      onUnsent?.();
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="krowe-approval-pill"
      disabled={pending}
      aria-label="Unsend from approval"
      title="Unsend from approval"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        runUnsend();
      }}
    >
      <span className="sent">Sent</span>
      <span className="unsend">
        <Undo2 width={12} height={12} strokeWidth={2.4} />
        Unsend
      </span>
    </button>
  );
}
