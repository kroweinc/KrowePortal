import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getClientChangelog } from "@/lib/actions/releases";
import type { Engagement } from "@/lib/types";

export const metadata = { title: "Shipped" };

// UTC so a push never appears to land on a different day than the builder's
// board says it did.
const SHIP_DATE = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export default async function OperatorChangelog({
  searchParams,
}: {
  searchParams: Promise<{ engagement?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data } = await supabase
    .from("engagements")
    .select("*")
    .eq("operator_id", profile.id)
    .order("created_at", { ascending: true });

  const engagements = (data ?? []) as Engagement[];
  const { engagement: requested } = await searchParams;
  const active =
    engagements.find((e) => e.id === requested) ?? engagements[0] ?? null;

  // getClientChangelog re-checks membership and drops releases with no tasks,
  // so an idempotency tombstone never renders as a push that shipped nothing.
  const entries = active ? await getClientChangelog(active.id) : [];
  const totalTasks = entries.reduce((n, e) => n + e.tasks.length, 0);

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner" style={{ maxWidth: 860 }}>
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">Shipped</h1>
            <div className="krowe-page-sub">
              <span>
                {entries.length === 0
                  ? "Everything that has gone live on your project."
                  : `${totalTasks} ${totalTasks === 1 ? "change" : "changes"} across ${
                      entries.length
                    } ${entries.length === 1 ? "release" : "releases"}.`}
              </span>
            </div>
          </div>
        </div>

        {engagements.length > 1 && (
          <div className="krowe-filter-row">
            {engagements.map((e) => (
              <Link
                key={e.id}
                href={`/o/changelog?engagement=${e.id}`}
                className={`krowe-filter-chip ${active?.id === e.id ? "active" : ""}`}
              >
                {e.title}
              </Link>
            ))}
          </div>
        )}

        {entries.length === 0 ? (
          <div className="krowe-column-empty" style={{ maxWidth: 460 }}>
            Nothing has shipped yet. As soon as work goes live, each release shows up
            here with everything that landed in it.
          </div>
        ) : (
          <ol className="krowe-chg-list">
            {entries.map(({ release, children, tasks }) => (
              <li key={release.id} className="krowe-chg-entry">
                <div className="krowe-chg-head">
                  <h2 className="krowe-chg-title">
                    {release.title ?? release.branch_name ?? "Update"}
                  </h2>
                  <time className="krowe-chg-date" dateTime={release.shipped_at}>
                    {SHIP_DATE.format(new Date(release.shipped_at))}
                  </time>
                </div>
                {release.notes && <p className="krowe-chg-notes">{release.notes}</p>}
                {children.length > 1 && (
                  <p className="krowe-chg-meta">
                    Went out together as {children.length} pushes.
                  </p>
                )}
                <ul className="krowe-chg-tasks">
                  {tasks.map((t) => (
                    <li key={t.id} className="krowe-chg-task">
                      {t.type && (
                        <span className={`krowe-chg-type ${t.type}`}>{t.type}</span>
                      )}
                      <span className="krowe-chg-task-title">{t.title}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
