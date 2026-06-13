"use client";

import { cn } from "@/lib/utils";
import type { BuilderIdentity } from "@/lib/actions/builder-identity";
import { BuilderProfileDrawer } from "@/components/doc/builder-profile-drawer";

/* "Prepared by" row for public document views (PRD / contract / quote): the
   builder's avatar + name. When the profile is published, clicking opens the
   profile in a left slide-in drawer (BuilderProfileDrawer) instead of
   navigating away from the document. `className` carries the surrounding doc
   stage's typography class ("preview-prepared" or "dash-updated") so each view
   keeps its existing look. */

interface PreparedByProps {
  builder: BuilderIdentity;
  className?: string;
  label?: string;
}

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "?"
  );
}

export function PreparedBy({ builder, className, label = "Prepared by" }: PreparedByProps) {
  const identity = (
    <>
      {builder.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={builder.avatarUrl}
          alt={builder.name}
          className="h-6 w-6 shrink-0 rounded-full border border-neutral-200 object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-semibold text-neutral-600">
          {initialsFor(builder.name)}
        </span>
      )}
      <span>
        {label} <span className="font-medium">{builder.name}</span>
      </span>
    </>
  );

  return (
    <p className={cn(className, "flex items-center gap-2")}>
      {builder.profileToken ? (
        <BuilderProfileDrawer token={builder.profileToken} name={builder.name}>
          <button
            type="button"
            aria-label={`View ${builder.name}'s profile`}
            className="inline-flex cursor-pointer items-center gap-2 hover:underline"
          >
            {identity}
          </button>
        </BuilderProfileDrawer>
      ) : (
        <span className="inline-flex items-center gap-2">{identity}</span>
      )}
    </p>
  );
}
