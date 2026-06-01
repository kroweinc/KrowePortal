import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getContractById } from "@/lib/actions/contracts";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { DocLinkButton } from "@/components/doc/editor-primitives";
import { ContractEditor } from "@/components/contract/contract-editor";
import { ContractView } from "@/components/contract/contract-view";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ProjectContractPage({
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

  const contract = await getContractById(docId);
  if (!contract || contract.project_id !== id) notFound();

  const backHref = `/b/projects/${id}`;
  const isSigned = contract.status === "signed";
  const isSent = contract.status === "sent";

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <Link href={backHref} className="text-xs text-neutral-500 hover:text-neutral-900">
          ← {project.name}
        </Link>

        {(isSent || isSigned) && (
          <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900 truncate">{contract.title}</span>
                <BriefStatusPill status={contract.status} />
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 space-x-2">
                {contract.sent_at && <span>Sent {formatDateTime(contract.sent_at)}</span>}
                {contract.signed_at && (
                  <span>
                    · Signed {formatDateTime(contract.signed_at)}
                    {contract.signed_by_name ? ` by ${contract.signed_by_name}` : ""}
                  </span>
                )}
              </div>
            </div>
            <DocLinkButton path={`/contract/${contract.token}`} label="Copy contract link" />
          </div>
        )}

        {isSigned ? (
          <div className="mt-6">
            <ContractView content={contract.content} />
          </div>
        ) : (
          <div className="mt-4">
            <ContractEditor contract={contract} backHref={backHref} />
          </div>
        )}
      </div>
    </main>
  );
}
