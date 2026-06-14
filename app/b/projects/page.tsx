import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjects } from "@/lib/actions/projects";
import { getProjectStages } from "@/lib/actions/begin-engagement";
import { DocumentsList, type DocRow, type DocStatus, type PipeState } from "./documents-list";
import type { ProjectPipeline, StageStatus } from "@/lib/project/stage";
import type { Project, ProjectStatus } from "@/lib/types";

export const metadata = { title: "Documents" };

const TONES = ["ink", "clay", "slate", "moss"] as const;

// active stays active, won stays won, everything else reads as "cold".
const STATUS_MAP: Record<ProjectStatus, DocStatus> = {
  active: "active",
  won: "won",
  lost: "cold",
  archived: "cold",
};
const STATUS_LABEL: Record<DocStatus, string> = { active: "Active", won: "Won", cold: "Cold" };

function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Stable per-project hue so a card keeps the same tone across renders.
function toneFor(id: string): (typeof TONES)[number] {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return TONES[sum % TONES.length];
}

// Map a pipeline stage's status onto a mini-pipeline dot. The engagement
// stage's "done" means the build is live → the warm primary dot.
function pipeState(status: StageStatus): PipeState {
  switch (status) {
    case "draft":
      return "draft";
    case "sent":
      return "sent";
    case "signed":
      return "signed";
    case "done":
      return "live";
    default:
      return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const week = 7 * day;
  if (diff < min) return "just now";
  if (diff < hr) {
    const n = Math.floor(diff / min);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hr);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  if (diff < week) {
    const n = Math.floor(diff / day);
    return n === 1 ? "yesterday" : `${n} days ago`;
  }
  if (diff < 2 * week) return "last week";
  if (diff < 8 * week) {
    const n = Math.floor(diff / week);
    return `${n} weeks ago`;
  }
  return `on ${formatDate(iso)}`;
}

// "Created …" until the row is meaningfully edited, then "Updated …".
function formatUpdated(createdAt: string, updatedAt: string): string {
  const edited = new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 60_000;
  return edited ? `Updated ${relative(updatedAt)}` : `Created ${formatDate(createdAt)}`;
}

function toRow(p: Project, pipeline?: ProjectPipeline): DocRow {
  const stages = pipeline?.stages ?? [];
  const hasPipeline = stages.length === 4;
  const pipe: PipeState[] = hasPipeline ? stages.map((s) => pipeState(s.status)) : [null, null, null, null];
  const currentStage = pipeline?.stages.find((s) => s.key === pipeline.current);
  const status = STATUS_MAP[p.status];

  return {
    id: p.id,
    name: p.name,
    initials: initialsFromName(p.name),
    tone: toneFor(p.id),
    website: p.website_url,
    client: p.prospect_name,
    status,
    statusLabel: STATUS_LABEL[status],
    stageLabel: currentStage?.label ?? null,
    updated: formatUpdated(p.created_at, p.updated_at),
    pipe,
    pipeLabels: hasPipeline ? stages.map((s) => s.label) : ["PRD", "Quote", "Contract", "Client"],
    docsDone: pipe.filter(Boolean).length,
  };
}

export default async function ProjectsListPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const projects = await getProjects();
  const stages = await getProjectStages(projects.map((p) => p.id));

  // Surface the most recently touched documents first to honor the
  // "Recently updated" sort the list advertises.
  const rows = [...projects]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((p) => toRow(p, stages[p.id]));

  const ownerName = profile.display_name?.trim() || "You";
  const owner = { name: ownerName, initials: initialsFromName(ownerName) };

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <DocumentsList rows={rows} owner={owner} />
      </div>
    </main>
  );
}
