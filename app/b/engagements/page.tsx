import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Ember } from "@/components/design-atoms";
import { NewEngagementDialog } from "@/components/new-engagement-dialog";
import { CreateInvitationDialog } from "@/components/create-invitation-dialog";
import { getMyEngagements, getMyPendingInvites } from "@/lib/actions/invitations";
import { BusinessContactCard } from "@/components/doc/business-contact-card";
import type { TaskStatus } from "@/lib/types";

export default async function EngagementsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const [engagements, pendingInvites] = await Promise.all([
    getMyEngagements(),
    getMyPendingInvites(),
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
              <Ember size={22} /> Engagements
            </h1>
            <div className="krowe-page-sub">
              <span>
                {engagements.length} engagement{engagements.length !== 1 ? "s" : ""}
              </span>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Every business owner you&apos;re building with.
              </span>
            </div>
          </div>
          <NewEngagementDialog />
        </div>

        {engagements.length === 0 ? (
          <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
            No engagements yet — create one and send the invite link to a business owner.
          </div>
        ) : (
          <div className="space-y-3">
            {engagements.map((engagement) => {
              const operatorName = engagement.operator?.display_name ?? null;
              const invite = pendingInvites[engagement.id];
              const count = counts.get(engagement.id) ?? { open: 0, done: 0 };
              return (
                <div
                  key={engagement.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/b/engagements/${engagement.id}`}
                      className="text-sm font-semibold text-neutral-900 hover:underline"
                    >
                      {engagement.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                      {operatorName ? (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                          With {operatorName}
                        </span>
                      ) : invite ? (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                          Invite pending
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2 w-2 rounded-full bg-neutral-300" />
                          No operator yet
                        </span>
                      )}
                      <span>
                        {count.open} open · {count.done} done
                      </span>
                      {engagement.project && (
                        <Link
                          href={`/b/projects/${engagement.project.id}`}
                          className="hover:text-neutral-900 hover:underline"
                        >
                          From {engagement.project.name}
                        </Link>
                      )}
                      {engagement.github_repo_full_name && (
                        <span className="font-mono">{engagement.github_repo_full_name}</span>
                      )}
                    </div>
                    {engagement.project && (
                      <BusinessContactCard
                        contact={engagement.project}
                        variant="inline"
                        className="mt-2"
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {!operatorName && (
                      <CreateInvitationDialog
                        engagementId={engagement.id}
                        existingToken={invite?.token}
                      />
                    )}
                    <Link
                      href={`/b?engagement=${engagement.id}`}
                      className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                    >
                      Tasks
                    </Link>
                    <Link
                      href={`/b/engagements/${engagement.id}`}
                      className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
