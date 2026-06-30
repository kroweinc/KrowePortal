"use client";

/* Shared right-click menu for PRD / quote / contract rows.

   useDocMenu(doc) returns the menu state + the MenuItem[] for that doc, wiring
   each item to its existing server action. Reused by both doc surfaces (the
   project document list and the engagement document list) so they behave
   identically. Builder-only — only mounted where builder actions are allowed. */

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Copy, Link2, Download, Trash2 } from "lucide-react";
import { useContextMenu, type MenuItem } from "@/components/ui/context-menu";
import { deletePrd, updatePrdContent, sendPrd } from "@/lib/actions/prds";
import { deleteQuote, updateQuoteContent, sendQuote } from "@/lib/actions/quote-docs";
import { deleteContract, updateContractContent, sendContract } from "@/lib/actions/contracts";
import { duplicatePrd, duplicateQuote, duplicateContract } from "@/lib/actions/duplicate-docs";

export type DocKind = "prd" | "quote" | "contract";

export interface DocRef {
  kind: DocKind;
  id: string;
  title: string;
  status: string;
  token: string | null;
  /** Builder doc page — also the "Download PDF" navigation target. */
  href: string;
}

interface KindHandlers {
  del: (id: string) => Promise<{ success: true } | { error: string }>;
  rename: (id: string, title: string) => Promise<{ success: true } | { error: string }>;
  publish: (
    id: string
  ) => Promise<{ success: true } | { success: true; effectiveDate: string } | { error: string }>;
  dup: (id: string) => Promise<{ id: string } | { error: string }>;
  /** Public share path segment: /{path}/{token}. */
  path: string;
  /** Whether a doc of this kind may be deleted while in `status`. PRDs can be
   *  removed even after they're sent; quotes/contracts stay draft-only so a
   *  client-accepted quote or signed contract can't be silently destroyed. */
  canDelete: (status: string) => boolean;
}

const KIND: Record<DocKind, KindHandlers> = {
  prd: {
    del: deletePrd,
    rename: (id, t) => updatePrdContent(id, { title: t }),
    publish: sendPrd,
    dup: duplicatePrd,
    path: "prd",
    canDelete: () => true,
  },
  quote: {
    del: deleteQuote,
    rename: (id, t) => updateQuoteContent(id, { title: t }),
    publish: sendQuote,
    dup: duplicateQuote,
    path: "quotes",
    canDelete: (s) => s === "draft",
  },
  contract: {
    del: deleteContract,
    rename: (id, t) => updateContractContent(id, { title: t }),
    publish: (id) => sendContract(id),
    dup: duplicateContract,
    path: "contract",
    canDelete: (s) => s === "draft",
  },
};

function isErr(r: unknown): r is { error: string } {
  return !!r && typeof r === "object" && "error" in r && !!(r as { error?: string }).error;
}

export function useDocMenu(doc: DocRef) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const menu = useContextMenu();

  const items = useMemo<MenuItem[]>(() => {
    const k = KIND[doc.kind];
    const isDraft = doc.status === "draft";
    // Renaming a signed contract is rejected server-side — disable it up front.
    const renameLocked = doc.kind === "contract" && doc.status === "signed";

    return [
      {
        label: "Rename",
        icon: <Pencil size={15} strokeWidth={1.9} />,
        disabled: renameLocked,
        disabledReason: "Signed contracts can't be renamed",
        onSelect: () => {
          const next = window.prompt("Rename document", doc.title)?.trim();
          if (!next || next === doc.title) return;
          startTransition(async () => {
            const r = await k.rename(doc.id, next);
            if (isErr(r)) toast.error(r.error);
            else {
              toast.success("Renamed");
              router.refresh();
            }
          });
        },
      },
      {
        label: "Duplicate",
        icon: <Copy size={15} strokeWidth={1.9} />,
        onSelect: () =>
          startTransition(async () => {
            const r = await k.dup(doc.id);
            if (isErr(r)) toast.error(r.error);
            else {
              toast.success("Duplicated");
              router.refresh();
            }
          }),
      },
      {
        label: "Copy share link",
        icon: <Link2 size={15} strokeWidth={1.9} />,
        onSelect: () => {
          if (
            isDraft &&
            !window.confirm("Sharing a link makes this visible to the client. Continue?")
          )
            return;
          startTransition(async () => {
            // A draft token 404s for the client — publish first so the link resolves.
            if (isDraft) {
              const sent = await k.publish(doc.id);
              if (isErr(sent)) {
                toast.error(sent.error);
                return;
              }
            }
            const url = `${window.location.origin}/${k.path}/${doc.token}`;
            try {
              await navigator.clipboard.writeText(url);
              toast.success("Share link copied");
            } catch {
              toast.message("Copy this link", { description: url });
            }
            if (isDraft) router.refresh();
          });
        },
      },
      {
        // PDF export is client-side print on the doc page (no server route), so
        // there's nothing to print from a list row — navigate to the doc instead.
        label: "Download PDF",
        icon: <Download size={15} strokeWidth={1.9} />,
        onSelect: () => router.push(doc.href),
      },
      {
        label: "Delete",
        icon: <Trash2 size={15} strokeWidth={1.9} />,
        destructive: true,
        separatorBefore: true,
        disabled: !k.canDelete(doc.status),
        disabledReason: "Only drafts can be deleted",
        onSelect: () => {
          // A sent PRD has been shared with the client — warn before removing it.
          const confirmMsg = isDraft
            ? "Delete this draft? This cannot be undone."
            : "This PRD has already been sent to the client. Delete it anyway? This cannot be undone.";
          if (!window.confirm(confirmMsg)) return;
          startTransition(async () => {
            const r = await k.del(doc.id);
            if (isErr(r)) toast.error(r.error);
            else {
              toast.success("Deleted");
              router.refresh();
            }
          });
        },
      },
    ];
    // doc is the only input; router/startTransition are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.kind, doc.id, doc.title, doc.status, doc.token, doc.href]);

  return { menu, items, isPending };
}
