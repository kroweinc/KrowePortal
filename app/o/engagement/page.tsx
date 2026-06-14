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
import { getSignedDocsForEngagement } from "@/lib/actions/operator-docs";
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

  const engagement = ((engagements ?? []) as Engagement[])[0];

  // Read-through to the linked project. Both actions authorize engagement
  // membership and read RLS-restricted project data via the admin client.
  // Operators see the final, signed documents — the ones they signed follow the
  // engagement here; drafts stay builder-internal.
  const builder = engagement ? await getBuilderBasicsForEngagement(engagement) : null;
  const signed = engagement ? await getSignedDocsForEngagement(engagement) : null;

  const docItems: EngagementDocItem[] = [];
  if (signed?.prd?.token) {
    docItems.push({
      id: signed.prd.id,
      title: signed.prd.title,
      status: signed.prd.status,
      meta: docMeta(signed.prd),
      href: `/prd/${signed.prd.token}`,
    });
  }
  if (signed?.quote?.token) {
    docItems.push({
      id: signed.quote.id,
      title: signed.quote.title,
      status: signed.quote.status,
      meta: quoteDocMeta(signed.quote),
      href: `/quotes/${signed.quote.token}`,
    });
  }
  if (signed?.contract?.token) {
    docItems.push({
      id: signed.contract.id,
      title: signed.contract.title,
      status: signed.contract.status,
      meta: docMeta(signed.contract),
      href: `/contract/${signed.contract.token}`,
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
                Who you&apos;re working with and the documents you&apos;ve signed.
              </span>
            </div>
          </div>
        </div>

        {engagement ? (
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
              <EngagementDocuments
                items={docItems}
                emptyLabel="No signed documents yet — they'll appear here once you sign them."
              />
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
