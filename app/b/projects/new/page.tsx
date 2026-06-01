import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-2xl">
        <Link href="/b/projects" className="text-xs text-neutral-500 hover:text-neutral-900">
          ← All projects
        </Link>
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">New project</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Create a project for a business you&apos;re pitching. You&apos;ll draft a quote, PRD, and contract for it next.
        </p>
        <NewProjectForm />
      </div>
    </main>
  );
}
