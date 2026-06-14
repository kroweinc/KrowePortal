"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  Check,
  Cloud,
  Eye,
  FolderGit2,
  GraduationCap,
  Loader2,
  Sparkles,
  Terminal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Ember } from "@/components/design-atoms";
import { Button } from "@/components/ui/button";
import { computeStrength, SECTION_STRENGTH_KEY } from "@/lib/builder-profile/profile-strength";
import { useProfileDraft, type SaveState } from "./profile-draft-context";
import { ProfileSection } from "./profile-section";
import { ProfileShareStrip } from "./profile-share-strip";
import { LivePreviewDrawer } from "./live-preview-drawer";
import { AvatarUpload } from "./avatar-upload";
import { BasicsForm } from "./basics-form";
import { TagsEditor } from "./tags-editor";
import { GithubShowcaseEditor } from "./github-showcase-editor";
import { ManualProjectForm } from "./manual-project-form";
import { ProjectList } from "./project-list";
import { ExperienceEditor } from "./experience-editor";
import { EducationForm } from "./education-form";
import { CodingToolsEditor } from "./coding-tools-editor";
import { ResumeUpload } from "./resume-upload";

interface SectionDef {
  id: string;
  title: string;
  icon: LucideIcon;
  hint: string;
  clay?: boolean;
  accent?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: "basics", title: "Basics", icon: UserRound, hint: "How you introduce yourself to clients.", clay: true },
  { id: "tags", title: "Tags", icon: Sparkles, hint: "Short badges that highlight what you've done.", clay: true, accent: true },
  { id: "projects", title: "Projects", icon: FolderGit2, hint: "GitHub repos carry a verified badge with real stats." },
  { id: "experience", title: "Experience", icon: BriefcaseBusiness, hint: "Previous roles, plus a resume clients can download." },
  { id: "education", title: "Education", icon: GraduationCap, hint: "Where you study — university or high school." },
  { id: "tools", title: "Coding tools", icon: Terminal, hint: "The tools you build with." },
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
        educationSchool: draft.educationSchool,
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
  // header is "active". rootMargin's top offset ≈ header height; the large
  // bottom offset keeps only one section lit at a time.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id.replace("sec-", ""));
        }
      },
      { rootMargin: "-130px 0px -65% 0px", threshold: 0 }
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
      <div className="ss-stick">
        <div className="inner">
          <div className="ss-top">
            <div className="strength">
              <StrengthRing pct={strength.pct} />
            </div>
            <div className="strwrap">
              <div className="lab">
                <b>Profile strength</b>
                <span className="pct">{strength.pct}%</span>
                <span className="s">{left ? `· ${left} item${left > 1 ? "s" : ""} left` : "· client-ready"}</span>
              </div>
              <div className="strength-bar">
                <span style={{ width: `${strength.pct}%` }} />
              </div>
            </div>
            <Saver state={saveState} />
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-3.5 w-3.5" /> Live preview
            </Button>
          </div>
          <div className="ss-chips">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`ss-chip${active === s.id ? " on" : ""}`}
                onClick={() => jump(s.id)}
              >
                <span className={`tk${doneByKey[SECTION_STRENGTH_KEY[s.id]] ? " ok" : ""}`} />
                {s.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ss-page">
        <div className="ss-hero">
          <h1>
            <Ember size={14} animated /> Profile
          </h1>
          <div className="q">A shareable resume of your work — send it to clients.</div>
        </div>

        <ProfileShareStrip />

        <ProfileSection {...SECTIONS[0]}>
          <div className="space-y-4">
            <div className="border-b border-neutral-100 pb-4">
              <AvatarUpload avatarUrl={draft.avatarUrl} displayName={displayName} />
            </div>
            <BasicsForm />
          </div>
        </ProfileSection>

        <ProfileSection {...SECTIONS[1]}>
          <TagsEditor />
        </ProfileSection>

        <ProfileSection {...SECTIONS[2]} actions={<ManualProjectForm />}>
          <div className="space-y-4">
            <GithubShowcaseEditor
              githubConnected={draft.githubConnected}
              githubUsername={draft.githubUsername}
              githubProjects={draft.projects.filter((p) => p.source === "github")}
              githubSyncedAt={draft.githubSyncedAt}
            />
            <ProjectList projects={draft.projects} />
          </div>
        </ProfileSection>

        <ProfileSection {...SECTIONS[3]}>
          <div className="space-y-4">
            <ExperienceEditor entries={draft.experience} />
            <div className="border-t border-neutral-100 pt-4">
              <ResumeUpload resumeFileName={draft.resumeFileName} />
            </div>
          </div>
        </ProfileSection>

        <ProfileSection {...SECTIONS[4]}>
          <EducationForm />
        </ProfileSection>

        <ProfileSection {...SECTIONS[5]}>
          <CodingToolsEditor entries={draft.codingTools} />
        </ProfileSection>
      </div>

      <LivePreviewDrawer open={previewOpen} onOpenChange={setPreviewOpen} />
    </>
  );
}

function StrengthRing({ pct }: { pct: number }) {
  const r = 23;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    // NB: class is "pp-ring", not "ring" — "ring" collides with Tailwind's ring
    // utility, which paints a 1px box-shadow around the element.
    <div className="pp-ring">
      <svg width="56" height="56">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="6" style={{ stroke: "var(--surface-sunken)" }} />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="6"
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
    idle: { Icon: Cloud, label: "All changes saved" },
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
