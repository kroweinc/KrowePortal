"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BrandLogo } from "@/components/prd/brand-logo";
import { CompanySuggestInput } from "@/components/builder-profile/company-suggest-input";
import { companyInitials } from "@/lib/company";
import {
  addExperience,
  updateExperience,
  deleteExperience,
  reorderExperience,
} from "@/lib/actions/builder-profile";
import type { BuilderProfileExperience } from "@/lib/types";

export function ExperienceEditor({ entries }: { entries: BuilderProfileExperience[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  function move(index: number, dir: -1 | 1) {
    const next = [...entries];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    startTransition(async () => {
      const result = await reorderExperience(next.map((e) => e.id));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        title: "Delete this experience entry?",
        description: "This can’t be undone.",
        confirmText: "Delete",
        cancelText: "Cancel",
        icon: Trash2,
        tone: "danger",
      }))
    )
      return;
    startTransition(async () => {
      const result = await deleteExperience(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400">
          No experience added yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-4"
            >
              {/* name is omitted on purpose: without a verified domain we want
                  initials, not BrandLogo's dev-tool name guessing (a company
                  called "Express" would get the Express.js logo). */}
              <BrandLogo
                domain={entry.company_domain}
                fallback={companyInitials(entry.company)}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-900">
                  {entry.role} <span className="font-normal text-neutral-500">· {entry.company}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-400">
                  {entry.start_label ?? ""}
                  {entry.start_label || entry.end_label ? " — " : ""}
                  {entry.end_label ?? (entry.start_label ? "Present" : "")}
                </p>
                {entry.description && (
                  <p className="mt-1 text-xs text-neutral-500">{entry.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={isPending || index === 0}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={isPending || index === entries.length - 1}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <ExperienceForm
                  entry={entry}
                  trigger={
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                      aria-label="Edit experience"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  }
                />
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  disabled={isPending}
                  className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete experience"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ExperienceForm />
      {confirmDialog}
    </div>
  );
}

function ExperienceForm({
  entry,
  trigger,
}: {
  entry?: BuilderProfileExperience;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const editing = !!entry;
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(entry?.role ?? "");
  const [company, setCompany] = useState(entry?.company ?? "");
  const [companyDomain, setCompanyDomain] = useState<string | null>(entry?.company_domain ?? null);
  const [startLabel, setStartLabel] = useState(entry?.start_label ?? "");
  const [endLabel, setEndLabel] = useState(entry?.end_label ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setRole(entry?.role ?? "");
      setCompany(entry?.company ?? "");
      setCompanyDomain(entry?.company_domain ?? null);
      setStartLabel(entry?.start_label ?? "");
      setEndLabel(entry?.end_label ?? "");
      setDescription(entry?.description ?? "");
    }
  }

  function save() {
    const input = {
      role: role.trim(),
      company: company.trim(),
      company_domain: companyDomain ?? "",
      start_label: startLabel.trim(),
      end_label: endLabel.trim(),
      description: description.trim(),
    };
    startTransition(async () => {
      const result = editing ? await updateExperience(entry.id, input) : await addExperience(input);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Experience updated" : "Experience added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline" size="sm">Add experience</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit experience" : "Add experience"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (e.g. Senior Engineer)"
            maxLength={120}
          />
          <CompanySuggestInput
            id="experience-company"
            value={company}
            domain={companyDomain}
            onChange={(name, domain) => {
              setCompany(name);
              setCompanyDomain(domain);
            }}
            placeholder="Company"
            maxLength={120}
          />
          <div className="flex gap-2">
            <Input
              value={startLabel}
              onChange={(e) => setStartLabel(e.target.value)}
              placeholder="Start (e.g. Mar 2022)"
              maxLength={40}
            />
            <Input
              value={endLabel}
              onChange={(e) => setEndLabel(e.target.value)}
              placeholder="End (blank = Present)"
              maxLength={40}
            />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What you did there."
            maxLength={1000}
            rows={3}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
          />
          <Button
            onClick={save}
            disabled={isPending || !role.trim() || !company.trim()}
            className="w-full"
          >
            {isPending ? "Saving…" : editing ? "Save changes" : "Add experience"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
