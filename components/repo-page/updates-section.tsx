import {
  ArrowUpRight,
  Bug,
  GitPullRequestArrow,
  History,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActivityDay, CommitCheck } from "@/lib/github/repo-insights";
import type { CommitTaskLink } from "@/lib/actions/commit-task-links";
import type { RepoContext } from "@/lib/github/types";
import type { TaskType } from "@/lib/types";
import { TASK_TYPE_LABELS } from "@/lib/utils";
import { SectionHead } from "./section-head";

type Commit = RepoContext["recentCommits"][number];

const TYPE_ICON: Record<TaskType, LucideIcon> = {
  feature: Sparkles,
  bug: Bug,
  change: GitPullRequestArrow,
};

const CI_LABEL: Record<CommitCheck, string> = {
  success: "Success",
  failure: "Fail",
  pending: "Running",
};

/** Quartile bucket for a day's commit count, 0 = nothing shipped. */
function heatLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

/**
 * Mon/Wed/Fri get a letter under the strip; the rest stay blank. Parsed
 * without a Z so it reads as the same local day the bucket was keyed on.
 */
function dayLetter(iso: string): string {
  const day = new Date(`${iso}T00:00:00`).getDay();
  if (day === 1) return "M";
  if (day === 3) return "W";
  if (day === 5) return "F";
  return "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function relative(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "updated recently";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  if (days < 7) return `updated ${days} days ago`;
  if (days < 14) return "updated last week";
  return `updated ${Math.floor(days / 7)} weeks ago`;
}

function ActivityCard({ activity }: { activity: ActivityDay[] }) {
  const max = activity.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="krowe-repo-card krowe-repo-activity">
      <div className="krowe-repo-card-head">
        <History size={13} strokeWidth={2} aria-hidden />
        <h3 className="krowe-repo-card-title krowe-repo-activity-title">
          Activity <span className="muted">(past 2w)</span>
        </h3>
      </div>

      <div className="krowe-repo-activity-body">
        <div className="krowe-repo-heat">
          <div className="krowe-repo-heat-row">
            {activity.map((day) => (
              <span
                key={day.date}
                className="krowe-repo-heat-cell"
                data-level={heatLevel(day.count, max)}
                title={`${day.date}: ${day.count} commit${day.count === 1 ? "" : "s"}`}
              />
            ))}
          </div>
          <div className="krowe-repo-heat-row" aria-hidden>
            {activity.map((day) => (
              <span key={day.date} className="krowe-repo-heat-day">
                {dayLetter(day.date)}
              </span>
            ))}
          </div>
        </div>

        <div className="krowe-repo-heat-scale">
          Less
          <span className="swatches" aria-hidden>
            {[0, 1, 2, 3, 4].map((lvl) => (
              <span key={lvl} className="krowe-repo-heat-cell" data-level={lvl} />
            ))}
          </span>
          More
        </div>
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  repoUrl,
  check,
  link,
}: {
  commit: Commit;
  repoUrl: string;
  check: CommitCheck | undefined;
  link: CommitTaskLink | undefined;
}) {
  const title = commit.message.split("\n")[0];
  const author = commit.author?.name ?? commit.author?.login ?? null;
  const TypeIcon = link?.taskType ? TYPE_ICON[link.taskType] : null;

  return (
    <a
      href={`${repoUrl}/commit/${commit.sha}`}
      target="_blank"
      rel="noreferrer"
      className="krowe-repo-commit"
    >
      <div className="krowe-repo-commit-main">
        <p className="krowe-repo-commit-title">{title}</p>
        <div className="krowe-repo-commit-meta">
          <span className="krowe-repo-avatars">
            <span className="av" title={author ?? "Unknown author"}>
              {author ? initials(author) : "?"}
            </span>
          </span>
          <span className="krowe-repo-commit-when">{relative(commit.date)}</span>
        </div>
      </div>

      <div className="krowe-repo-commit-chips">
        {check && <span className={`krowe-repo-chip ci-${check}`}>{CI_LABEL[check]}</span>}

        {link?.taskType && TypeIcon && (
          <span className="krowe-repo-chip type">
            <TypeIcon size={10} strokeWidth={2.25} aria-hidden />
            {TASK_TYPE_LABELS[link.taskType]}
          </span>
        )}

        {link?.role && <span className={`krowe-repo-chip role-${link.role}`}>{link.role}</span>}

        <span className="krowe-repo-sha">{commit.sha.slice(0, 7)}</span>
      </div>

      <span className="krowe-repo-commit-out" aria-hidden>
        <ArrowUpRight size={10} strokeWidth={3} />
      </span>
    </a>
  );
}

interface UpdatesSectionProps {
  commits: Commit[];
  activity: ActivityDay[];
  repoUrl: string;
  checks: Map<string, CommitCheck>;
  links: Map<string, CommitTaskLink>;
}

export function UpdatesSection({
  commits,
  activity,
  repoUrl,
  checks,
  links,
}: UpdatesSectionProps) {
  // Group by calendar day, preserving GitHub's newest-first ordering.
  const groups: { key: string; commits: Commit[] }[] = [];
  for (const commit of commits) {
    const key = new Date(commit.date).toDateString();
    const last = groups[groups.length - 1];
    if (last?.key === key) last.commits.push(commit);
    else groups.push({ key, commits: [commit] });
  }

  return (
    <div className="krowe-repo-section">
      <SectionHead icon={RefreshCw} title="Updates" />

      <div className="krowe-repo-updates">
        <ActivityCard activity={activity} />

        {groups.length === 0 ? (
          <div className="krowe-repo-card krowe-repo-empty">
            No commits on this branch yet.
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="krowe-repo-daygroup">
              <h3 className="krowe-repo-dayheading">{dayHeading(group.key)}</h3>
              <div className="krowe-repo-commits">
                {group.commits.map((commit) => (
                  <CommitRow
                    key={commit.sha}
                    commit={commit}
                    repoUrl={repoUrl}
                    check={checks.get(commit.sha)}
                    link={links.get(commit.sha)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
