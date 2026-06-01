"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateProject } from "@/lib/actions/projects";
import type { Project } from "@/lib/types";

export function EditProjectDialog({ project }: { project: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(project.name);
  const [prospectName, setProspectName] = useState(project.prospect_name ?? "");
  const [prospectEmail, setProspectEmail] = useState(project.prospect_email ?? "");
  const [context, setContext] = useState(project.context ?? "");

  // Reset fields to the current project whenever the dialog (re)opens.
  function onOpenChange(next: boolean) {
    if (next) {
      setName(project.name);
      setProspectName(project.prospect_name ?? "");
      setProspectEmail(project.prospect_email ?? "");
      setContext(project.context ?? "");
    }
    setOpen(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the project a name.");
      return;
    }
    startTransition(async () => {
      const result = await updateProject(project.id, {
        name: name.trim(),
        prospectName: prospectName.trim() || null,
        prospectEmail: prospectEmail.trim() || null,
        context: context.trim() || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Project updated.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Update the business details and context for this project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-6">
            <Field label="Project name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Nissan of McKinney"
                maxLength={200}
                autoFocus
              />
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

            <Field label="Context" hint="Anything you know about the business. Used to seed AI drafts.">
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={6}
                placeholder="What they do, the problem, who's involved — whatever you have."
                maxLength={20000}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
