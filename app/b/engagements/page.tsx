import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Ember } from "@/components/design-atoms";
import { NewEngagementDialog } from "@/components/new-engagement-dialog";
import { getMyEngagements, getMyPendingInvites } from "@/lib/actions/invitations";
import { getMyBuilderIdentity } from "@/lib/actions/builder-profile";
import { EngagementCard } from "@/components/engagement/engagement-card";
import type { EngagementStatusKind } from "@/components/engagement/engagement-status";
import type { TaskStatus } from "@/lib/types";

export const metadata = { title: "Clients" };

export default async function EngagementsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const [engagements, pendingInvites, identity] = await Promise.all([
    getMyEngagements(),
    getMyPendingInvites(),
    getMyBuilderIdentity(),
  ]);

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const engagementIds = engagements.map((e) => e.id);
  const counts = new Map<string, { open: number; done: number }>();
  if (engagementIds.length > 0) {
    const { data: taskRows } = await supabase
      .from("tasks")
      .select("engagement_id, status")
      .in("engagement_id", engagementIds);
    for (const row of taskRows ?? []) {
      const id = row.engagement_id as string;
      const entry = counts.get(id) ?? { open: 0, done: 0 };
      if ((row.status as TaskStatus) === "done") entry.done += 1;
      else entry.open += 1;
      counts.set(id, entry);
    }
  }

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Clients
            </h1>
            <div className="krowe-page-sub">
              <span>
                {engagements.length} client{engagements.length !== 1 ? "s" : ""}
              </span>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Every business owner you&apos;re building with.
              </span>
            </div>
          </div>
          <div data-tour="new-engagement">
            <NewEngagementDialog />
          </div>
        </div>

        {engagements.length === 0 ? (
          <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
            No clients yet — create one and send the invite link to a business owner.
          </div>
        ) : (
          <div className="eng-list">
            {engagements.map((engagement) => {
              const operatorName = engagement.operator?.display_name ?? null;
              const invite = pendingInvites[engagement.id];
              const count = counts.get(engagement.id) ?? { open: 0, done: 0 };
              const statusKind: EngagementStatusKind = operatorName
                ? "live"
                : invite
                  ? "pend"
                  : "none";
              const statusLabel = operatorName
                ? `With ${operatorName}`
                : invite
                  ? "Invite pending"
                  : "No operator yet";
              return (
                <EngagementCard
                  key={engagement.id}
                  id={engagement.id}
                  title={engagement.title}
                  websiteUrl={engagement.project?.website_url}
                  businessName={engagement.project?.prospect_name ?? engagement.project?.name}
                  statusKind={statusKind}
                  statusLabel={statusLabel}
                  repo={engagement.github_repo_full_name}
                  open={count.open}
                  done={count.done}
                  badgeUrl={identity?.avatarUrl ?? null}
                  badgeInitials={identity?.initials ?? "•"}
                />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
