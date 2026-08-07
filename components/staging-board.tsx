"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  GitBranch,
  Layers,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Rocket,
  RefreshCw,
  Merge,
  Ungroup,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { TaskCard } from "@/components/task-card";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import {
  createStagingGroup,
  renameStagingGroup,
  deleteStagingGroup,
} from "@/lib/actions/staging-groups";
import { combineReleases, splitRelease, renameRelease } from "@/lib/actions/releases";
import { parseMergedBranch } from "@/lib/github/merge-subject";
import { setTasksPushedToMain, pollMainMerges } from "@/lib/actions/tasks";
import { pollReleaseGaps } from "@/lib/actions/release-gaps";
import { ReleaseGapCard } from "@/components/release-gap-card";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";
import {
  groupTasksByBranch,
  groupTasksByStagingGroup,
  groupTasksByRelease,
  groupReleasesByDay,
  type TaskBucket,
  type ReleaseBucket,
  type ReleaseDay,
} from "@/lib/tasks/staging-grouping";
import type { Task, Engagement, StagingGroup, Release, ReleaseGap } from "@/lib/types";

interface StagingBoardProps {
  tasks: Task[];
  engagements: Engagement[];
  // branch name → AI "purpose" one-liner, used as the branch group subtitle.
  purposes: Record<string, string>;
  currentUserId: string;
  // All staging groups across the builder's engagements.
  stagingGroups: StagingGroup[];
  // Cached repo branches keyed by engagement id, for the detail sheet chips.
  branchesByEngagement: Record<string, PreloadedBranches>;
  // Every push these tasks went live in — drives the Shipped timeline.
  releases: Release[];
  // Proposed tasks for work a push shipped with nothing tracking it, by release.
  gapsByRelease: Record<string, ReleaseGap[]>;
}

type GroupMode = "branch" | "staging";

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// UTC everywhere, matching how groupTasksByRelease buckets days — a local-time
// format would render differently on the server and the client.
const SHIP_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// Weekday too on a day header: it's the row a builder scans to find "the Friday
// push", and it has the width for it where a per-release chip did not.
const SHIP_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const SHIP_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function shipDate(iso: string): string {
  return SHIP_DATE.format(new Date(iso));
}

/**
 * The branch a push carried, for the meta line.
 *
 * `branch_name` is the recorded answer but it is often null when one exists:
 * the Phase 9 reconstruction left it unset, and the column only ever held what
 * a merge subject already says. So fall back to re-reading the subject — saying
 * "direct push to main" above a row titled "Merge branch 'dev' into main" is
 * worse than saying nothing. Null means genuinely no branch to name.
 */
function mergedBranch(release: Release): string | null {
  if (release.branch_name) return release.branch_name;
  return release.merge_subject ? parseMergedBranch(release.merge_subject) : null;
}

function shipDayLabel(iso: string): string {
  return SHIP_DAY.format(new Date(iso));
}

// The clock time a push landed — what separates two pushes on the same day now
// that the date has moved up to the header. Suffixed so it can't be misread as
// the viewer's local time, since the whole timeline is bucketed in UTC.
function shipTime(iso: string): string {
  return `${SHIP_TIME.format(new Date(iso))} UTC`;
}

export function StagingBoard({
  tasks,
  engagements,
  purposes,
  currentUserId,
  stagingGroups,
  branchesByEngagement,
  releases,
  gapsByRelease,
}: StagingBoardProps) {
  const engagementMap = new Map(engagements.map((e) => [e.id, e.title]));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));

  // Group management UI state.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Shipped timeline: pick two or more pushes and fold them into one named
  // release. Only real releases are selectable — a per-day bucket has no row to
  // combine. Renaming reuses the same inline-edit shape as staging groups.
  const [selectedReleases, setSelectedReleases] = useState<Set<string>>(new Set());
  const [combineTitle, setCombineTitle] = useState("");
  const [namingCombine, setNamingCombine] = useState(false);
  const [renamingReleaseId, setRenamingReleaseId] = useState<string | null>(null);
  const [releaseName, setReleaseName] = useState("");

  // Days start open — the timeline is the point of the page. Collapsing is for
  // getting a long history out of the way, so only what's shut is tracked.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  function toggleDay(key: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRelease(id: string) {
    setSelectedReleases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetCombine() {
    setSelectedReleases(new Set());
    setCombineTitle("");
    setNamingCombine(false);
  }

  function doCombine() {
    const ids = Array.from(selectedReleases);
    const title = combineTitle.trim();
    if (ids.length < 2 || !title) return;
    startTransition(async () => {
      const res = await combineReleases(ids, title);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Combined ${plural(ids.length, "push", "pushes")} into “${title}”`);
      resetCombine();
      router.refresh();
    });
  }

  function doSplit(releaseId: string, label: string) {
    startTransition(async () => {
      const res = await splitRelease(releaseId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Split “${label}” back into its own pushes`);
      resetCombine();
      router.refresh();
    });
  }

  function doRenameRelease(releaseId: string) {
    const title = releaseName.trim();
    if (!title) {
      setRenamingReleaseId(null);
      return;
    }
    startTransition(async () => {
      const res = await renameRelease(releaseId, title);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setRenamingReleaseId(null);
      router.refresh();
    });
  }

  // Push auto-detect: on mount and whenever "Check for pushes" bumps the tick,
  // ask the server whether a new merge reached main and move everything waiting
  // in Next push to Shipped, toasting (with Undo) for each push.
  const [pollTick, setPollTick] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const ids = engagements.map((e) => e.id);
    if (ids.length === 0) return;
    let cancelled = false;
    let failed = false;
    // A tick past 0 is the button. Mount rides the cached read the layout sweep
    // already warmed; a press means "go and look now", and is also the only pass
    // that reports back when it found nothing — silence on mount is correct,
    // silence after a click is indistinguishable from a dead button.
    const manual = pollTick > 0;
    setChecking(true);

    // Runs even with Next push empty. Skipping the poll when nothing is queued
    // looks like a free win — there'd be no task to move — but the poll is also
    // what writes the release row, and a push carrying no queued work is exactly
    // the one the gap scan below exists to catch. The GitHub read is cached for
    // 300s and shared with the commit scan, so the "wasted" call is a lookup.
    pollMainMerges(ids, { fresh: manual })
      .then((results) => {
        if (cancelled) return [];
        for (const r of results) {
          const via = r.branch ? ` via ${r.branch}` : "";
          if (r.taskIds.length === 0) {
            // A real push that carried nothing queued. Deliberately doesn't
            // claim it lands under Shipped — a release with no tasks and no gaps
            // is dropped from the timeline — so it names what happens next
            // instead: the gap scan below is what can make it appear.
            toast.success(`New push to main${via}`, {
              description: "Nothing was queued for it — scanning what went out.",
            });
            continue;
          }
          toast.success(`Shipped ${plural(r.taskIds.length, "task")} to main${via}`, {
            action: {
              label: "Undo",
              onClick: () =>
                setTasksPushedToMain(r.taskIds, false).then(() => router.refresh()),
            },
          });
        }
        return results;
      })
      .catch(() => {
        failed = true;
        return [];
      })
      .then(async (results) => {
        if (manual && !cancelled && results.length === 0) {
          if (failed)
            toast.error("Couldn't reach GitHub", {
              description: "The push check didn't run. Try again in a moment.",
            });
          else
            toast.message("No new pushes", {
              description: "Nothing new on main since the last check.",
            });
        }
        // The fast half is done; release the button before the scan, which is an
        // AI call and takes seconds.
        if (!cancelled) setChecking(false);
        if (results.length > 0) router.refresh();

        // Strictly after the merge poll — that call is what records the releases
        // this reads, so a push detected a moment ago is scannable in this pass.
        const gaps = await pollReleaseGaps(ids).catch(() => ({ found: 0 }));
        if (cancelled || gaps.found === 0) return;
        toast.message(
          `Found ${plural(gaps.found, "thing")} that shipped without a task`,
          { description: "Look under the push it went out in." }
        );
        router.refresh();
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-runs only when the user hits "Check for pushes"; engagements/router are
    // stable for the life of the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollTick]);

  function shipBranch(g: TaskBucket) {
    const ids = g.tasks.map((t) => t.id);
    const label = g.label;
    startTransition(async () => {
      const res = await setTasksPushedToMain(ids, true);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Moved ${plural(res.movedIds.length, "task")} on ${label} to Shipped`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await setTasksPushedToMain(res.movedIds, false);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  const stagingGroupsByEngagement: Record<string, StagingGroup[]> = {};
  for (const g of stagingGroups) {
    (stagingGroupsByEngagement[g.engagement_id] ??= []).push(g);
  }

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id);
    else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const engagementFilter = searchParams.get("engagement");
  const mode: GroupMode = searchParams.get("group") === "staging" ? "staging" : "branch";
  const hasPersonalTasks = tasks.some((t) => t.engagement_id === null);
  const visibleTasks =
    engagementFilter === null
      ? tasks
      : engagementFilter === "personal"
        ? tasks.filter((t) => t.engagement_id === null)
        : tasks.filter((t) => t.engagement_id === engagementFilter);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  // The engagement a new group is created under — the selected filter, or the
  // sole engagement. Null when it's ambiguous ("All"/"Personal" + many clients).
  const activeEngagementId =
    engagementFilter && engagementFilter !== "personal"
      ? engagementFilter
      : engagements.length === 1
        ? engagements[0].id
        : null;

  // Staging mode: include every group for the visible engagements — even empty
  // ones — so you can see and manage groups before assigning tasks.
  const visibleGroupDefs =
    engagementFilter === null
      ? stagingGroups
      : engagementFilter === "personal"
        ? []
        : stagingGroups.filter((g) => g.engagement_id === engagementFilter);

  const showFilters =
    engagements.length > 1 || (engagements.length > 0 && hasPersonalTasks);

  function doCreate() {
    const name = newName.trim();
    if (!name || !activeEngagementId) return;
    startTransition(async () => {
      const res = await createStagingGroup(activeEngagementId, name);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setNewName("");
      setCreating(false);
      router.refresh();
    });
  }

  function doRename(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    startTransition(async () => {
      const res = await renameStagingGroup(id, name);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setRenamingId(null);
      router.refresh();
    });
  }

  function doDelete(id: string) {
    startTransition(async () => {
      const res = await deleteStagingGroup(id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  function renderGroupActions(g: TaskBucket) {
    if (mode !== "staging" || g.groupId === null) return null;
    const id = g.groupId;
    if (renamingId === id) {
      return (
        <div className="krowe-stage-group-actions">
          <input
            aria-label="Rename staging group"
            className="krowe-stage-newgroup-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={80}
            disabled={isPending}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doRename(id);
              } else if (e.key === "Escape") {
                setRenamingId(null);
              }
            }}
          />
          <button
            type="button"
            className="krowe-stage-group-action"
            aria-label="Save name"
            disabled={isPending}
            onClick={() => doRename(id)}
          >
            <Check width={14} height={14} />
          </button>
          <button
            type="button"
            className="krowe-stage-group-action"
            aria-label="Cancel rename"
            disabled={isPending}
            onClick={() => setRenamingId(null)}
          >
            <X width={14} height={14} />
          </button>
        </div>
      );
    }
    if (confirmDeleteId === id) {
      return (
        <div className="krowe-stage-group-actions">
          <span className="krowe-stage-section-count">Delete group?</span>
          <button
            type="button"
            className="krowe-stage-group-action danger"
            aria-label="Confirm delete"
            disabled={isPending}
            onClick={() => doDelete(id)}
          >
            <Check width={14} height={14} />
          </button>
          <button
            type="button"
            className="krowe-stage-group-action"
            aria-label="Cancel delete"
            disabled={isPending}
            onClick={() => setConfirmDeleteId(null)}
          >
            <X width={14} height={14} />
          </button>
        </div>
      );
    }
    return (
      <div className="krowe-stage-group-actions">
        <button
          type="button"
          className="krowe-stage-group-action"
          aria-label={`Rename ${g.label}`}
          disabled={isPending}
          onClick={() => {
            setRenamingId(id);
            setRenameValue(g.label);
          }}
        >
          <Pencil width={13} height={13} />
        </button>
        <button
          type="button"
          className="krowe-stage-group-action danger"
          aria-label={`Delete ${g.label}`}
          disabled={isPending}
          onClick={() => setConfirmDeleteId(id)}
        >
          <Trash2 width={13} height={13} />
        </button>
      </div>
    );
  }

  function renderGroup(g: TaskBucket, section?: "staged" | "shipped") {
    const purpose = mode === "branch" && g.branch ? purposes[g.branch] : null;
    // A real branch queued for the next push can be shipped in one click.
    const canShip =
      mode === "branch" && section === "staged" && g.branch !== null && g.tasks.length > 0;
    const isEmpty = g.tasks.length === 0;
    return (
      <div key={g.key} className={`krowe-stage-group${isEmpty ? " is-empty" : ""}`}>
        <div className="krowe-stage-group-head">
          {mode === "branch" ? (
            <GitBranch width={14} height={14} strokeWidth={2} />
          ) : (
            <Layers width={14} height={14} strokeWidth={2} />
          )}
          <span className="krowe-stage-branch">{g.label}</span>
          {purpose && <span className="krowe-stage-purpose">{purpose}</span>}
          <span className="krowe-stage-count">{g.tasks.length}</span>
          {renderGroupActions(g)}
          {canShip && (
            <button
              type="button"
              className="krowe-stage-ship"
              disabled={isPending}
              onClick={() => shipBranch(g)}
            >
              <Rocket width={13} height={13} />
              Mark as pushed to main
            </button>
          )}
        </div>
        {g.tasks.length > 0 && (
          <div className="krowe-stage-cards">
            {g.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                role="builder"
                engagementTitle={engagementMap.get(task.engagement_id)}
                onSelect={(t) => syncSelected(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // One entry on the Shipped timeline. A real release is selectable and
  // nameable; the per-day and undated buckets are reconstructed history with no
  // row behind them, so they render quieter and carry no actions.
  function renderRelease(b: ReleaseBucket) {
    const release = b.release;
    const selected = release !== null && selectedReleases.has(release.id);
    const renaming = release !== null && renamingReleaseId === release.id;

    // The day header owns the date now, so the row says what the push *was*:
    // the builder's name for it, else the merge commit's subject, else the
    // branch it brought in — and only as a last resort the bare sha.
    const label =
      b.label ??
      (b.kind === "day"
        ? "Marked live individually"
        : b.kind === "unknown"
          ? "Earlier · date unknown"
          : release?.merge_sha
            ? `Push ${release.merge_sha.slice(0, 7)}`
            : "Marked live");

    // Which merge this was. A merge commit names the branch it brought in; a
    // plain push to main names none, and saying so beats an empty gap.
    const metaParts =
      b.kind === "day"
        ? ["No push recorded — marked live one by one"]
        : b.kind === "unknown"
          ? ["Shipped before pushes were tracked"]
          : release?.kind === "combined"
            ? [`${plural(b.children.length, "push", "pushes")} folded together`]
            : [
                release?.kind === "auto"
                  ? (mergedBranch(release) ?? "direct push to main")
                  : (release?.branch_name ?? "marked live by hand"),
                release?.merge_sha?.slice(0, 7),
                b.shippedAt ? shipTime(b.shippedAt) : null,
              ];
    // Drop anything the label already says, so a branch-named push doesn't read
    // "dev · dev · 4:19 PM".
    const meta = metaParts
      .filter((p): p is string => Boolean(p) && p !== label)
      .join(" · ");

    return (
      <div
        key={b.key}
        className={`krowe-stage-group krowe-stage-release${
          selected ? " is-selected" : ""
        }${b.kind === "release" ? "" : " is-derived"}`}
      >
        <div className="krowe-stage-group-head">
          {release && (
            <input
              type="checkbox"
              className="krowe-stage-rel-check"
              checked={selected}
              disabled={isPending}
              aria-label={`Select ${label} to combine`}
              onChange={() => toggleRelease(release.id)}
            />
          )}
          {release?.kind === "combined" ? (
            <Layers width={14} height={14} strokeWidth={2} />
          ) : (
            <Rocket width={14} height={14} strokeWidth={2} />
          )}
          {renaming && release ? (
            <input
              aria-label="Rename release"
              className="krowe-stage-newgroup-input"
              value={releaseName}
              onChange={(e) => setReleaseName(e.target.value)}
              maxLength={120}
              disabled={isPending}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  doRenameRelease(release.id);
                } else if (e.key === "Escape") {
                  setRenamingReleaseId(null);
                }
              }}
            />
          ) : (
            <span className="krowe-stage-rel-name">{label}</span>
          )}
          {meta && <span className="krowe-stage-rel-meta">{meta}</span>}
          <span className="krowe-stage-count">{b.tasks.length}</span>
          {release && !renaming && (
            <div className="krowe-stage-group-actions">
              <button
                type="button"
                className="krowe-stage-group-action"
                aria-label={`Rename ${label}`}
                disabled={isPending}
                onClick={() => {
                  setRenamingReleaseId(release.id);
                  setReleaseName(release.title ?? "");
                }}
              >
                <Pencil width={13} height={13} />
              </button>
              {release.kind === "combined" && (
                <button
                  type="button"
                  className="krowe-stage-group-action"
                  aria-label={`Split ${label}`}
                  title="Split back into separate pushes"
                  disabled={isPending}
                  onClick={() => doSplit(release.id, label)}
                >
                  <Ungroup width={13} height={13} />
                </button>
              )}
            </div>
          )}
        </div>
        {b.children.length > 0 && (
          <ul className="krowe-stage-rel-kids">
            {b.children.map((c) => (
              <li key={c.id} className="krowe-stage-rel-kid">
                {c.merge_subject ?? c.branch_name ?? "push"}
                {c.merge_sha && <span className="sha"> · {c.merge_sha.slice(0, 7)}</span>}
                <span className="sha"> · {shipDate(c.shipped_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="krowe-stage-cards">
          {b.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              role="builder"
              engagementTitle={engagementMap.get(task.engagement_id)}
              onSelect={(t) => syncSelected(t.id)}
            />
          ))}
          {/* Work this push carried that no task describes. One more cell in the
              same grid, on task-card metrics, so it reads as part of the push
              rather than as a notice bolted underneath. */}
          {b.gaps.map((gap) => (
            <ReleaseGapCard key={gap.id} gap={gap} pushLabel={label} />
          ))}
        </div>
      </div>
    );
  }

  // A calendar day, with every push that landed on it nested underneath. Two
  // pushes on one date used to render as two identical-looking rows; the date
  // lives here now, and each push below identifies itself by its merge.
  function renderDay(day: ReleaseDay) {
    const collapsed = collapsedDays.has(day.key);
    const heading = day.shippedAt ? shipDayLabel(day.shippedAt) : "Date unknown";
    return (
      <section key={day.key} className="krowe-stage-day">
        <button
          type="button"
          className="krowe-stage-day-head"
          aria-expanded={!collapsed}
          onClick={() => toggleDay(day.key)}
        >
          <ChevronDown
            className={`krowe-stage-day-chevron${collapsed ? " is-collapsed" : ""}`}
            width={14}
            height={14}
            strokeWidth={2.2}
            aria-hidden="true"
          />
          <span className="krowe-stage-day-label">{heading}</span>
          <span className="krowe-stage-day-count">
            {plural(day.pushes.length, "push", "pushes")} ·{" "}
            {plural(day.taskCount, "task")}
          </span>
          {/* A collapsed day still says there is something to look at inside. */}
          {day.gapCount > 0 && (
            <span className="krowe-stage-day-gaps">
              {day.gapCount} not tracked
            </span>
          )}
          <span className="krowe-stage-rule" />
        </button>
        {!collapsed && (
          <div className="krowe-stage-groups">{day.pushes.map(renderRelease)}</div>
        )}
      </section>
    );
  }

  function renderShippedSection(buckets: ReleaseBucket[]) {
    const total = buckets.reduce((n, b) => n + b.tasks.length, 0);
    const days = groupReleasesByDay(buckets);
    const selectedCount = selectedReleases.size;
    return (
      <section className="krowe-stage-section">
        <div className="krowe-stage-section-head">
          <span className="krowe-stage-badge shipped">Shipped</span>
          {buckets.length > 0 && (
            <span className="krowe-stage-section-count">
              {plural(days.length, "day")} · {plural(buckets.length, "push", "pushes")}{" "}
              · {plural(total, "task")}
            </span>
          )}
          <span className="krowe-stage-rule" />
          {selectedCount >= 2 &&
            (namingCombine ? (
              <div className="krowe-stage-newgroup-edit">
                <input
                  aria-label="Name for the combined release"
                  value={combineTitle}
                  onChange={(e) => setCombineTitle(e.target.value)}
                  placeholder="e.g. Security + staging UI"
                  maxLength={120}
                  disabled={isPending}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      doCombine();
                    } else if (e.key === "Escape") {
                      setNamingCombine(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="krowe-stage-groupby-btn active"
                  disabled={isPending || !combineTitle.trim()}
                  onClick={doCombine}
                >
                  Combine
                </button>
                <button
                  type="button"
                  className="krowe-staging-cancel"
                  disabled={isPending}
                  onClick={() => setNamingCombine(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="krowe-stage-combinebar">
                <button
                  type="button"
                  className="krowe-stage-check"
                  disabled={isPending}
                  onClick={() => setNamingCombine(true)}
                >
                  <Merge width={13} height={13} />
                  Combine {selectedCount} into one release
                </button>
                <button
                  type="button"
                  className="krowe-staging-cancel"
                  disabled={isPending}
                  onClick={resetCombine}
                >
                  Clear
                </button>
              </div>
            ))}
        </div>
        {buckets.length === 0 ? (
          <div className="krowe-stage-empty">
            Nothing shipped yet — once a branch lands on main, the push and everything
            in it show up here.
          </div>
        ) : (
          <div className="krowe-stage-days">{days.map(renderDay)}</div>
        )}
      </section>
    );
  }

  function renderStagedSection(groups: TaskBucket[]) {
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);
    return (
      <section className="krowe-stage-section">
        <div className="krowe-stage-section-head">
          <span className="krowe-stage-badge staged">Next push</span>
          {groups.length > 0 && (
            <span className="krowe-stage-section-count">
              {plural(groups.length, "branch", "branches")} · {plural(total, "task")}
            </span>
          )}
          <span className="krowe-stage-rule" />
          {engagements.length > 0 && (
            <button
              type="button"
              className="krowe-stage-check"
              disabled={checking}
              onClick={() => setPollTick((n) => n + 1)}
              title="Check GitHub for branches merged into main"
            >
              <RefreshCw width={13} height={13} />
              {checking ? "Checking…" : "Check for pushes"}
            </button>
          )}
        </div>
        {groups.length === 0 ? (
          <div className="krowe-stage-empty">
            Nothing queued — completed work that isn&apos;t pushed to main shows up here.
          </div>
        ) : (
          <div className="krowe-stage-groups">
            {groups.map((g) => renderGroup(g, "staged"))}
          </div>
        )}
      </section>
    );
  }

  // Live branch names for the engagements currently in scope, so branch mode can
  // surface repo branches that have no queued work yet. Default branches are
  // excluded — main isn't a staging branch, it's where work is pushed to.
  const scopedEngagementIds =
    engagementFilter === null
      ? engagements.map((e) => e.id)
      : engagementFilter === "personal"
        ? []
        : [engagementFilter];
  const liveBranchNames: string[] = [];
  const excludeFromEmpty = new Set<string>();
  for (const eid of scopedEngagementIds) {
    const pb = branchesByEngagement[eid];
    if (!pb) continue;
    if (pb.defaultBranch) excludeFromEmpty.add(pb.defaultBranch);
    for (const b of pb.branches) liveBranchNames.push(b.name);
  }
  // A branch already shown under Shipped shouldn't reappear as an empty row.
  for (const t of visibleTasks) {
    if (t.pushed_to_main && t.branch_name) excludeFromEmpty.add(t.branch_name);
  }

  // Branch mode splits by pushed_to_main (queued vs shipped); staging mode shows
  // one list of groups (the group is the organizing unit, not the push state).
  const stagedGroups = groupTasksByBranch(
    visibleTasks.filter((t) => !t.pushed_to_main),
    liveBranchNames,
    excludeFromEmpty
  );
  // Shipped work is grouped by the push it went live in, not by branch — that's
  // the whole point of the timeline. Releases are scoped to the same filter as
  // the tasks so an "All"-only release can't leak into a single-client view.
  const visibleReleases =
    engagementFilter === null
      ? releases
      : engagementFilter === "personal"
        ? releases.filter((r) => r.engagement_id === null)
        : releases.filter((r) => r.engagement_id === engagementFilter);
  const shippedBuckets = groupTasksByRelease(
    visibleTasks.filter((t) => t.pushed_to_main),
    visibleReleases,
    gapsByRelease
  );
  const groups = groupTasksByStagingGroup(visibleTasks, visibleGroupDefs);

  // Flat, on-screen order of task ids for the sheet's prev/next stepping. Empty
  // branch rows contribute nothing, so navigation walks only real tasks.
  const orderedIds =
    mode === "branch"
      ? [
          ...stagedGroups.flatMap((g) => g.tasks.map((t) => t.id)),
          ...shippedBuckets.flatMap((b) => b.tasks.map((t) => t.id)),
        ]
      : groups.flatMap((g) => g.tasks.map((t) => t.id));

  return (
    <>
      <div className="krowe-stage-toolbar">
        <div className="krowe-stage-groupby">
          <span className="krowe-stage-groupby-label">Group by</span>
          <div className="krowe-stage-groupby-seg" role="group" aria-label="Group by">
            <button
              type="button"
              className={`krowe-stage-groupby-btn ${mode === "branch" ? "active" : ""}`}
              aria-pressed={mode === "branch"}
              onClick={() => setParam("group", null)}
            >
              Branch
            </button>
            <button
              type="button"
              className={`krowe-stage-groupby-btn ${mode === "staging" ? "active" : ""}`}
              aria-pressed={mode === "staging"}
              onClick={() => setParam("group", "staging")}
            >
              Staging
            </button>
          </div>
        </div>

        {mode === "staging" &&
          (creating ? (
            <div className="krowe-stage-newgroup-edit">
              <input
                aria-label="New staging group name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Group name (e.g. Release 1.2)"
                maxLength={80}
                disabled={isPending}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doCreate();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
              />
              <button
                type="button"
                className="krowe-stage-groupby-btn active"
                disabled={isPending || !newName.trim()}
                onClick={doCreate}
              >
                Add
              </button>
              <button
                type="button"
                className="krowe-staging-cancel"
                disabled={isPending}
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="krowe-stage-newgroup"
              disabled={!activeEngagementId}
              title={
                activeEngagementId
                  ? undefined
                  : "Pick a client above to add a group"
              }
              onClick={() => setCreating(true)}
            >
              <Plus width={14} height={14} />
              New group
            </button>
          ))}
      </div>

      {showFilters && (
        <div className="krowe-filter-row">
          <button
            type="button"
            className={`krowe-filter-chip ${engagementFilter === null ? "active" : ""}`}
            onClick={() => setParam("engagement", null)}
          >
            All <span className="count">{tasks.length}</span>
          </button>
          {engagements.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`krowe-filter-chip ${engagementFilter === e.id ? "active" : ""}`}
              onClick={() => setParam("engagement", e.id)}
            >
              {e.title}{" "}
              <span className="count">{tasks.filter((t) => t.engagement_id === e.id).length}</span>
            </button>
          ))}
          {hasPersonalTasks && (
            <button
              type="button"
              className={`krowe-filter-chip ${engagementFilter === "personal" ? "active" : ""}`}
              onClick={() => setParam("engagement", "personal")}
            >
              Personal{" "}
              <span className="count">{tasks.filter((t) => t.engagement_id === null).length}</span>
            </button>
          )}
        </div>
      )}

      {mode === "branch" ? (
        stagedGroups.length === 0 && shippedBuckets.length === 0 ? (
          <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
            Nothing here yet — finish a task and it lands in staging, ready to group by branch.
          </div>
        ) : (
          <div className="krowe-stage-wrap">
            {renderStagedSection(stagedGroups)}
            {renderShippedSection(shippedBuckets)}
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="krowe-column-empty" style={{ maxWidth: 420 }}>
          {activeEngagementId
            ? "No staging groups yet — add one above, then assign done tasks to it from the task’s deliverable."
            : "Pick a client above to create and manage its staging groups."}
        </div>
      ) : (
        <div className="krowe-stage-wrap">
          <div className="krowe-stage-groups">
            {groups.map((g) => renderGroup(g))}
          </div>
        </div>
      )}

      <TaskDetailSheet
        task={selectedTask}
        role="builder"
        currentUserId={currentUserId}
        engagementTitle={selectedTask ? engagementMap.get(selectedTask.engagement_id) : undefined}
        onOpenChange={(open) => !open && syncSelected(null)}
        branchesByEngagement={branchesByEngagement}
        stagingGroupsByEngagement={stagingGroupsByEngagement}
        siblingIds={orderedIds}
        onNavigate={syncSelected}
      />
    </>
  );
}
