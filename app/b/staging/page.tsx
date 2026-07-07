import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMyEngagements } from "@/lib/actions/invitations";
import { getSubmitterAvatarMap, attachCreatorAvatars } from "@/lib/submitter-avatars";
import {
  getCachedBranchPurposes,
  getBranchesByEngagement,
} from "@/lib/actions/get-engagement-branches";
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

  const { data } = await supabase
    .from("tasks")
    .select(
      "*, task_attachments(id, is_deliverable, file_name), creator:profiles!created_by(display_name, role), staging_group:staging_groups(name)"
    )
    .eq("status", "done")
    .or(filter)
    .order("completed_at", { ascending: false, nullsFirst: false });

  const rows = (data ?? []) as Task[];
  const avatars = await getSubmitterAvatarMap(rows.map((t) => t.created_by));
  const tasks = attachCreatorAvatars(rows, avatars);

  // Staging groups for the builder's engagements, plus the cached repo branch
  // lists — both preloaded so the detail sheet paints with no fetch.
  const { data: groupRows } =
    engagementIds.length > 0
      ? await supabase
          .from("staging_groups")
          .select("id, engagement_id, name, sort_order, created_at")
          .in("engagement_id", engagementIds)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : { data: [] };
  const stagingGroups = (groupRows ?? []) as StagingGroup[];
  const branchesByEngagement = await getBranchesByEngagement(engagementList);

  // Branch "purpose" one-liners for the group subtitles — read-only from the
  // cache for every repo linked to an engagement (no AI generation on load).
  const repoNames = Array.from(
    new Set(
      engagementList
        .map((e) => e.github_repo_full_name)
        .filter((n): n is string => Boolean(n))
    )
  );
  const purposeMaps = await Promise.all(repoNames.map((r) => getCachedBranchPurposes(r)));
  const purposes: Record<string, string> = Object.assign({}, ...purposeMaps);

  return (
    <main className="krowe-page krowe-page-grid">
      <div className="krowe-page-inner">
        <div className="krowe-board-head">
          <div className="krowe-board-titlewrap">
            <h1 className="krowe-board-title">Staging</h1>
            <div className="krowe-board-sub">
              <span>Done work, grouped by branch.</span>
              <span className="sep">·</span>
              <span>See what&apos;s queued for the next push.</span>
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
        />
      </div>
    </main>
  );
}
