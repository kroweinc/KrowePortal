"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setProfilePublished, regenerateShareToken } from "@/lib/actions/builder-profile";

interface ShareLinkCardProps {
  token: string;
  isPublished: boolean;
}

export function ShareLinkCard({ token, isPublished }: ShareLinkCardProps) {
  const router = useRouter();
  const [published, setPublished] = useState(isPublished);
  const [currentToken, setCurrentToken] = useState(token);
  const [origin, setOrigin] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

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

  function copyLink() {
    const url = `${window.location.origin}/p/${currentToken}`;
    startTransition(async () => {
      if (!published) {
        const result = await setProfilePublished(true);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        setPublished(true);
      }
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied");
      } catch {
        toast.message("Copy this link", { description: url });
      }
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
      setCurrentToken(result.token);
      toast.success("New share link generated");
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Share with clients</h2>
          <p className="text-xs text-neutral-500">
            {published
              ? "Your profile is live — anyone with the link can view it."
              : "Your profile is private. Publish it to share the link."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={regenerate} disabled={isPending}>
            <RefreshCw className="h-3.5 w-3.5" /> New link
          </Button>
          <Button variant="outline" size="sm" onClick={copyLink} disabled={isPending}>
            <Link2 className="h-3.5 w-3.5" /> Copy link
          </Button>
          <Button size="sm" onClick={togglePublished} disabled={isPending}>
            {published ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </div>
      {published && (
        <p className="mt-3 break-all border-t border-neutral-100 pt-3 font-mono text-xs text-neutral-500">
          {origin}/p/{currentToken}
        </p>
      )}
    </section>
  );
}
