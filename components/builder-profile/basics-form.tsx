"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importFromPortfolio } from "@/lib/actions/builder-profile";
import { useProfileDraft } from "./profile-draft-context";

// Basics editor — bound to the shared draft. No Save button: text fields
// autosave (debounced) and URL fields flush on blur via the draft context.
export function BasicsForm() {
  const { draft, accountDisplayName, setField, commitUrls } = useProfileDraft();
  const [isImporting, startImport] = useTransition();
  const router = useRouter();

  function importFromSite() {
    const url = draft.portfolioUrl.trim();
    if (!url) {
      toast.error("Enter your portfolio URL first.");
      return;
    }
    startImport(async () => {
      const result = await importFromPortfolio({ url });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const parts: string[] = [];
      if (result.experienceImported) {
        parts.push(
          `${result.experienceImported} experience ${result.experienceImported === 1 ? "entry" : "entries"} added`
        );
      }
      if (result.projectsImported) {
        parts.push(`${result.projectsImported} project${result.projectsImported === 1 ? "" : "s"} added`);
      }
      if (result.basicsUpdated) parts.push("headline & bio filled in");
      if (result.educationUpdated) parts.push("education filled in");
      if (result.linksUpdated) parts.push("links filled in");
      if (result.skipped && parts.length === 0) parts.push("already up to date");
      toast.success(
        parts.length > 0 ? `Imported from portfolio: ${parts.join(", ")}.` : "Profile updated from portfolio."
      );
      // Server changed text + collections; the draft merges them on refresh.
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="bp-display-name" className="block text-xs font-medium text-neutral-700">
          Display name
        </label>
        <Input
          id="bp-display-name"
          value={draft.displayName}
          onChange={(e) => setField("displayName", e.target.value)}
          maxLength={80}
          placeholder={accountDisplayName}
        />
        <p className="text-[11px] text-neutral-400">
          Shown on your public profile. Leave blank to use your account name.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="bp-headline" className="block text-xs font-medium text-neutral-700">
          Headline
        </label>
        <Input
          id="bp-headline"
          value={draft.headline}
          onChange={(e) => setField("headline", e.target.value)}
          maxLength={120}
          placeholder="e.g. Full-stack builder — Next.js, Supabase, AI products"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="bp-bio" className="block text-xs font-medium text-neutral-700">
          About
        </label>
        <textarea
          id="bp-bio"
          value={draft.bio}
          onChange={(e) => setField("bio", e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="A short intro clients will read first."
          className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
        />
        <p className="text-[11px] italic text-neutral-400">
          Don&apos;t overthink it. A sentence or two is fine.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="bp-linkedin" className="block text-xs font-medium text-neutral-700">
          LinkedIn URL
        </label>
        <Input
          id="bp-linkedin"
          value={draft.linkedinUrl}
          onChange={(e) => setField("linkedinUrl", e.target.value)}
          onBlur={commitUrls}
          maxLength={500}
          placeholder="https://linkedin.com/in/you"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="bp-github" className="block text-xs font-medium text-neutral-700">
          GitHub
        </label>
        <Input
          id="bp-github"
          value={draft.githubUrl}
          onChange={(e) => setField("githubUrl", e.target.value)}
          onBlur={commitUrls}
          maxLength={500}
          placeholder="username or https://github.com/you"
        />
        <p className="text-[11px] text-neutral-400">
          Just your username works — we&apos;ll fill in the rest.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="bp-portfolio" className="block text-xs font-medium text-neutral-700">
          Portfolio URL
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="bp-portfolio"
            value={draft.portfolioUrl}
            onChange={(e) => setField("portfolioUrl", e.target.value)}
            onBlur={commitUrls}
            maxLength={500}
            placeholder="https://yoursite.com"
            disabled={isImporting}
            className="min-w-0 flex-1"
          />
          <Button variant="outline" size="sm" onClick={importFromSite} disabled={isImporting}>
            <Sparkles className="h-3.5 w-3.5" />
            {isImporting ? "Working…" : "Fill profile from it"}
          </Button>
        </div>
        <p className="text-[11px] text-neutral-400">
          Shown on your profile — we can also autofill your profile from it.
        </p>
      </div>
    </div>
  );
}
