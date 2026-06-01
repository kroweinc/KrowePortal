import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getBriefById } from "@/lib/actions/briefs";
import { BriefEditor, BriefSentActions } from "@/components/brief/brief-editor";
import { BriefView } from "@/components/brief/brief-view";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { SopIntakeCard } from "@/components/brief/sop-intake-card";
import type { Brief } from "@/lib/types";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function BuilderBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const brief = await getBriefById(id);
  if (!brief) notFound();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <Link href="/b/brief" className="text-xs text-neutral-500 hover:text-neutral-900">
          ← All briefs
        </Link>

        {brief.status === "accepted" ? (
          <SentBriefView brief={brief} />
        ) : (
          <div className="mt-4 space-y-6">
            <SopIntakeCard briefId={brief.id} sopIntake={brief.sop_intake} />
            <BriefEditor brief={brief} />
          </div>
        )}
      </div>
    </main>
  );
}

function SentBriefView({ brief }: { brief: Brief }) {
  return (
    <div className="mt-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-neutral-900 truncate">{brief.title}</h1>
            <BriefStatusPill status={brief.status} />
          </div>
          <div className="text-xs text-neutral-500 space-x-2">
            {brief.sent_at && <span>Sent {formatDateTime(brief.sent_at)}</span>}
            {brief.signed_at && (
              <span>· Signed {formatDateTime(brief.signed_at)}{brief.signed_by_name ? ` by ${brief.signed_by_name}` : ""}</span>
            )}
            {brief.accepted_at && <span>· Accepted {formatDateTime(brief.accepted_at)}</span>}
            {brief.rejected_at && <span>· Rejected {formatDateTime(brief.rejected_at)}</span>}
          </div>
        </div>
        {brief.status === "sent" && <BriefSentActions token={brief.token} />}
      </div>

      {brief.status === "rejected" && brief.rejection_note && (
        <div className="rounded-md border border-red-100 bg-red-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">
            Operator note
          </div>
          <p className="text-sm text-red-900 whitespace-pre-wrap">{brief.rejection_note}</p>
        </div>
      )}

      <BriefView content={brief.content} />
    </div>
  );
}
