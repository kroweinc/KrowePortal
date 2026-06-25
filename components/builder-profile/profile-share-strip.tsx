"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Link2, Link2Off, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  regenerateShareToken,
  revokeProfileShareLink,
  setProfilePublished,
} from "@/lib/actions/builder-profile";
import { useProfileDraft } from "./profile-draft-context";

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

// Slim share strip (direction C). Reuses the same publish / copy / regenerate
// server actions ShareLinkCard called — nothing lost, just restyled. Local
// state is seeded from the draft (which re-seeds from the server on refresh).
export function ProfileShareStrip() {
  const { draft } = useProfileDraft();
  const router = useRouter();
  const [published, setPublished] = useState(draft.isPublished);
  const [token, setToken] = useState(draft.token);
  const [expiresAt, setExpiresAt] = useState(draft.tokenExpiresAt);
  const [revokedAt, setRevokedAt] = useState(draft.tokenRevokedAt);
  const [hint, setHint] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => setOrigin(window.location.origin), []);
  // Keep in step if a refresh changes any value (e.g. token regenerated/revoked).
  useEffect(() => setPublished(draft.isPublished), [draft.isPublished]);
  useEffect(() => setToken(draft.token), [draft.token]);
  useEffect(() => setExpiresAt(draft.tokenExpiresAt), [draft.tokenExpiresAt]);
  useEffect(() => setRevokedAt(draft.tokenRevokedAt), [draft.tokenRevokedAt]);
  useEffect(() => setHint(linkHint(revokedAt, expiresAt)), [revokedAt, expiresAt]);

  async function ensurePublished(): Promise<boolean> {
    if (published) return true;
    const result = await setProfilePublished(true);
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    setPublished(true);
    return true;
  }

  function copyLink() {
    startTransition(async () => {
      if (!(await ensurePublished())) return;
      const url = `${window.location.origin}/p/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied");
      } catch {
        toast.message("Copy this link", { description: url });
      }
      router.refresh();
    });
  }

  function viewPublic() {
    startTransition(async () => {
      if (!(await ensurePublished())) return;
      window.open(`${window.location.origin}/p/${token}`, "_blank", "noopener,noreferrer");
      router.refresh();
    });
  }

  function togglePublished() {
    const next = !published;
    startTransition(async () => {
      const result = await setProfilePublished(next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPublished(next);
      toast.success(next ? "Profile is live" : "Profile unpublished");
      router.refresh();
    });
  }

  async function regenerate() {
    if (
      !(await confirm({
        title: "Generate a new share link?",
        description: "Anyone using the old link will lose access. You’ll get a fresh link to share.",
        confirmText: "Generate new link",
        cancelText: "Keep current link",
        icon: RotateCw,
        tone: "danger",
      }))
    )
      return;
    startTransition(async () => {
      const result = await regenerateShareToken();
      if (result.error || !result.token) {
        toast.error(result.error ?? "Could not regenerate link.");
        return;
      }
      setToken(result.token);
      // Regenerate also resets expiry (+365d) and clears revocation server-side.
      setExpiresAt(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
      setRevokedAt(null);
      toast.success("New share link generated");
      router.refresh();
    });
  }

  async function revoke() {
    if (
      !(await confirm({
        title: "Revoke this share link?",
        description: "Anyone with the current link will lose access. Generate a new link to re-share.",
        confirmText: "Revoke link",
        cancelText: "Keep link",
        icon: Link2Off,
        tone: "danger",
      }))
    )
      return;
    startTransition(async () => {
      const result = await revokeProfileShareLink();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRevokedAt(new Date().toISOString());
      toast.success("Share link revoked");
      router.refresh();
    });
  }

  return (
    <div className="ss-share">
      <span className={`live-dot${published ? "" : " off"}`} />
      <span style={{ fontSize: "12.5px", fontWeight: 600 }}>{published ? "Live" : "Private"}</span>
      <span className="url">
        {origin || "https://krowe.app"}/p/{token}
      </span>
      {hint && (
        <span style={{ fontSize: "12px", color: "#737373" }}>{hint}</span>
      )}
      <Button variant="outline" size="sm" onClick={copyLink} disabled={isPending}>
        <Link2 className="h-3.5 w-3.5" /> Copy link
      </Button>
      <Button variant="outline" size="sm" onClick={viewPublic} disabled={isPending}>
        <ExternalLink className="h-3.5 w-3.5" /> View public
      </Button>
      <Button variant="outline" size="sm" onClick={togglePublished} disabled={isPending}>
        {published ? "Unpublish" : "Publish"}
      </Button>
      <Button variant="outline" size="sm" onClick={revoke} disabled={isPending}>
        <Link2Off className="h-3.5 w-3.5" /> Revoke
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={regenerate}
        disabled={isPending}
        title="Generate a new link"
        aria-label="Generate a new link"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
      {confirmDialog}
    </div>
  );
}
