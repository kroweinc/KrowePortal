"use client";

/* Shared right-click menu for PRD / quote / contract rows.

   useDocMenu(doc) returns the menu state + the MenuItem[] for that doc, wiring
   each item to its existing server action. Reused by both doc surfaces (the
   project document list and the engagement document list) so they behave
   identically. Builder-only — only mounted where builder actions are allowed.

   Rename / share / delete confirmations use the branded useConfirm / usePrompt
   modals (not native window.* popups); the row mounts the returned `dialogs`. */

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Link2, Link2Off, RotateCw, Download, Trash2 } from "lucide-react";
import { useContextMenu, type MenuItem } from "@/components/ui/context-menu";
import { useConfirm, usePrompt } from "@/components/ui/confirm-dialog";
import {
  deletePrd,
  updatePrdContent,
  sendPrd,
  revokePrdShareLink,
  reissuePrdShareLink,
} from "@/lib/actions/prds";
import {
  deleteQuote,
  updateQuoteContent,
  sendQuote,
  revokeQuoteShareLink,
  reissueQuoteShareLink,
} from "@/lib/actions/quote-docs";
import {
  deleteContract,
  updateContractContent,
  sendContract,
  revokeContractShareLink,
  reissueContractShareLink,
} from "@/lib/actions/contracts";

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
  revoke: (id: string) => Promise<{ success: true } | { error: string }>;
  reissue: (id: string) => Promise<{ success: true; token: string } | { error: string }>;
  /** Public share path segment: /{path}/{token}. */
  path: string;
}

const KIND: Record<DocKind, KindHandlers> = {
  prd: {
    del: deletePrd,
    rename: (id, t) => updatePrdContent(id, { title: t }),
    publish: sendPrd,
    revoke: revokePrdShareLink,
    reissue: reissuePrdShareLink,
    path: "prd",
  },
  quote: {
    del: deleteQuote,
    rename: (id, t) => updateQuoteContent(id, { title: t }),
    publish: sendQuote,
    revoke: revokeQuoteShareLink,
    reissue: reissueQuoteShareLink,
    path: "quotes",
  },
  contract: {
    del: deleteContract,
    rename: (id, t) => updateContractContent(id, { title: t }),
    publish: (id) => sendContract(id),
    revoke: revokeContractShareLink,
    reissue: reissueContractShareLink,
    path: "contract",
  },
};

function isErr(r: unknown): r is { error: string } {
  return !!r && typeof r === "object" && "error" in r && !!(r as { error?: string }).error;
}

export function useDocMenu(doc: DocRef) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const menu = useContextMenu();
  const [confirm, confirmDialog] = useConfirm();
  const [promptInput, promptDialog] = usePrompt();

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
        onSelect: async () => {
          const entered = await promptInput({
            title: "Rename document",
            defaultValue: doc.title,
            confirmText: "Rename",
            required: true,
          });
          const next = entered?.trim();
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
        label: "Copy share link",
        icon: <Link2 size={15} strokeWidth={1.9} />,
        onSelect: async () => {
          if (
            isDraft &&
            !(await confirm({
              title: "Share this link?",
              description: "Sharing a link makes this document visible to the client.",
              confirmText: "Share",
            }))
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
        label: "Generate new link",
        icon: <RotateCw size={15} strokeWidth={1.9} />,
        // A draft has never been shared — nothing to rotate yet.
        disabled: isDraft,
        disabledReason: "Share the document first",
        onSelect: async () => {
          if (
            !(await confirm({
              title: "Generate a new share link?",
              description: "Anyone using the old link will lose access. You'll get a fresh link to share.",
              confirmText: "Generate new link",
              cancelText: "Keep current link",
            }))
          )
            return;
          startTransition(async () => {
            const r = await k.reissue(doc.id);
            if (isErr(r)) {
              toast.error(r.error);
              return;
            }
            const url = `${window.location.origin}/${k.path}/${r.token}`;
            try {
              await navigator.clipboard.writeText(url);
              toast.success("New share link copied");
            } catch {
              toast.message("Copy this link", { description: url });
            }
            router.refresh();
          });
        },
      },
      {
        label: "Revoke share link",
        icon: <Link2Off size={15} strokeWidth={1.9} />,
        destructive: true,
        // A draft has never been shared — nothing to revoke yet.
        disabled: isDraft,
        disabledReason: "Share the document first",
        onSelect: async () => {
          if (
            !(await confirm({
              title: "Revoke this share link?",
              description: "Anyone with the current link will lose access. Generate a new link to re-share.",
              tone: "danger",
              confirmText: "Revoke link",
            }))
          )
            return;
          startTransition(async () => {
            const r = await k.revoke(doc.id);
            if (isErr(r)) toast.error(r.error);
            else {
              toast.success("Share link revoked");
              router.refresh();
            }
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
        disabled: !isDraft,
        disabledReason: "Only drafts can be deleted",
        onSelect: async () => {
          if (
            !(await confirm({
              title: "Delete this draft?",
              description: "This can't be undone.",
              tone: "danger",
              confirmText: "Delete",
            }))
          )
            return;
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
    // doc is the only data input; router/startTransition/confirm/promptInput are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.kind, doc.id, doc.title, doc.status, doc.token, doc.href]);

  const dialogs = (
    <>
      {confirmDialog}
      {promptDialog}
    </>
  );

  return { menu, items, isPending, dialogs };
}
