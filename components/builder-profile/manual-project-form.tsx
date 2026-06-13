"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addManualProject, updateProfileProject } from "@/lib/actions/builder-profile";
import type { BuilderProfileProject } from "@/lib/types";

interface ManualProjectFormProps {
  project?: BuilderProfileProject; // present = edit mode
  trigger?: React.ReactNode;
}

export function ManualProjectForm({ project, trigger }: ManualProjectFormProps) {
  const router = useRouter();
  const editing = !!project;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [url, setUrl] = useState(project?.url ?? "");
  const [liveUrl, setLiveUrl] = useState(project?.live_url ?? "");
  const [tech, setTech] = useState((project?.tech ?? []).join(", "));
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(project?.name ?? "");
      setDescription(project?.description ?? "");
      setUrl(project?.url ?? "");
      setLiveUrl(project?.live_url ?? "");
      setTech((project?.tech ?? []).join(", "));
    }
  }

  function save() {
    const techList = tech
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
    const input = {
      name: name.trim(),
      description: description.trim(),
      url: url.trim(),
      liveUrl: liveUrl.trim(),
      tech: techList,
    };
    startTransition(async () => {
      const result = editing
        ? await updateProfileProject(project.id, input)
        : await addManualProject(input);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Project updated" : "Project added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline" size="sm">Add project</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit project" : "Add a project"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!editing && (
            <p className="text-xs text-neutral-500">
              Hand-added projects appear without the verified badge — only repos synced from
              GitHub are marked verified.
            </p>
          )}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            maxLength={120}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What you built and why it mattered."
            maxLength={1000}
            rows={3}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link (optional)"
            maxLength={500}
          />
          <Input
            value={liveUrl}
            onChange={(e) => setLiveUrl(e.target.value)}
            placeholder="Live demo URL — where viewers can try it (optional)"
            maxLength={500}
          />
          <Input
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            placeholder="Tech, comma-separated (e.g. Next.js, Supabase)"
          />
          <Button onClick={save} disabled={isPending || !name.trim()} className="w-full">
            {isPending ? "Saving…" : editing ? "Save changes" : "Add project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
