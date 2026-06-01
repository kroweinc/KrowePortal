import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { createContractDraft } from "@/lib/actions/contracts";
import { NewDocForm } from "@/components/doc/new-doc-form";

export default async function NewProjectContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-2xl">
        <Link href={`/b/projects/${id}`} className="text-xs text-neutral-500 hover:text-neutral-900">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">New contract</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Describe the engagement terms. AI drafts a services agreement (kept consistent with this project&apos;s quote);
          you can edit anything before sending.
        </p>
        <NewDocForm
          action={createContractDraft}
          projectId={id}
          initialTitle={`${project.name} — Services Agreement`}
          submitLabel="Generate contract draft"
          pendingLabel="Drafting…"
          titleLabel="Contract title"
          titlePlaceholder="e.g. Lead portal — Services Agreement"
          notesHint="Scope, fees, timeline, who owns what, any special terms. The AI fills in fair defaults for anything you leave out."
          notesPlaceholder={`e.g.\nFixed fee $18k. 40% deposit, 30% at midpoint, 30% on delivery. ~8 weeks. Client owns the code once paid in full. 30-day warranty. I keep rights to my own libraries. Out-of-scope work needs a written change order. Texas law.`}
        />
      </div>
    </main>
  );
}
