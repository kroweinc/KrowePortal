import { ShareLinkCard } from "./share-link-card";
import { AvatarUpload } from "./avatar-upload";
import { BasicsForm } from "./basics-form";
import { GithubShowcaseEditor } from "./github-showcase-editor";
import { ManualProjectForm } from "./manual-project-form";
import { ProjectList } from "./project-list";
import { ExperienceEditor } from "./experience-editor";
import { EducationForm } from "./education-form";
import { CodingToolsEditor } from "./coding-tools-editor";
import { TagsEditor } from "./tags-editor";
import { ResumeUpload } from "./resume-upload";
import type { BuilderProfileBundle } from "@/lib/actions/builder-profile";

interface ProfileEditorProps {
  bundle: BuilderProfileBundle;
  displayName: string;
}

export function ProfileEditor({ bundle, displayName }: ProfileEditorProps) {
  const { profile, projects, experience, codingTools, githubConnected, githubUsername, avatarUrl, autoTags } =
    bundle;
  const githubProjects = projects.filter((p) => p.source === "github");

  return (
    <div className="space-y-6">
      <ShareLinkCard token={profile.token} isPublished={profile.is_published} />

      <Section title="Basics" hint="How you introduce yourself to clients.">
        <div className="space-y-4">
          <div className="border-b border-neutral-100 pb-4">
            <AvatarUpload avatarUrl={avatarUrl} displayName={displayName} />
          </div>
          <BasicsForm
            initialDisplayName={profile.display_name ?? ""}
            accountName={displayName}
            initialHeadline={profile.headline ?? ""}
            initialBio={profile.bio ?? ""}
            initialLinkedinUrl={profile.linkedin_url ?? ""}
            initialGithubUrl={profile.github_url ?? ""}
            initialPortfolioUrl={profile.portfolio_url ?? ""}
          />
        </div>
      </Section>

      <Section
        title="Tags"
        hint="Short badges that highlight what you've done. We add some automatically from the rest of your profile — add your own too."
      >
        <TagsEditor initialTags={profile.tags} autoTags={autoTags} />
      </Section>

      <Section
        title="Projects"
        hint="Repos synced from GitHub carry a verified badge with real commit and language stats."
        actions={<ManualProjectForm />}
      >
        <div className="space-y-4">
          <GithubShowcaseEditor
            githubConnected={githubConnected}
            githubUsername={githubUsername}
            githubProjects={githubProjects}
            githubSyncedAt={profile.github_synced_at}
          />
          <ProjectList projects={projects} />
        </div>
      </Section>

      <Section title="Experience" hint="Previous roles, plus a resume clients can download.">
        <div className="space-y-4">
          <ExperienceEditor entries={experience} />
          <div className="border-t border-neutral-100 pt-4">
            <ResumeUpload resumeFileName={profile.resume_file_name} />
          </div>
        </div>
      </Section>

      <Section title="Education" hint="Where you study — university or high school.">
        <EducationForm
          initialSchool={profile.education_school ?? ""}
          initialMajor={profile.education_major ?? ""}
          initialYear={profile.education_year ?? ""}
        />
      </Section>

      <Section
        title="Coding tools"
        hint="The tools you build with — AI assistants, editors, and infra clients will recognize."
      >
        <CodingToolsEditor entries={codingTools} />
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          {hint && <p className="text-xs text-neutral-500">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
