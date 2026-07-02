"use client";

/* Shared right-click menu for task cards.

   useTaskMenu(args) returns the menu state + the MenuItem[] for that task,
   mirroring useDocMenu. Status moves reuse the exact flows the board's
   drag-and-drop goes through: "Done" opens the done deliverable dialog and
   "Send for approval" opens the approval dialog (requestDone /
   requestApproval, passed in by the caller — the operator list renders no
   builder flows so it simply doesn't pass them); plain moves call
   updateTaskStatus directly.

   The delete confirmation uses the branded useConfirm modal; the caller
   mounts the returned `dialogs` alongside the <ContextMenu>. */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PanelRight,
  Link2,
  Inbox,
  ListTodo,
  Play,
  Hourglass,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { useContextMenu, type MenuItem } from "@/components/ui/context-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { updateTaskStatus, deleteTask } from "@/lib/actions/tasks";
import type { Task, Role, TaskStatus } from "@/lib/types";

const STATUS_MOVES: { status: TaskStatus; label: string; icon: typeof Inbox }[] = [
  { status: "backlog",     label: "Move to Backlog",     icon: Inbox },
  { status: "todo",        label: "Move to To-Do",       icon: ListTodo },
  { status: "in_progress", label: "Move to In Progress", icon: Play },
  { status: "done",        label: "Move to Done",        icon: CheckCircle2 },
];

interface TaskMenuArgs {
  task: Task;
  role: Role;
  /** Open the task in the detail sheet; falls back to navigating to the task page. */
  onOpen?: () => void;
  /** Builder deliverable dialogs — pass from useRequestDone/useRequestApproval
      where those providers are mounted. Status moves are hidden without them. */
  requestDone?: (args: { task: Task }) => void;
  requestApproval?: (args: { task: Task }) => void;
  /** Override for the Delete item (e.g. to reuse a shared confirm dialog);
      defaults to the hook's own confirm + deleteTask flow. */
  onDelete?: () => void | Promise<void>;
}

function isErr(r: unknown): r is { error: string } {
  return !!r && typeof r === "object" && "error" in r && !!(r as { error?: string }).error;
}

export function useTaskMenu({ task, role, onOpen, requestDone, requestApproval, onDelete }: TaskMenuArgs) {
  const router = useRouter();
  const menu = useContextMenu();
  const [confirm, confirmDialog] = useConfirm();

  const href = `/${role === "operator" ? "o" : "b"}/tasks/${task.id}`;

  const items = useMemo<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        label: "Open task",
        icon: <PanelRight size={15} strokeWidth={1.9} />,
        onSelect: () => (onOpen ? onOpen() : router.push(href)),
      },
      {
        label: "Copy link",
        icon: <Link2 size={15} strokeWidth={1.9} />,
        onSelect: async () => {
          const url = `${window.location.origin}${href}`;
          try {
            await navigator.clipboard.writeText(url);
            toast.success("Task link copied");
          } catch {
            toast.message("Copy this link", { description: url });
          }
        },
      },
    ];

    // Status moves are a builder interaction (operators have no drag/advance),
    // and the done/approval flows need their deliverable dialogs available.
    if (role === "builder" && requestDone && requestApproval) {
      STATUS_MOVES.forEach(({ status, label, icon: Icon }, i) => {
        list.push({
          label,
          icon: <Icon size={15} strokeWidth={1.9} />,
          separatorBefore: i === 0,
          disabled: task.status === status,
          disabledReason: "Task is already here",
          onSelect: async () => {
            if (status === "done") {
              requestDone({ task });
            } else {
              const r = await updateTaskStatus(task.id, status);
              if (isErr(r)) toast.error(r.error);
            }
          },
        });
      });

      // Approval is a gate, not a column — the task keeps its status and the
      // approval_sent_at stamp pins it to the top of its column with a pill.
      list.push({
        label: "Send for approval",
        icon: <Hourglass size={15} strokeWidth={1.9} />,
        separatorBefore: true,
        disabled: !!task.approval_sent_at,
        disabledReason: "Already sent for approval",
        onSelect: () => requestApproval({ task }),
      });
    }

    list.push({
      label: "Delete",
      icon: <Trash2 size={15} strokeWidth={1.9} />,
      destructive: true,
      separatorBefore: true,
      onSelect: async () => {
        if (onDelete) {
          await onDelete();
          return;
        }
        if (
          !(await confirm({
            title: `Delete “${task.title}”?`,
            description: "This permanently removes the task. This can’t be undone.",
            confirmText: "Delete task",
            cancelText: "Cancel",
            icon: Trash2,
            tone: "danger",
          }))
        )
          return;
        const r = await deleteTask(task.id).catch(() => ({ error: "Couldn't delete the task. Please try again." }));
        if (isErr(r)) toast.error(r.error);
      },
    });

    return list;
    // task is the only data input; router/confirm/onOpen/request* are stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.title, task.status, task.approval_sent_at, role, href]);

  return { menu, items, dialogs: confirmDialog };
}
