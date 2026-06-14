import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Ember } from "@/components/design-atoms";
import { BuilderBasicsCard } from "@/components/engagement/builder-basics-card";
import {
  EngagementDocuments,
  type EngagementDocItem,
} from "@/components/doc/engagement-documents";
import { getBuilderBasicsForEngagement } from "@/lib/actions/operator-builder";
import {
  getSignedDocsForEngagements,
  getPendingDocsForEngagements,
} from "@/lib/actions/operator-docs";
import { docMeta, quoteDocMeta } from "@/lib/doc/doc-summary";
import type { Engagement } from "@/lib/types";

export const metadata = { title: "Builder" };

export default async function OperatorEngagementPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b/github");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data: engagements } = await supabase
    .from("engagements")
    .select("*")
    .eq("operator_id", profile.id)
    .order("created_at", { ascending: false });

  const engagementList = (engagements ?? []) as Engagement[];
  const primaryEngagement = engagementList[0];

  // Read-through to the linked projects. Both actions authorize engagement
  // membership and read RLS-restricted project data via the admin client, and
  // aggregate across ALL of the operator's engagements — so a client with a
  // "Shared space" invite plus one or more project engagements sees every
  // project's documents, not just the most recent engagement's. Pending
  // documents are the ones the builder has sent and is waiting on the operator
  // to sign; signed documents are the finalized ones; drafts stay
  // builder-internal. Builder basics stay scoped to the primary (newest)
  // engagement.
  const builder = primaryEngagement
    ? await getBuilderBasicsForEngagement(primaryEngagement)
    : null;
  const [signed, pending] = engagementList.length
    ? await Promise.all([
        getSignedDocsForEngagements(engagementList),
        getPendingDocsForEngagements(engagementList),
      ])
    : [null, null];

  const pendingItems: EngagementDocItem[] = [];
  for (const prd of pending?.prds ?? []) {
    if (!prd.token) continue;
    pendingItems.push({
      id: prd.id,
      title: prd.title,
      status: prd.status,
      meta: docMeta(prd),
      href: `/o/prd/${prd.token}`,
    });
  }
  for (const quote of pending?.quotes ?? []) {
    if (!quote.token) continue;
    pendingItems.push({
      id: quote.id,
      title: quote.title,
      status: quote.status,
      meta: quoteDocMeta(quote),
      href: `/o/quotes/${quote.token}`,
    });
  }
  for (const contract of pending?.contracts ?? []) {
    if (!contract.token) continue;
    pendingItems.push({
      id: contract.id,
      title: contract.title,
      status: contract.status,
      meta: docMeta(contract),
      href: `/o/contract/${contract.token}`,
    });
  }

  const docItems: EngagementDocItem[] = [];
  for (const prd of signed?.prds ?? []) {
    if (!prd.token) continue;
    docItems.push({
      id: prd.id,
      title: prd.title,
      status: prd.status,
      meta: docMeta(prd),
      href: `/o/prd/${prd.token}`,
    });
  }
  for (const quote of signed?.quotes ?? []) {
    if (!quote.token) continue;
    docItems.push({
      id: quote.id,
      title: quote.title,
      status: quote.status,
      meta: quoteDocMeta(quote),
      href: `/o/quotes/${quote.token}`,
    });
  }
  for (const contract of signed?.contracts ?? []) {
    if (!contract.token) continue;
    docItems.push({
      id: contract.id,
      title: contract.title,
      status: contract.status,
      meta: docMeta(contract),
      href: `/o/contract/${contract.token}`,
    });
  }

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner" style={{ maxWidth: 760 }}>
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Builder
            </h1>
            <div className="krowe-page-sub">
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Who you&apos;re working with and the documents on your engagement.
              </span>
            </div>
          </div>
        </div>

        {primaryEngagement ? (
          <div className="space-y-5">
            {builder ? (
              <BuilderBasicsCard builder={builder} />
            ) : (
              <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
                Builder details aren&apos;t available yet.
              </div>
            )}

            <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-neutral-900">Documents</h2>
              {pendingItems.length === 0 && docItems.length === 0 ? (
                <EngagementDocuments
                  items={[]}
                  emptyLabel="No documents yet — anything your builder sends will show up here to review."
                />
              ) : (
                <div className="space-y-4">
                  {pendingItems.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Awaiting your signature
                      </h3>
                      <EngagementDocuments items={pendingItems} />
                    </div>
                  )}
                  {docItems.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Signed
                      </h3>
                      <EngagementDocuments items={docItems} />
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
            No project yet — once your builder invites you, their profile and your signed
            documents will show here.
          </div>
        )}
      </div>
    </main>
  );
}
