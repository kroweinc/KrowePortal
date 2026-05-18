import { ExternalLink, GitBranch, Paperclip } from "lucide-react";
import type { Task } from "@/lib/types";

export function DeliveryChips({ task }: { task: Pick<Task, "status" | "pushed_to_main" | "completion_note" | "task_attachments"> }) {
  if (task.status !== "done") return null;

  const deliverables = (task.task_attachments ?? []).filter((a) => a.is_deliverable);
  const note = task.completion_note?.trim();
  const isUrl = note ? /^https?:\/\//i.test(note) : false;

  if (!task.pushed_to_main && !note && deliverables.length === 0) return null;

  return (
    <div className="krowe-delivery-row">
      {isUrl && (
        <a
          href={note}
          target="_blank"
          rel="noopener noreferrer"
          className="krowe-chip krowe-chip-delivery-live"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink width={10} height={10} />
          Live
        </a>
      )}
      {task.pushed_to_main && (
        <span className="krowe-chip krowe-chip-delivery-git">
          <GitBranch width={10} height={10} />
          → main
        </span>
      )}
      {deliverables.map((att) => {
        const ext = (att.file_name.split(".").pop() ?? "file").toUpperCase();
        return (
          <span key={att.id} className="krowe-chip krowe-chip-delivery-file">
            <Paperclip width={10} height={10} />
            {ext}
          </span>
        );
      })}
    </div>
  );
}

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="var(--foreground)" />
      <path d="M9 17c2.5-.5 5-2 6.5-4 .5 2.5-.5 5-3 6.5C11 20.5 9.5 19 9 17z" fill="white" opacity="0.95" />
      <path d="M14 13c1.5-1.5 4-2.2 6-2-.4 2.4-2.4 4.4-4.8 5C14 16.4 13.2 14.5 14 13z" fill="white" opacity="0.7" />
      <circle cx="18.5" cy="13.5" r="1.2" fill="var(--primary)" />
    </svg>
  );
}

export function Ember({ size = 14, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, animation: animated ? "breathe 3.6s var(--ease-out-smooth) infinite" : undefined }}
    >
      <circle cx="8" cy="8" r="6"   fill="var(--primary)" opacity="0.18" />
      <circle cx="8" cy="8" r="4"   fill="var(--primary)" opacity="0.4" />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1"   fill="var(--primary-accent)" />
    </svg>
  );
}
