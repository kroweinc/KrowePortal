"use client";

/* Builder-side document row for the engagement document list. Same markup as
   the plain read-only row in EngagementDocuments, plus the shared right-click
   menu and a ⋯ kebab overlaid on the right. Only rendered when builder action
   metadata (docKind/token) is present — the operator view stays a plain link. */

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { ContextMenu } from "@/components/ui/context-menu";
import { useDocMenu, type DocKind } from "@/components/doc/doc-menu";
import type { BriefStatus } from "@/lib/types";

export function EngagementDocRow({
  docKind,
  id,
  title,
  status,
  meta,
  href,
  token,
}: {
  docKind: DocKind;
  id: string;
  title: string;
  status: BriefStatus;
  meta: string;
  href: string;
  token: string | null;
}) {
  const { menu, items, dialogs } = useDocMenu({ kind: docKind, id, title, status, token, href });

  return (
    <div className="relative" onContextMenu={menu.openAtEvent}>
      <Link
        href={href}
        className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white py-3 pl-4 pr-12 transition-colors hover:border-neutral-300"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-900">{title}</span>
            <BriefStatusPill status={status} />
          </div>
          <div className="text-xs text-neutral-500">{meta}</div>
        </div>
      </Link>
      <button
        type="button"
        className="ctx-kebab"
        aria-label="Document actions"
        style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)", zIndex: 1 }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          menu.openAtAnchor(e.currentTarget);
        }}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      <ContextMenu state={menu.state} items={items} onClose={menu.close} />
      {dialogs}
    </div>
  );
}
