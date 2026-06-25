"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  FileText,
  GitCommitHorizontal,
  Github,
  Globe,
  GraduationCap,
  Linkedin,
  Lock,
  Sparkles,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VerifiedBadge } from "./verified-badge";
import { LanguageBar } from "./language-bar";
import { TechBadge } from "./tech-badge";
import { BrandLogo } from "@/components/prd/brand-logo";
import { getPublicResumeUrl, type PublicBuilderProfile } from "@/lib/actions/builder-profile-public";
import { findCodingToolPreset } from "@/lib/coding-tools";
import { companyInitials } from "@/lib/company";
import { findUniversityDomain } from "@/lib/education";
import { safeExternalHref } from "@/lib/project/business-context";

interface PublicProfileViewProps {
  data: PublicBuilderProfile;
  token: string;
}

export function PublicProfileView({ data, token }: PublicProfileViewProps) {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <PublicProfileContent data={data} token={token} />
        <footer className="pb-6 text-center text-[11px] text-neutral-400">
          Shared via Krowe
        </footer>
      </div>
    </main>
  );
}

/* Page-agnostic profile body (header card + sections), shared between the
   full /p/[token] page above and the in-document profile drawer. The parent
   provides background, width, and vertical spacing (space-y-6). */
export function PublicProfileContent({ data, token }: PublicProfileViewProps) {
  const [isPending, startTransition] = useTransition();

  const githubProjects = data.projects.filter((p) => p.source === "github");
  const manualProjects = data.projects.filter((p) => p.source === "manual");

  function openResume() {
    startTransition(async () => {
      const result = await getPublicResumeUrl(token);
      if (result.error || !result.url) {
        toast.error(result.error ?? "Resume not available.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <>
      {/* Header */}
      <header className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          {data.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl}
              alt={data.displayName}
              className="h-12 w-12 shrink-0 rounded-full border border-neutral-200 object-cover"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-neutral-900">{data.displayName}</h1>
            {data.headline && <p className="mt-1 text-sm text-neutral-600">{data.headline}</p>}
          </div>
        </div>
        {data.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {data.tags.map((tag) => (
              <Badge key={tag} variant="builder" className="gap-1">
                <Sparkles className="h-3 w-3" /> {tag}
              </Badge>
            ))}
          </div>
        )}
        {data.bio && (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-neutral-500">
            {data.bio}
          </p>
        )}
        {(data.linkedinUrl || data.githubUrl || data.portfolioUrl || data.hasResume) && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            {data.hasResume && (
              <button
                type="button"
                onClick={openResume}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" />
                {isPending ? "Opening…" : "View resume"}
              </button>
            )}
            {data.linkedinUrl && (
              <a
                href={safeExternalHref(data.linkedinUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </a>
            )}
            {data.githubUrl && (
              <a
                href={safeExternalHref(data.githubUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Github className="h-3.5 w-3.5" /> GitHub
              </a>
            )}
            {data.portfolioUrl && (
              <a
                href={safeExternalHref(data.portfolioUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Globe className="h-3.5 w-3.5" /> Portfolio
              </a>
            )}
          </div>
        )}
      </header>

      {/* GitHub showcase */}
      {githubProjects.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-900">Projects on GitHub</h2>
            <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
              <BadgeCheck className="h-3.5 w-3.5" /> Verified from GitHub
            </span>
          </div>
          <p className="mb-4 text-xs text-neutral-400">
            {data.githubUsername && <>@{data.githubUsername} · </>}
            Stats pulled directly from GitHub
            {data.githubSyncedAt && (
              <>
                {" "}
                · last synced{" "}
                {new Date(data.githubSyncedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </>
            )}
          </p>
          <ul className="space-y-4">
            {githubProjects.map((project) => (
              <ProjectCard key={project.id} project={project} verified />
            ))}
          </ul>
        </section>
      )}

      {/* Other projects */}
      {manualProjects.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-900">Other projects</h2>
          <ul className="space-y-4">
            {manualProjects.map((project) => (
              <ProjectCard key={project.id} project={project} verified={false} />
            ))}
          </ul>
        </section>
      )}

      {/* Experience */}
      {data.experience.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-900">Experience</h2>
          <ul className="space-y-4">
            {data.experience.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3">
                {/* Company logo from the verified domain captured by the
                    company autocomplete; initials when none was captured.
                    name is omitted so BrandLogo's dev-tool name guessing
                    can't mislabel a company (e.g. "Express" the retailer). */}
                <BrandLogo
                  domain={entry.company_domain}
                  fallback={companyInitials(entry.company)}
                  size={40}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">
                    {entry.role}{" "}
                    <span className="font-normal text-neutral-500">· {entry.company}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {entry.start_label ?? ""}
                    {entry.start_label || entry.end_label ? " — " : ""}
                    {entry.end_label ?? (entry.start_label ? "Present" : "")}
                  </p>
                  {entry.description && (
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                      {entry.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Education */}
      {data.educationSchool && (
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-900">Education</h2>
          <div className="flex items-start gap-3">
            {/* Grey tile holding the bare school logo, or a graduation cap
                when the school isn't a known university. */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100">
              {findUniversityDomain(data.educationSchool) ? (
                <BrandLogo
                  domain={findUniversityDomain(data.educationSchool)}
                  name={data.educationSchool}
                  size={20}
                  plain
                />
              ) : (
                <GraduationCap className="h-5 w-5 text-neutral-500" />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold text-neutral-900">{data.educationSchool}</p>
              {(data.educationMajor || data.educationYear) && (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {data.educationMajor}
                  {data.educationMajor && data.educationYear ? " · " : ""}
                  {data.educationYear}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Coding tools — flat, ungrouped pill list (Krowe Design "Live Mirror"). */}
      {data.codingTools.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-900">Coding tools</h2>
          <div className="flex flex-wrap gap-3">
            {data.codingTools.map((tool) => {
              const logo = (
                <BrandLogo
                  domain={findCodingToolPreset(tool.name)?.domain}
                  name={tool.name}
                  size={18}
                />
              );
              return tool.url ? (
                <a
                  key={tool.id}
                  href={safeExternalHref(tool.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-neutral-50 pl-[7px] pr-3 text-xs font-medium text-neutral-700 hover:border-neutral-300 hover:text-neutral-900"
                >
                  {logo}
                  {tool.name}
                </a>
              ) : (
                <span
                  key={tool.id}
                  className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-neutral-50 pl-[7px] pr-3 text-xs font-medium text-neutral-700"
                >
                  {logo}
                  {tool.name}
                </span>
              );
            })}
          </div>
        </section>
      )}

    </>
  );
}

function ProjectCard({
  project,
  verified,
}: {
  project: PublicBuilderProfile["projects"][number];
  verified: boolean;
}) {
  return (
    <li className="rounded-md border border-neutral-100 bg-neutral-50/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {project.url && !project.github_is_private ? (
          <a
            href={safeExternalHref(project.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-neutral-900 hover:underline"
          >
            {project.name}
          </a>
        ) : (
          <span className="text-sm font-semibold text-neutral-900">{project.name}</span>
        )}
        {verified && <VerifiedBadge />}
        {project.github_is_private && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-neutral-400"
            title="Private repository — stats verified, code not public"
          >
            <Lock className="h-3 w-3" /> private
          </span>
        )}
        {project.live_url && (
          <a
            href={safeExternalHref(project.live_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-neutral-400 hover:text-neutral-900"
          >
            <Globe className="h-3 w-3" /> Try it live
          </a>
        )}
      </div>
      {project.description && (
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">{project.description}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        {verified && project.commit_count !== null && (
          <span className="inline-flex items-center gap-1">
            <GitCommitHorizontal className="h-3 w-3" />
            {project.commit_count.toLocaleString()} commits
          </span>
        )}
        {project.stars !== null && project.stars > 0 && (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3" /> {project.stars.toLocaleString()}
          </span>
        )}
        {project.techBadges.map((badge) => (
          <TechBadge key={badge.tech} tech={badge.tech} icon={badge.icon} />
        ))}
      </div>
      {project.languages && project.languages.length > 0 && (
        <div className="mt-3">
          <LanguageBar languages={project.languages} />
        </div>
      )}
    </li>
  );
}
