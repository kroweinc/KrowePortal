"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  Check,
  CloudCheck,
  Eye,
  FolderGit2,
  GraduationCap,
  IdCardLanyard,
  Loader2,
  Tag,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { computeStrength, SECTION_STRENGTH_KEY } from "@/lib/builder-profile/profile-strength";
import { useProfileDraft, type SaveState } from "./profile-draft-context";
import { ProfileSection } from "./profile-section";
import { PublishMenu } from "./publish-menu";
import { LivePreviewDrawer } from "./live-preview-drawer";
import { AvatarUpload } from "./avatar-upload";
import { BasicsForm } from "./basics-form";
import { ResumeUpload } from "./resume-upload";
import { TagsEditor } from "./tags-editor";
import { GithubShowcaseEditor } from "./github-showcase-editor";
import { ManualProjectForm } from "./manual-project-form";
import { ProjectList } from "./project-list";
import { ExperienceEditor, ExperienceForm } from "./experience-editor";
import { EducationEditor, EducationForm } from "./education-editor";
import { CodingToolsEditor, AddCodingToolsDialog } from "./coding-tools-editor";

interface SectionDef {
  id: string;
  /** Label in the tab nav — shorter than the section heading where it has to be. */
  tab: string;
  title: string;
  icon: LucideIcon;
  hint: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: "basics",
    tab: "Basics",
    title: "Basics",
    icon: IdCardLanyard,
    hint: "Your first impression — make it count.",
  },
  {
    id: "tags",
    tab: "Tags",
    title: "Tags",
    icon: Tag,
    hint: "Short badges that make you memorable at a glance.",
  },
  {
    id: "projects",
    tab: "Projects",
    title: "Projects",
    icon: FolderGit2,
    hint: "An opportunity to show clients real work, not just claims.",
  },
  {
    id: "experience",
    tab: "Experience",
    title: "Experience",
    icon: BriefcaseBusiness,
    hint: "Past roles that back up what you say you can do.",
  },
  {
    id: "education",
    tab: "Education",
    title: "Education",
    icon: GraduationCap,
    hint: "Your academic background.",
  },
  {
    id: "tools",
    tab: "Stack",
    title: "Tool Stack",
    icon: Terminal,
    hint: "The tools clients can expect to work in.",
  },
];

export function ProfileSetup() {
  const { draft, accountDisplayName, saveState } = useProfileDraft();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [active, setActive] = useState(SECTIONS[0].id);

  const strength = useMemo(
    () =>
      computeStrength({
        displayName: draft.displayName,
        headline: draft.headline,
        bio: draft.bio,
        linkedinUrl: draft.linkedinUrl,
        githubUrl: draft.githubUrl,
        portfolioUrl: draft.portfolioUrl,
        tags: draft.tags,
        projects: draft.projects,
        experience: draft.experience,
        education: draft.education,
        codingTools: draft.codingTools,
        avatarUrl: draft.avatarUrl,
        hasResume: draft.hasResume,
      }),
    [draft]
  );
  const doneByKey = useMemo(
    () => Object.fromEntries(strength.items.map((i) => [i.key, i.done])),
    [strength]
  );
  const left = strength.items.filter((i) => !i.done).length;

  // Scroll-spy: the topmost section whose top has crossed below the sticky
  // topbar is "active". The top offset tracks --topbar-height in globals.css —
  // if the topbar's height changes, this and .ss-sec's scroll-margin-top move.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id.replace("sec-", ""));
        }
      },
      { rootMargin: "-76px 0px -65% 0px", threshold: 0 }
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(`sec-${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) =>
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const displayName = draft.displayName.trim() || accountDisplayName;

  return (
    <>
      <div className="ss-head">
        <div className="inner">
          <div className="ss-top">
            <StrengthRing pct={strength.pct} />

            <div className="ss-meter">
              <div className={`ss-status${draft.isPublished ? " live" : ""}`}>
                <span className="dot" />
                {draft.isPublished ? "Published" : "Unpublished"}
              </div>
              <div className="ss-meter-lab">
                <b>Profile completion</b>
                <span className="ss-rule" aria-hidden />
                <span>
                  {left === 0
                    ? "Client-ready"
                    : `${left} field${left > 1 ? "s" : ""} left to complete`}
                </span>
              </div>
              <div className="ss-bar">
                <span style={{ width: `${strength.pct}%` }} />
              </div>
            </div>

            <Saver state={saveState} />

            <div className="ss-headacts">
              <button type="button" className="ss-btn" onClick={() => setPreviewOpen(true)}>
                <Eye /> Preview
              </button>
              <PublishMenu />
            </div>
          </div>

          <nav className="ss-tabs" aria-label="Profile sections">
            {SECTIONS.map((s) => {
              const done = doneByKey[SECTION_STRENGTH_KEY[s.id]];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`ss-tab${active === s.id ? " on" : ""}`}
                  onClick={() => jump(s.id)}
                  aria-current={active === s.id ? "true" : undefined}
                >
                  <s.icon />
                  {s.tab}
                  {done && <span className="tk" aria-label="complete" />}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="ss-page">
        <div className="ss-hero">
          <h1>Profile</h1>
          <p>
            Fields marked <span className="req">*</span> are required.
          </p>
        </div>

        <ProfileSection {...SECTIONS[0]}>
          <AvatarUpload avatarUrl={draft.avatarUrl} displayName={displayName} />
          <div className="ss-divider" />
          <BasicsForm />
          <ResumeUpload resumeFileName={draft.resumeFileName} />
        </ProfileSection>

        <ProfileSection {...SECTIONS[1]}>
          <TagsEditor />
        </ProfileSection>

        <ProfileSection {...SECTIONS[2]} actions={<ManualProjectForm />}>
          <GithubShowcaseEditor
            githubConnected={draft.githubConnected}
            githubUsername={draft.githubUsername}
            githubProjects={draft.projects.filter((p) => p.source === "github")}
            githubSyncedAt={draft.githubSyncedAt}
          />
          <ProjectList projects={draft.projects} />
        </ProfileSection>

        <ProfileSection {...SECTIONS[3]} actions={<ExperienceForm />}>
          <ExperienceEditor entries={draft.experience} />
        </ProfileSection>

        <ProfileSection
          {...SECTIONS[4]}
          actions={draft.education.length > 0 ? <EducationForm /> : undefined}
        >
          <EducationEditor entries={draft.education} />
        </ProfileSection>

        <ProfileSection {...SECTIONS[5]} actions={<AddCodingToolsDialog entries={draft.codingTools} />}>
          <CodingToolsEditor entries={draft.codingTools} />
        </ProfileSection>
      </div>

      <LivePreviewDrawer open={previewOpen} onOpenChange={setPreviewOpen} />
    </>
  );
}

function StrengthRing({ pct }: { pct: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    // NB: class is "pp-ring", not "ring" — "ring" collides with Tailwind's ring
    // utility, which paints a 1px box-shadow around the element.
    <div className="pp-ring" role="img" aria-label={`Profile ${pct}% complete`}>
      <svg width="56" height="56" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="8" style={{ stroke: "var(--surface-sunken)" }} />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ stroke: "var(--primary)", transition: "stroke-dashoffset .6s var(--ease-out-smooth)" }}
        />
      </svg>
      <span className="pct">{pct}%</span>
    </div>
  );
}

function Saver({ state }: { state: SaveState }) {
  const config: Record<SaveState, { Icon: LucideIcon; label: string }> = {
    idle: { Icon: CloudCheck, label: "Saved" },
    saving: { Icon: Loader2, label: "Saving…" },
    saved: { Icon: Check, label: "Saved" },
  };
  const { Icon, label } = config[state];
  return (
    <span className="saver" data-state={state}>
      <Icon /> {label}
    </span>
  );
}
