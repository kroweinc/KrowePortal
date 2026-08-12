import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMyEngagements } from "@/lib/actions/invitations";
import { getSubmitterAvatarMap, attachCreatorAvatars } from "@/lib/submitter-avatars";
import {
  getCachedBranchPurposes,
  getBranchesByEngagement,
  warmEngagementBranches,
} from "@/lib/actions/get-engagement-branches";
import { getReleasesByEngagement } from "@/lib/actions/releases";
import { getPendingReleaseGaps } from "@/lib/actions/get-release-gaps";
import { StagingBoard } from "@/components/staging-board";
import type { Task, StagingGroup } from "@/lib/types";

export const metadata = { title: "Staging" };

export default async function StagingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const engagementList = await getMyEngagements();
  const engagementIds = engagementList.map((e) => e.id);

  // Same scoping rule as the build board: engagement tasks the builder is on,
  // plus their own personal (no-engagement) tasks. Restricted to done tasks —
  // staging is only about completed work.
  const personalFilter = `and(engagement_id.is.null,created_by.eq.${profile.id})`;
  const filter = engagementIds.length > 0
    ? `engagement_id.in.(${engagementIds.join(",")}),${personalFilter}`
    : personalFilter;

  // Branch "purpose" one-liners for the group subtitles — read-only from the
  // cache for every repo linked to an engagement (no AI generation on load).
  const repoNames = Array.from(
    new Set(
      engagementList
        .map((e) => e.github_repo_full_name)
        .filter((n): n is string => Boolean(n))
    )
  );

  // Five independent reads, run together. Nothing below needs anything else
  // below it — only the two chains kept inside their own branch do (tasks feed
  // the avatar lookup, releases feed the gap lookup, and the branch cache has to
  // be warm before it is read). Awaited one after another this page paid the sum
  // of nine round trips, one of them a GitHub sync; it now pays the longest
  // chain. That is the whole cost of accepting a "Not tracked" card too, since
  // the accept revalidates this route.
  const [tasks, stagingGroups, shipped, branchesByEngagement, purposeMaps] = await Promise.all([
    (async () => {
      const { data } = await supabase
        .from("tasks")
        .select(
          "*, task_attachments(id, is_deliverable, file_name), creator:profiles!created_by(display_name, role), staging_group:staging_groups(name), granola_import:granola_imports(id, granola_note_title, granola_created_at)"
        )
        .eq("status", "done")
        .or(filter)
        .order("completed_at", { ascending: false, nullsFirst: false });

      const rows = (data ?? []) as Task[];
      const avatars = await getSubmitterAvatarMap(rows.map((t) => t.created_by));
      return attachCreatorAvatars(rows, avatars);
    })(),
    // Staging groups for the builder's engagements, preloaded so the detail
    // sheet paints with no fetch.
    (async () => {
      if (engagementIds.length === 0) return [] as StagingGroup[];
      const { data } = await supabase
        .from("staging_groups")
        .select("id, engagement_id, name, sort_order, created_at")
        .in("engagement_id", engagementIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      return (data ?? []) as StagingGroup[];
    })(),
    // The pushes those done tasks went live in — drives the Shipped timeline —
    // and the work those pushes shipped with no task behind it. The gaps are
    // scoped to releases the read above already authorized, which is what lets
    // them use the admin client.
    (async () => {
      const releases = await getReleasesByEngagement(engagementIds);
      const gapsByRelease = await getPendingReleaseGaps(releases.map((r) => r.id));
      return { releases, gapsByRelease };
    })(),
    // Unlike the other boards, this page *renders* a bucket per live branch — a
    // branch deleted on GitHub would show up as an empty group. So freshen
    // before reading rather than in `after()`: the check is two queries when the
    // cache is current, and one GitHub request when it isn't.
    (async () => {
      await warmEngagementBranches();
      return getBranchesByEngagement(engagementList);
    })(),
    Promise.all(repoNames.map((r) => getCachedBranchPurposes(r))),
  ]);

  const { releases, gapsByRelease } = shipped;
  const purposes: Record<string, string> = Object.assign({}, ...purposeMaps);

  return (
    <main className="krowe-page krowe-page-grid">
      <div className="krowe-page-inner">
        <div className="krowe-board-head">
          <div className="krowe-board-titlewrap">
            <h1 className="krowe-board-title">Staging</h1>
            <div className="krowe-board-sub">
              <span>Where done work is waiting, by branch.</span>
              <span className="sep">·</span>
              <span>And every push to main, with what went out in it.</span>
            </div>
          </div>
        </div>
        <StagingBoard
          tasks={tasks}
          engagements={engagementList}
          purposes={purposes}
          currentUserId={profile.id}
          stagingGroups={stagingGroups}
          branchesByEngagement={branchesByEngagement}
          releases={releases}
          gapsByRelease={gapsByRelease}
        />
      </div>
    </main>
  );
}
