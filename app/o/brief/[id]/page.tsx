import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getBriefById } from "@/lib/actions/briefs";
import { BriefView } from "@/components/brief/brief-view";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { OperatorBriefActions } from "./operator-brief-actions";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function OperatorBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const { id } = await params;
  const brief = await getBriefById(id);
  if (!brief) notFound();

  // Operator should not see drafts the builder hasn't sent yet.
  if (brief.status === "draft") notFound();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl mt-4 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold text-neutral-900 truncate">{brief.title}</h1>
              <BriefStatusPill status={brief.status} />
            </div>
            <div className="text-xs text-neutral-500 space-x-2">
              {brief.sent_at && <span>Sent {formatDateTime(brief.sent_at)}</span>}
              {brief.accepted_at && <span>· Accepted {formatDateTime(brief.accepted_at)}</span>}
              {brief.rejected_at && <span>· Rejected {formatDateTime(brief.rejected_at)}</span>}
            </div>
          </div>
        </div>

        {brief.status === "rejected" && brief.rejection_note && (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
              Your note
            </div>
            <p className="text-sm text-neutral-800 whitespace-pre-wrap">{brief.rejection_note}</p>
          </div>
        )}

        <BriefView content={brief.content} />

        {brief.status === "sent" && (
          <div className="rounded-lg border border-neutral-200 bg-white p-4 sticky bottom-4">
            <p className="text-sm text-neutral-700 mb-3">
              Review the brief above. Accepting locks in the scope and pricing — your builder will start work.
            </p>
            <OperatorBriefActions briefId={brief.id} />
          </div>
        )}
      </div>
    </main>
  );
}
