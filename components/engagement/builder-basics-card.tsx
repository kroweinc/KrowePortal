"use client";

import { useState } from "react";
import { ArrowUpRight, Github, Globe, Linkedin } from "lucide-react";
import { BuilderProfileDrawer } from "@/components/doc/builder-profile-drawer";
import { safeExternalHref } from "@/lib/project/business-context";
import type { OperatorBuilderBasics } from "@/lib/actions/operator-builder";

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className="h-12 w-12 shrink-0 rounded-full border border-neutral-200 object-cover"
      />
    );
  }
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-600">
      {initialsFor(name)}
    </span>
  );
}

export function BuilderBasicsCard({ builder }: { builder: OperatorBuilderBasics }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const hasLinks = builder.linkedinUrl || builder.githubUrl || builder.portfolioUrl;
  const hasPublishedProfile = !!builder.profileToken;

  const identity = (
    <div className="flex items-center gap-3">
      <Avatar name={builder.name} avatarUrl={builder.avatarUrl} />
      <div className="min-w-0">
        <p className="text-base font-semibold text-neutral-900">{builder.name}</p>
        {builder.headline && (
          <p className="mt-0.5 text-sm text-neutral-600">{builder.headline}</p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">Builder</h2>
          {hasPublishedProfile && (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900"
            >
              View all
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {hasPublishedProfile ? (
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            aria-label={`View ${builder.name}'s profile`}
            className="w-full cursor-pointer rounded-md text-left hover:bg-neutral-50"
          >
            {identity}
          </button>
        ) : (
          identity
        )}
        {builder.bio && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">
            {builder.bio}
          </p>
        )}
        {hasLinks && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
            {builder.linkedinUrl && (
              <a
                href={safeExternalHref(builder.linkedinUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </a>
            )}
            {builder.githubUrl && (
              <a
                href={safeExternalHref(builder.githubUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Github className="h-3.5 w-3.5" /> GitHub
              </a>
            )}
            {builder.portfolioUrl && (
              <a
                href={safeExternalHref(builder.portfolioUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Globe className="h-3.5 w-3.5" /> Portfolio
              </a>
            )}
          </div>
        )}
      </section>

      {hasPublishedProfile && (
        <BuilderProfileDrawer
          token={builder.profileToken!}
          name={builder.name}
          open={profileOpen}
          onOpenChange={setProfileOpen}
        />
      )}
    </>
  );
}
