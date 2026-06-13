"use client";

import { useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PublicProfileContent } from "@/components/builder-profile/public-profile-view";
import {
  getBuilderProfileByToken,
  type PublicBuilderProfile,
} from "@/lib/actions/builder-profile-public";

/* Left slide-in drawer showing a builder's public profile without leaving the
   document (PRD / quote / contract). The profile is fetched on first open via
   the same token-capability action that powers /p/[token], then cached for the
   life of the page so reopening is instant. */

export function BuilderProfileDrawer({
  token,
  name,
  children,
}: {
  token: string;
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PublicBuilderProfile | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !profile && status !== "loading") {
      setStatus("loading");
      getBuilderProfileByToken(token)
        .then((data) => {
          if (data) {
            setProfile(data);
            setStatus("idle");
          } else {
            setStatus("error");
          }
        })
        .catch(() => setStatus("error"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="left" className="flex flex-col gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="bg-white">
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>Builder profile</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto bg-neutral-50 px-4 py-6">
          {status === "loading" && <ProfileSkeleton />}
          {status === "error" && (
            <p className="py-10 text-center text-sm text-neutral-500">
              This profile isn&apos;t available.
            </p>
          )}
          {profile && (
            <div className="space-y-6">
              <PublicProfileContent data={profile} token={token} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-full bg-neutral-200" />
          <div className="space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-neutral-200" />
            <div className="h-3 w-56 animate-pulse rounded bg-neutral-100" />
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-100" />
        </div>
      </div>
      <div className="h-40 animate-pulse rounded-lg border border-neutral-200 bg-white shadow-sm" />
      <div className="h-40 animate-pulse rounded-lg border border-neutral-200 bg-white shadow-sm" />
    </div>
  );
}
