"use client";

/* Client document row for the project document list. Renders the same .docov
   .row markup as before, but adds the shared right-click menu + a ⋯ kebab.
   A transparent stretched link covers the row so the whole card still navigates;
   the kebab sits above it (z-index) so it opens the menu instead of navigating. */

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { ContextMenu } from "@/components/ui/context-menu";
import { useDocMenu, type DocKind } from "@/components/doc/doc-menu";

type DocRowStatus = "draft" | "sent" | "signed" | "accepted" | "rejected";

function Chip({ status }: { status: DocRowStatus }) {
  const tone =
    status === "signed" || status === "accepted"
      ? "signed"
      : status === "sent"
        ? "sent"
        : status === "rejected"
          ? "rejected"
          : "draft";
  const label: Record<DocRowStatus, string> = {
    draft: "Draft",
    sent: "Sent",
    signed: "Signed",
    accepted: "Accepted",
    rejected: "Rejected",
  };
  return (
    <span className={`chip chip-${tone}`}>
      <span className="cd" />
      {label[status]}
    </span>
  );
}

// Renders a " · "-joined doc-summary string as separator dots, styling any
// currency part (e.g. "$45,000") as a mono amount — matching the design.
function renderMeta(meta: string) {
  return meta.split(" · ").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="sep" />}
      {part.startsWith("$") ? <span className="amount">{part}</span> : <span>{part}</span>}
    </Fragment>
  ));
}

export function DocRow({
  docKind,
  id,
  href,
  icon,
  title,
  status,
  meta,
  token,
}: {
  docKind: DocKind;
  id: string;
  href: string;
  icon: ReactNode;
  title: string;
  status: DocRowStatus;
  meta: string;
  token: string | null;
}) {
  const { menu, items, dialogs } = useDocMenu({ kind: docKind, id, title, status, token, href });

  return (
    <div className="row ctx-host" onContextMenu={menu.openAtEvent}>
      {/* Transparent full-row link — keeps the whole card clickable without
          nesting the kebab <button> inside an <a>. */}
      <Link
        href={href}
        aria-label={title}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />
      <span className="row-ico">{icon}</span>
      <div className="row-main">
        <div className="row-titleline">
          <span className="row-name">{title}</span>
          <Chip status={status} />
        </div>
        <div className="row-sub">{renderMeta(meta)}</div>
      </div>
      <button
        type="button"
        className="ctx-kebab"
        aria-label="Document actions"
        style={{ position: "relative", zIndex: 1 }}
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
