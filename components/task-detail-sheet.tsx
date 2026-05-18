"use client";

import { useEffect } from "react";
import { X, Paperclip, CheckSquare } from "lucide-react";
import { Ember } from "@/components/design-atoms";
import { InlineText, InlineTextarea, InlineSelect, InlineToggle } from "@/components/inline-edit";
import { updateTask, updateTaskStatus, toggleVisibility } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { TaskAttachments } from "@/components/task-attachments";
import { TaskSubtasks } from "@/components/task-subtasks";
import { DeleteTaskButton } from "@/components/delete-task-button";
import type { Task, Role, TaskStatus } from "@/lib/types";

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const STATUS_OPTIONS = [
  { value: "inbox", label: "Inbox" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Approval" },
  { value: "done", label: "Done" },
];
const STATUS_FULL: Record<string, string> = {
  inbox: "Inbox", in_progress: "In Progress", blocked: "Approval", done: "Done",
};

interface TaskDetailSheetProps {
  task: Task | null;
  role: Role;
  currentUserId: string;
  engagementTitle?: string;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailSheet({ task, role, currentUserId, engagementTitle, onOpenChange }: TaskDetailSheetProps) {
  const requestDone = useRequestDone();

  useEffect(() => {
    if (!task) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onOpenChange(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [task, onOpenChange]);

  if (!task) return null;

  async function saveField(field: string, value: string) {
    if (!task) return;
    const fd = new FormData();
    fd.set("id", task.id);
    fd.set(field, value);
    await updateTask(fd);
  }

  async function saveStatus(value: string) {
    if (!task) return;
    if (value === "done" && task.status !== "done") {
      return new Promise<void>((resolve) => {
        requestDone({ task, onCommit: resolve, onCancel: resolve });
      });
    }
    await updateTaskStatus(task.id, value as TaskStatus);
  }

  const sourceLabel = task.source === "operator_request" ? "operator" : "builder";

  return (
    <>
      <div className="krowe-sheet-backdrop" onClick={() => onOpenChange(false)} />
      <aside className="krowe-sheet" role="dialog" aria-modal="true">
        <div className="krowe-sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="krowe-sheet-title">
              <InlineText
                value={task.title}
                onSave={(v) => saveField("title", v)}
                readOnly={role === "operator"}
                placeholder="Untitled task"
                className="krowe-sheet-title"
              />
            </div>
            <div className="krowe-sheet-sub">
              {engagementTitle ?? "Krowe Portal"} · {STATUS_FULL[task.status]}
            </div>
          </div>
          <button className="krowe-iconbtn" onClick={() => onOpenChange(false)} aria-label="Close">
            <X width={18} height={18} />
          </button>
        </div>

        <div className="krowe-sheet-body">
          <section>
            <div className="krowe-section-label">
              <span className="krowe-section-label-left"><Ember size={10} /> Description</span>
            </div>
            <div className="krowe-desc-block">
              <InlineTextarea
                value={task.description ?? ""}
                onSave={(v) => saveField("description", v)}
                readOnly={role === "operator"}
                placeholder="No description yet — add one to keep your future self in the loop."
              />
            </div>
          </section>

          <section>
            <div className="krowe-section-label">Details</div>
            <dl className="krowe-kv-grid">
              <dt>Source</dt>
              <dd><span className={`krowe-chip krowe-chip-source ${sourceLabel}`}>{sourceLabel} added</span></dd>

              <dt>Priority</dt>
              <dd>
                <InlineSelect
                  label=""
                  value={task.priority}
                  options={PRIORITY_OPTIONS}
                  onSave={(v) => saveField("priority", v)}
                />
              </dd>

              <dt>Status</dt>
              <dd>
                {role === "builder" ? (
                  <InlineSelect label="" value={task.status} options={STATUS_OPTIONS} onSave={saveStatus} />
                ) : (
                  <span className={`krowe-chip krowe-chip-status ${task.status}`}>{STATUS_FULL[task.status]}</span>
                )}
              </dd>

              {role === "builder" && (
                <>
                  <dt>Visibility</dt>
                  <dd>
                    <InlineToggle
                      value={task.operator_visible}
                      onToggle={(v) => toggleVisibility(task.id, v)}
                      trueLabel="Visible to operator"
                      falseLabel="Hidden from operator"
                      trueBadgeVariant="secondary"
                      falseBadgeVariant="outline"
                    />
                  </dd>
                </>
              )}

              <dt>Added</dt>
              <dd style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {new Date(task.created_at).toLocaleDateString()}
              </dd>
            </dl>
          </section>

          <section>
            <div className="krowe-section-label">
              <span className="krowe-section-label-left"><Paperclip size={13} /> Attachments</span>
            </div>
            <TaskAttachments
              key={`att-${task.id}`}
              taskId={task.id}
              role={role}
              currentUserId={currentUserId}
              initial={(task.task_attachments ?? []).filter((a) => !a.is_deliverable)}
              isDeliverable={false}
            />
          </section>

          <section>
            <div className="krowe-section-label">
              <span className="krowe-section-label-left"><CheckSquare size={13} /> Sub-tasks</span>
            </div>
            <TaskSubtasks key={`sub-${task.id}`} taskId={task.id} />
          </section>

          <div style={{ marginTop: 8 }}>
            <DeleteTaskButton
              taskId={task.id}
              taskTitle={task.title}
              variant="full"
              onSuccess={() => onOpenChange(false)}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
