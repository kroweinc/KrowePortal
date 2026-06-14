"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Link2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { regenerateShareToken, setProfilePublished } from "@/lib/actions/builder-profile";
import { useProfileDraft } from "./profile-draft-context";

// Slim share strip (direction C). Reuses the same publish / copy / regenerate
// server actions ShareLinkCard called — nothing lost, just restyled. Local
// state is seeded from the draft (which re-seeds from the server on refresh).
export function ProfileShareStrip() {
  const { draft } = useProfileDraft();
  const router = useRouter();
  const [published, setPublished] = useState(draft.isPublished);
  const [token, setToken] = useState(draft.token);
  const [origin, setOrigin] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => setOrigin(window.location.origin), []);
  // Keep in step if a refresh changes either value (e.g. token regenerated).
  useEffect(() => setPublished(draft.isPublished), [draft.isPublished]);
  useEffect(() => setToken(draft.token), [draft.token]);

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

  function regenerate() {
    if (!confirm("Generate a new link? Anyone using the old link will lose access.")) return;
    startTransition(async () => {
      const result = await regenerateShareToken();
      if (result.error || !result.token) {
        toast.error(result.error ?? "Could not regenerate link.");
        return;
      }
      setToken(result.token);
      toast.success("New share link generated");
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
      <Button variant="outline" size="sm" onClick={copyLink} disabled={isPending}>
        <Link2 className="h-3.5 w-3.5" /> Copy link
      </Button>
      <Button variant="outline" size="sm" onClick={viewPublic} disabled={isPending}>
        <ExternalLink className="h-3.5 w-3.5" /> View public
      </Button>
      <Button variant="outline" size="sm" onClick={togglePublished} disabled={isPending}>
        {published ? "Unpublish" : "Publish"}
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
    </div>
  );
}
