import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getBriefById } from "@/lib/actions/briefs";
import { BriefEditor, BriefSentActions } from "@/components/brief/brief-editor";
import { BriefView } from "@/components/brief/brief-view";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { SopIntakeCard } from "@/components/brief/sop-intake-card";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ProjectQuotePage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id, docId } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  const brief = await getBriefById(docId);
  if (!brief || brief.project_id !== id) notFound();

  const backHref = `/b/projects/${id}`;
  const isSigned = brief.status === "signed";
  const isSent = brief.status === "sent";

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <Link href={backHref} className="text-xs text-neutral-500 hover:text-neutral-900">
          ← {project.name}
        </Link>

        {/* Status + shareable link header (shown once the quote has been sent). */}
        {(isSent || isSigned) && (
          <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900 truncate">{brief.title}</span>
                <BriefStatusPill status={brief.status} />
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 space-x-2">
                {brief.sent_at && <span>Sent {formatDateTime(brief.sent_at)}</span>}
                {brief.signed_at && (
                  <span>
                    · Signed {formatDateTime(brief.signed_at)}
                    {brief.signed_by_name ? ` by ${brief.signed_by_name}` : ""}
                  </span>
                )}
              </div>
            </div>
            <BriefSentActions token={brief.token} />
          </div>
        )}

        {isSigned ? (
          <div className="mt-6">
            <BriefView content={brief.content} />
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            <SopIntakeCard briefId={brief.id} sopIntake={brief.sop_intake} />
            <BriefEditor brief={brief} backHref={backHref} />
          </div>
        )}
      </div>
    </main>
  );
}
