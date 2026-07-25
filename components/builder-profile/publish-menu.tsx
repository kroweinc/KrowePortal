"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, EyeOff, Link2, Link2Off, RotateCw } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  regenerateShareToken,
  revokeProfileShareLink,
  setProfilePublished,
} from "@/lib/actions/builder-profile";
import { useProfileDraft } from "./profile-draft-context";

// The header's Publish control. Replaces the old full-width share strip: the
// Figma folds publish, copy, regenerate and revoke into one split button so the
// share link stops competing with the profile itself for attention.
//
// Hand-rolled rather than Radix — the repo carries @radix-ui/react-dialog only,
// and one popover doesn't justify a new dependency. Click-outside, Escape and
// focus-return are implemented below; anything more would.

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

export function PublishMenu() {
  const { draft } = useProfileDraft();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState(draft.isPublished);
  const [token, setToken] = useState(draft.token);
  const [expiresAt, setExpiresAt] = useState(draft.tokenExpiresAt);
  const [revokedAt, setRevokedAt] = useState(draft.tokenRevokedAt);
  const [hint, setHint] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  // Keep in step if a refresh changes any value (e.g. token regenerated/revoked).
  useEffect(() => setPublished(draft.isPublished), [draft.isPublished]);
  useEffect(() => setToken(draft.token), [draft.token]);
  useEffect(() => setExpiresAt(draft.tokenExpiresAt), [draft.tokenExpiresAt]);
  useEffect(() => setRevokedAt(draft.tokenRevokedAt), [draft.tokenRevokedAt]);
  useEffect(() => setHint(linkHint(revokedAt, expiresAt)), [revokedAt, expiresAt]);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(true);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

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

  function publish() {
    startTransition(async () => {
      const result = await setProfilePublished(true);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPublished(true);
      toast.success("Your profile is live.");
      router.refresh();
    });
  }

  function unpublish() {
    close();
    startTransition(async () => {
      const result = await setProfilePublished(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPublished(false);
      toast.success("Your profile is private again.");
      router.refresh();
    });
  }

  // Copying auto-publishes: a link that 404s for the client is worse than
  // going live a moment early, and the builder chose to share it.
  function copyLink() {
    close();
    startTransition(async () => {
      if (!(await ensurePublished())) return;
      const url = `${window.location.origin}/p/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied.");
      } catch {
        toast.message("Copy this link", { description: url });
      }
      router.refresh();
    });
  }

  async function regenerate() {
    close();
    const ok = await confirm({
      title: "Generate a new share link?",
      description: "Anyone using the old link will lose access. You'll get a fresh link to share.",
      confirmText: "Generate new link",
      cancelText: "Keep current link",
      icon: RotateCw,
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await regenerateShareToken();
      if (result.error || !result.token) {
        toast.error(result.error ?? "Could not regenerate link.");
        return;
      }
      setToken(result.token);
      // Regenerate mints a never-expiring link (null) and clears revocation
      // server-side; mirror that optimistically so no stale expiry hint flashes.
      setExpiresAt(null);
      setRevokedAt(null);
      toast.success("New share link generated.");
      router.refresh();
    });
  }

  async function revoke() {
    close();
    const ok = await confirm({
      title: "Revoke this share link?",
      description: "Anyone with the current link will lose access. Generate a new link to re-share.",
      confirmText: "Revoke link",
      cancelText: "Keep link",
      icon: Link2Off,
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await revokeProfileShareLink();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRevokedAt(new Date().toISOString());
      toast.success("Share link revoked.");
      router.refresh();
    });
  }

  return (
    <div className="ss-pub" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="ss-btn primary"
        onClick={() => (published ? setOpen((v) => !v) : publish())}
        disabled={isPending}
        aria-haspopup={published ? "menu" : undefined}
        aria-expanded={published ? open : undefined}
      >
        {published ? "Published" : "Publish"}
        {published && <ChevronDown />}
      </button>

      {/* Before the first publish there's nothing to manage — the button just
          publishes, and the menu appears once there's a live link. */}
      {published && open && (
        <div className="ss-pubmenu" role="menu">
          <div className="ss-pubhead">
            <div className="ss-puburl">
              {origin || "https://krowe.app"}/p/{token}
            </div>
            {hint && <div className="ss-pubhint">{hint}</div>}
          </div>
          <button type="button" role="menuitem" className="ss-pubitem" onClick={copyLink} disabled={isPending}>
            <Link2 /> Copy share link
          </button>
          <button type="button" role="menuitem" className="ss-pubitem" onClick={regenerate} disabled={isPending}>
            <RotateCw /> Generate a new link
          </button>
          <button type="button" role="menuitem" className="ss-pubitem danger" onClick={revoke} disabled={isPending}>
            <Link2Off /> Revoke this link
          </button>
          <button type="button" role="menuitem" className="ss-pubitem danger" onClick={unpublish} disabled={isPending}>
            <EyeOff /> Unpublish profile
          </button>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
