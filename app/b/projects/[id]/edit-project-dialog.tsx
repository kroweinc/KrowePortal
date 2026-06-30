"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { updateProject, deleteProject } from "@/lib/actions/projects";
import type { Project, ProjectStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "archived", label: "Archived" },
];

export function EditProjectDialog({ project }: { project: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [prospectName, setProspectName] = useState(project.prospect_name ?? "");
  const [prospectEmail, setProspectEmail] = useState(project.prospect_email ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(project.linkedin_url ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(project.website_url ?? "");
  const [context, setContext] = useState(project.context ?? "");

  // Reset fields to the current project whenever the dialog (re)opens.
  function onOpenChange(next: boolean) {
    if (next) {
      setName(project.name);
      setStatus(project.status);
      setProspectName(project.prospect_name ?? "");
      setProspectEmail(project.prospect_email ?? "");
      setLinkedinUrl(project.linkedin_url ?? "");
      setWebsiteUrl(project.website_url ?? "");
      setContext(project.context ?? "");
    }
    setOpen(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the document a name.");
      return;
    }
    startTransition(async () => {
      const result = await updateProject(project.id, {
        name: name.trim(),
        status,
        prospectName: prospectName.trim() || null,
        prospectEmail: prospectEmail.trim() || null,
        linkedinUrl: linkedinUrl.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        context: context.trim() || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Document updated.");
      setOpen(false);
      router.refresh();
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      description:
        "This permanently removes the document and all of its PRDs, quotes, and contracts. This can’t be undone.",
      confirmText: "Delete document",
      cancelText: "Keep document",
      icon: Trash2,
      tone: "danger",
    });
    if (!ok) return;
    startDelete(async () => {
      const result = await deleteProject(project.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Document deleted.");
      setOpen(false);
      router.push("/b/projects");
    });
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className="edit-btn">
          <Pencil size={14} strokeWidth={2} /> Edit
        </button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>
              Update the business details and context for this document.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-6">
            <Field label="Document name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Krowe"
                maxLength={200}
                autoFocus
              />
            </Field>

            <Field label="Status" hint="Where this deal stands.">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Contact name">
              <Input
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="e.g. Dana Reyes"
                maxLength={200}
              />
            </Field>

            <Field label="Contact email">
              <Input
                type="email"
                value={prospectEmail}
                onChange={(e) => setProspectEmail(e.target.value)}
                placeholder="e.g. dana@example.com"
                maxLength={320}
              />
            </Field>

            <Field label="LinkedIn" hint="Company or contact LinkedIn URL.">
              <Input
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="e.g. linkedin.com/company/krowe"
                maxLength={2000}
              />
            </Field>

            <Field label="Business website" hint="Their main site.">
              <Input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="e.g. krowe.com"
                maxLength={2000}
              />
            </Field>

            <Field label="Notes" hint="Anything else you know about the business. Used to seed AI drafts.">
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={4}
                placeholder="What they do, the problem, who's involved — whatever you have."
                maxLength={20000}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mr-auto"
              onClick={onDelete}
              disabled={isPending || isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete document"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending || isDeleting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending || isDeleting}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {confirmDialog}
    </>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-900 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-500 mb-1.5">{hint}</span>}
      {children}
    </label>
  );
}
