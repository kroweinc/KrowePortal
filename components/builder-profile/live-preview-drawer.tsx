"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Lock, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Ember } from "@/components/design-atoms";
import { setProfilePublished } from "@/lib/actions/builder-profile";
import { PublicProfileContent } from "./public-profile-view";
import { draftToPublicProfile, useProfileDraft } from "./profile-draft-context";

// The "Live Mirror" drawer: a browser-framed render of the exact public-profile
// body clients see, fed live from the draft — so it updates as you type. Styled
// after the Krowe Design "Live Mirror" handoff (.lpd-* in globals.css).
export function LivePreviewDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { draft, accountDisplayName } = useProfileDraft();
  const data = draftToPublicProfile(draft, accountDisplayName);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Mirror the share strip: publish on demand so the public link never 404s,
  // then open the real page clients would land on.
  function viewPublic() {
    startTransition(async () => {
      if (!draft.isPublished) {
        const result = await setProfilePublished(true);
        if (result.error) {
          toast.error(result.error);
          return;
        }
      }
      window.open(`${window.location.origin}/p/${draft.token}`, "_blank", "noopener,noreferrer");
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 bg-[var(--surface-subtle)] p-0 sm:max-w-[560px]"
      >
        <SheetTitle className="sr-only">Live preview — what clients see</SheetTitle>

        <div className="lpd-head">
          <span className="ppsetup-preview-cap">
            <Ember size={12} /> Live preview · what clients see
          </span>
          <div className="lpd-acts">
            <button
              type="button"
              className="lpd-viewpublic"
              onClick={viewPublic}
              disabled={isPending}
            >
              <ExternalLink className="h-3.5 w-3.5" /> View public
            </button>
            <SheetClose className="lpd-x" aria-label="Close live preview">
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </div>

        <div className="lpd-body">
          <div className="lpd-frame">
            <div className="lpd-bar">
              <span className="lpd-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="lpd-addr">
                <Lock className="h-3 w-3" /> krowe.app/p/{draft.token}
              </span>
            </div>
            <div className="lpd-page">
              <PublicProfileContent data={data} token={draft.token} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
