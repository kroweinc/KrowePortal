import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getMyEngagement } from "@/lib/actions/invitations";
import {
  getAvailability,
  getAgreement,
  getInfraRecommendations,
  getDeliverables,
} from "@/lib/actions/engagement";
import { getChangeOrders } from "@/lib/actions/change-orders";
import { getMilestonesForEngagement } from "@/lib/actions/milestones";
import { AvailabilityEditor } from "@/components/engagement-admin/availability-editor";
import { AgreementEditor } from "@/components/engagement-admin/agreement-editor";
import { InfraEditor } from "@/components/engagement-admin/infra-editor";
import { DeliverablePoster } from "@/components/engagement-admin/deliverable-poster";
import { ChangeOrderManager } from "@/components/engagement-admin/change-order-manager";

export default async function BuilderEngagementPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o/project");

  const engagement = await getMyEngagement();

  if (!engagement) {
    return (
      <main className="krowe-page">
        <div className="krowe-page-inner max-w-3xl">
          <h1 className="text-2xl font-semibold text-neutral-900">Engagement</h1>
          <p className="mt-2 text-sm text-neutral-500">
            No engagement yet. Send a quote or invite an operator to start one.
          </p>
        </div>
      </main>
    );
  }

  const [availability, agreement, infra, deliverables, changeOrders, milestones] = await Promise.all([
    getAvailability(engagement.id),
    getAgreement(engagement.id),
    getInfraRecommendations(engagement.id),
    getDeliverables(engagement.id),
    getChangeOrders(engagement.id),
    getMilestonesForEngagement(engagement.id),
  ]);

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Engagement settings</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Controls the operator sees on their dashboard for {engagement.title}.
          </p>
        </div>

        <Section title="Your availability" hint="Lets the operator see when you're on it.">
          <AvailabilityEditor engagementId={engagement.id} availability={availability} />
        </Section>

        <Section title="Operating agreement" hint="Warranty, decision rights, cadence, channels, billing.">
          <AgreementEditor engagementId={engagement.id} agreement={agreement} />
        </Section>

        <Section title="Infrastructure recommendations" hint="Services the build depends on; the operator can swap them.">
          <InfraEditor engagementId={engagement.id} recommendations={infra} />
        </Section>

        <Section title="Deliverables" hint="Attach shipped artifacts to the engagement.">
          <DeliverablePoster
            engagementId={engagement.id}
            deliverables={deliverables}
            milestones={milestones.map((m) => ({ id: m.id, title: m.title }))}
          />
        </Section>

        <Section title="Change orders" hint="Out-of-scope work the operator signs to approve.">
          <ChangeOrderManager engagementId={engagement.id} changeOrders={changeOrders} />
        </Section>
      </div>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
