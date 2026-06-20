"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Ember } from "@/components/design-atoms";
import { PublicProfileContent } from "./public-profile-view";
import { draftToPublicProfile, useProfileDraft } from "./profile-draft-context";

// The A-direction "Live Mirror", repackaged as a right-side drawer that opens
// from a button. Renders the exact public-profile body clients see, fed live
// from the draft — so it updates as you type.
export function LivePreviewDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { draft, accountDisplayName } = useProfileDraft();
  const data = draftToPublicProfile(draft, accountDisplayName);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[560px]">
        <SheetTitle className="sr-only">Live preview — what clients see</SheetTitle>
        <div
          className="ppsetup-preview-cap"
          style={{ padding: "18px 48px 18px 22px", borderBottom: "1px solid var(--border)" }}
        >
          <Ember size={12} /> Live preview · what clients see
        </div>
        <div className="flex-1 overflow-y-auto bg-neutral-50 p-4">
          <div className="mx-auto max-w-2xl space-y-6 pb-8">
            <PublicProfileContent data={data} token={draft.token} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
