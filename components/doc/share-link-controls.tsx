"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2Off, RotateCw } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { DocKind } from "@/components/doc/doc-menu";
import { revokeContractShareLink, reissueContractShareLink } from "@/lib/actions/contracts";
import { revokeQuoteShareLink, reissueQuoteShareLink } from "@/lib/actions/quote-docs";
import { revokePrdShareLink, reissuePrdShareLink } from "@/lib/actions/prds";

// Owner-side link management for the doc dashboards (contract/quote/PRD), sitting
// next to "Copy link". Mirrors the two doc-menu items but as toolbar buttons +
// an expiry hint. Drafts have no shared link yet, so this renders nothing then —
// the dashboard's "Copy link" handles the first publish-and-share.
interface ShareAction {
  revoke: (id: string) => Promise<{ success: true } | { error: string }>;
  reissue: (id: string) => Promise<{ success: true; token: string } | { error: string }>;
  /** Public share path segment: /{path}/{token}. */
  path: string;
}

const ACTIONS: Record<DocKind, ShareAction> = {
  prd: { revoke: revokePrdShareLink, reissue: reissuePrdShareLink, path: "prd" },
  quote: { revoke: revokeQuoteShareLink, reissue: reissueQuoteShareLink, path: "quotes" },
  contract: { revoke: revokeContractShareLink, reissue: reissueContractShareLink, path: "contract" },
};

function isErr(r: unknown): r is { error: string } {
  return !!r && typeof r === "object" && "error" in r && !!(r as { error?: string }).error;
}

// Day-granular link status. Computed after mount (Date.now would otherwise risk
// an SSR/hydration mismatch at a day boundary).
function linkHint(revokedAt: string | null, expiresAt: string | null): string | null {
  if (revokedAt) return "Link revoked";
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Link expired";
  if (days === 1) return "Link expires tomorrow";
  return `Link expires in ${days} days`;
}

export function ShareLinkControls({
  kind,
  id,
  token,
  expiresAt,
  revokedAt,
  isDraft,
}: {
  kind: DocKind;
  id: string;
  token: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => setHint(linkHint(revokedAt, expiresAt)), [revokedAt, expiresAt]);

  const k = ACTIONS[kind];

  function reissue() {
    startTransition(async () => {
      if (
        !(await confirm({
          title: "Generate a new share link?",
          description: "Anyone using the old link will lose access. You'll get a fresh link to share.",
          confirmText: "Generate new link",
          cancelText: "Keep current link",
          icon: RotateCw,
        }))
      )
        return;
      const r = await k.reissue(id);
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
  }

  function revoke() {
    startTransition(async () => {
      if (
        !(await confirm({
          title: "Revoke this share link?",
          description: "Anyone with the current link will lose access. Generate a new link to re-share.",
          confirmText: "Revoke link",
          cancelText: "Keep link",
          tone: "danger",
          icon: Link2Off,
        }))
      )
        return;
      const r = await k.revoke(id);
      if (isErr(r)) toast.error(r.error);
      else {
        toast.success("Share link revoked");
        router.refresh();
      }
    });
  }

  // No link has been shared yet on a draft — nothing to revoke or rotate.
  if (isDraft || !token) return null;

  return (
    <>
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
      <button type="button" className="prd-btn prd-btn--outline" onClick={reissue} disabled={isPending}>
        <RotateCw className="h-3.5 w-3.5" /> New link
      </button>
      <button type="button" className="prd-btn prd-btn--ghost" onClick={revoke} disabled={isPending}>
        <Link2Off className="h-3.5 w-3.5" /> Revoke
      </button>
      {confirmDialog}
    </>
  );
}
