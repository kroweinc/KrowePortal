import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjects } from "@/lib/actions/projects";
import { getProjectStages } from "@/lib/actions/begin-engagement";
import { safeExternalHref } from "@/lib/project/business-context";
import { Ember } from "@/components/design-atoms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProjectPipeline } from "@/lib/project/stage";
import type { Project, ProjectStatus } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

const STATUS_VARIANT: Record<ProjectStatus, "secondary" | "sent" | "approved" | "blocked"> = {
  active: "sent",
  won: "approved",
  lost: "blocked",
  archived: "secondary",
};

export default async function ProjectsListPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const projects = await getProjects();
  const stages = await getProjectStages(projects.map((p) => p.id));

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Documents
            </h1>
            <div className="krowe-page-sub">
              <span>{projects.length} document{projects.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Prospective businesses you&apos;re preparing documents for.
              </span>
            </div>
          </div>
          <Link href="/b/projects/new">
            <Button>+ New document</Button>
          </Link>
        </div>

        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2 mt-4">
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} pipeline={stages[p.id]} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-white p-10 text-center mt-6">
      <p className="text-sm text-neutral-600 mb-1">No documents yet.</p>
      <p className="text-xs text-neutral-400 mb-5">
        Create a document for a business you&apos;re pitching, then draft a quote, PRD, and contract for it.
      </p>
      <Link href="/b/projects/new">
        <Button>+ Create your first document</Button>
      </Link>
    </div>
  );
}

function ProjectRow({ project, pipeline }: { project: Project; pipeline?: ProjectPipeline }) {
  const currentStage = pipeline?.stages.find((s) => s.key === pipeline.current);
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 transition-colors">
      <Link href={`/b/projects/${project.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-neutral-900 truncate">{project.name}</span>
          <Badge variant={STATUS_VARIANT[project.status]}>{STATUS_LABEL[project.status]}</Badge>
          {currentStage && (
            <Badge variant="secondary">
              {pipeline?.engagementStarted ? "Engagement live" : `Stage: ${currentStage.label}`}
            </Badge>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          {project.prospect_name ? <>{project.prospect_name} · </> : null}
          Created {formatDate(project.created_at)}
        </div>
      </Link>
      {project.live_url && (
        <a
          href={safeExternalHref(project.live_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-sm font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
        >
          View live ↗
        </a>
      )}
    </div>
  );
}
