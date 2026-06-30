"use client";

/* Client wrapper that adds the right-click menu + a ⋯ kebab to an engagement
   (client) card. The card itself stays a presentational server component and a
   single <Link>; this wrapper owns the relative positioning context and overlays
   the kebab on the card's top-right corner (the card has overflow:hidden, so the
   kebab must live on the wrapper, not inside it). */

import { type ReactNode, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, ExternalLink, ListChecks, Github, Pencil, Trash2 } from "lucide-react";
import { useContextMenu, ContextMenu, type MenuItem } from "@/components/ui/context-menu";
import { renameEngagement, deleteEngagement } from "@/lib/actions/invitations";

export function EngagementCardMenu({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const menu = useContextMenu();

  const items: MenuItem[] = [
    {
      label: "Open",
      icon: <ExternalLink size={15} strokeWidth={1.9} />,
      onSelect: () => router.push(`/b/engagements/${id}`),
    },
    {
      label: "Task board",
      icon: <ListChecks size={15} strokeWidth={1.9} />,
      onSelect: () => router.push(`/b?engagement=${id}`),
    },
    {
      label: "Repo",
      icon: <Github size={15} strokeWidth={1.9} />,
      onSelect: () => router.push(`/b/github?engagement=${id}`),
    },
    {
      label: "Rename",
      icon: <Pencil size={15} strokeWidth={1.9} />,
      separatorBefore: true,
      onSelect: () => {
        const next = window.prompt("Rename client", title)?.trim();
        if (!next || next === title) return;
        startTransition(async () => {
          const r = await renameEngagement(id, next);
          if ("error" in r) toast.error(r.error);
          else {
            toast.success("Renamed");
            router.refresh();
          }
        });
      },
    },
    {
      label: "Delete",
      icon: <Trash2 size={15} strokeWidth={1.9} />,
      destructive: true,
      onSelect: () => {
        if (
          !window.confirm(
            `Delete "${title}"? This permanently removes the client and cannot be undone.`
          )
        )
          return;
        startTransition(async () => {
          const r = await deleteEngagement(id);
          if ("error" in r) toast.error(r.error);
          else {
            toast.success("Client deleted");
            router.refresh();
          }
        });
      },
    },
  ];

  return (
    <div className="ctx-host" onContextMenu={menu.openAtEvent}>
      {children}
      <button
        type="button"
        className="ctx-kebab ctx-kebab--overlay"
        aria-label="Client actions"
        style={{ top: 14, right: 14, transform: "none" }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          menu.openAtAnchor(e.currentTarget);
        }}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      <ContextMenu state={menu.state} items={items} onClose={menu.close} />
    </div>
  );
}
