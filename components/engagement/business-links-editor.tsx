"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/prd/brand-logo";
import { saveEngagementBusinessLinks } from "@/lib/actions/engagement";
import { normalizeUrl } from "@/lib/project/business-context";
import "./engagement.css";

/* Inline editor for the business's links, shown in the client manage view so the
   builder can set them without leaving for the project page. The landing-page
   input previews the brand logo live (fetched from whatever you type). Writes
   through to the linked project (website_url / linkedin_url) — the single
   source of truth the brand mark and every doc read from live. */

type LinkKey = "website" | "linkedin";

const FIELDS: { key: LinkKey; label: string; placeholder: string; hint?: string }[] = [
  {
    key: "website",
    label: "Landing page",
    placeholder: "acme.com",
    hint: "Their public site — the logo previews as you type.",
  },
  { key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/company/acme" },
];

export function BusinessLinksEditor({
  engagementId,
  initialWebsite,
  initialLinkedin,
  showTopBorder = true,
}: {
  engagementId: string;
  initialWebsite: string | null;
  initialLinkedin: string | null;
  showTopBorder?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initial: Record<LinkKey, string> = {
    website: initialWebsite ?? "",
    linkedin: initialLinkedin ?? "",
  };
  const [links, setLinks] = useState<Record<LinkKey, string>>(initial);

  const dirty = FIELDS.some((f) => links[f.key].trim() !== initial[f.key].trim());

  function set(key: LinkKey, value: string) {
    setLinks((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await saveEngagementBusinessLinks(engagementId, {
        websiteUrl: links.website.trim() || null,
        linkedinUrl: links.linkedin.trim() || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Mirror the server's normalization (it prepends https://) so the inputs
      // match what was stored and the Save button clears after the refresh.
      setLinks({
        website: normalizeUrl(links.website) ?? "",
        linkedin: normalizeUrl(links.linkedin) ?? "",
      });
      toast.success("Links saved.");
      router.refresh();
    });
  }

  return (
    <div className={`space-y-3 ${showTopBorder ? "mt-3 border-t border-neutral-100 pt-3" : ""}`}>
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-xs font-medium text-neutral-500">{f.label}</label>
          <div className="flex items-center gap-2">
            {f.key === "website" && (
              // Brand fetching: resolves a logo from whatever host is typed,
              // falling back to a monogram tile until it's a real domain.
              <span className="biz-link-logo">
                <BrandLogo
                  domain={links.website.includes(".") ? links.website : null}
                  name={links.website || "?"}
                  size={34}
                  plain
                />
              </span>
            )}
            <Input
              value={links[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder}
              maxLength={2000}
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && dirty) {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </div>
          {f.hint && <p className="mt-1 text-xs text-neutral-400">{f.hint}</p>}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-400">Saved to this client&apos;s document record.</p>
        {dirty && (
          <Button size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save links"}
          </Button>
        )}
      </div>
    </div>
  );
}
