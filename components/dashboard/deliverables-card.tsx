import { Package, ExternalLink } from "lucide-react";
import type { Deliverable } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DeliverablesCard({ deliverables }: { deliverables: Deliverable[] }) {
  if (deliverables.length === 0) return null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Package className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Deliverables</h2>
      </div>
      <ul className="space-y-3">
        {deliverables.map((d) => (
          <li key={d.id} className="border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-neutral-900">{d.title}</span>
              <span className="shrink-0 text-xs text-neutral-400">{formatDate(d.created_at)}</span>
            </div>
            {d.body && <p className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-600">{d.body}</p>}
            {d.url && (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-neutral-500 underline hover:text-neutral-900"
              >
                View <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
