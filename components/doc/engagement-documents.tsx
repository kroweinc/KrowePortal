import Link from "next/link";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import type { BriefStatus } from "@/lib/types";

/* Read-only list of the documents that belong to an engagement. Documents hang
   off the project; an engagement is 1:1 with its project, so these are reached
   live through engagement.project_id — they "follow" the engagement without
   being copied. Presentational only: each caller builds the items (and the link
   target, which differs by audience — builder doc pages vs public token views).
   Row markup matches DocRow on the builder project page so the look is shared. */

export interface EngagementDocItem {
  id: string;
  title: string;
  status: BriefStatus;
  meta: string;
  href: string;
}

export function EngagementDocuments({
  items,
  emptyLabel = "No documents yet.",
}: {
  items: EngagementDocItem[];
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((d) => (
        <Link
          key={d.id}
          href={d.href}
          className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 transition-colors hover:border-neutral-300"
        >
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-2">
              <span className="truncate text-sm font-medium text-neutral-900">{d.title}</span>
              <BriefStatusPill status={d.status} />
            </div>
            <div className="text-xs text-neutral-500">{d.meta}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
