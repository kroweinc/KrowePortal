"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importFromPortfolio, updateProfileBasics } from "@/lib/actions/builder-profile";
import { githubProfileUrl } from "@/lib/project/business-context";

interface BasicsFormProps {
  initialDisplayName: string;
  accountName: string;
  initialHeadline: string;
  initialBio: string;
  initialLinkedinUrl: string;
  initialGithubUrl: string;
  initialPortfolioUrl: string;
}

export function BasicsForm({
  initialDisplayName,
  accountName,
  initialHeadline,
  initialBio,
  initialLinkedinUrl,
  initialGithubUrl,
  initialPortfolioUrl,
}: BasicsFormProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [headline, setHeadline] = useState(initialHeadline);
  const [bio, setBio] = useState(initialBio);
  const [linkedinUrl, setLinkedinUrl] = useState(initialLinkedinUrl);
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl);
  const [portfolioUrl, setPortfolioUrl] = useState(initialPortfolioUrl);
  const [saved, setSaved] = useState({
    displayName: initialDisplayName,
    headline: initialHeadline,
    bio: initialBio,
    linkedinUrl: initialLinkedinUrl,
    githubUrl: initialGithubUrl,
    portfolioUrl: initialPortfolioUrl,
  });
  const [isPending, startTransition] = useTransition();
  const [isImporting, startImport] = useTransition();
  const router = useRouter();

  const dirty =
    displayName.trim() !== saved.displayName.trim() ||
    headline.trim() !== saved.headline.trim() ||
    bio.trim() !== saved.bio.trim() ||
    linkedinUrl.trim() !== saved.linkedinUrl.trim() ||
    githubUrl.trim() !== saved.githubUrl.trim() ||
    portfolioUrl.trim() !== saved.portfolioUrl.trim();

  function save() {
    if (!dirty || isPending) return;
    startTransition(async () => {
      const result = await updateProfileBasics({
        display_name: displayName.trim(),
        headline: headline.trim(),
        bio: bio.trim(),
        linkedin_url: linkedinUrl.trim() || null,
        github_url: githubUrl.trim() || null,
        portfolio_url: portfolioUrl.trim() || null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSaved({ displayName, headline, bio, linkedinUrl, githubUrl, portfolioUrl });
      toast.success("Saved");
    });
  }

  function importFromSite() {
    if (!portfolioUrl.trim()) {
      toast.error("Enter your portfolio URL first.");
      return;
    }
    startImport(async () => {
      const result = await importFromPortfolio({ url: portfolioUrl.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSaved((s) => ({ ...s, portfolioUrl }));
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
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={80}
          placeholder={accountName}
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
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
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
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="A short intro clients will read first."
          className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="bp-linkedin" className="block text-xs font-medium text-neutral-700">
          LinkedIn URL
        </label>
        <Input
          id="bp-linkedin"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
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
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          onBlur={() => setGithubUrl((v) => githubProfileUrl(v) || v.trim())}
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
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
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
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
