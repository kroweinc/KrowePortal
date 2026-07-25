"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanySuggestInput } from "@/components/builder-profile/company-suggest-input";
import { companyInitials } from "@/lib/company";
import { CardActions, CardGrip, CardDropLane } from "./card-actions";
import { useDragReorder } from "./use-drag-reorder";
import {
  addExperience,
  updateExperience,
  deleteExperience,
  reorderExperience,
} from "@/lib/actions/builder-profile";
import type { BuilderProfileExperience } from "@/lib/types";

/** "Mar 2022 - Present". A blank end reads as still-current, but only once a
    start exists — otherwise an entry with no dates would claim "Present". */
function dateRange(entry: BuilderProfileExperience): string | null {
  const start = entry.start_label?.trim();
  const end = entry.end_label?.trim() || (start ? "Present" : "");
  if (!start && !end) return null;
  return [start, end].filter(Boolean).join(" \u2013 ");
}

export function ExperienceEditor({ entries }: { entries: BuilderProfileExperience[] }) {
  // Local mirror so a drag paints instantly; re-seeded on every server list.
  const [order, setOrder] = useState(entries);
  useEffect(() => setOrder(entries), [entries]);

  const { dropIndex, rowProps, laneProps } = useDragReorder({
    items: order,
    onReorder: setOrder,
    persist: reorderExperience,
  });

  if (order.length === 0) {
    return (
      <div className="ss-empty">
        <p>No experience added yet.</p>
      </div>
    );
  }

  return (
    <ul className="ss-items">
      {order.map((entry, index) => {
        const range = dateRange(entry);
        return (
          <Fragment key={entry.id}>
            {dropIndex === index && <CardDropLane {...laneProps} />}
            <li className={`ss-item${entry.is_hidden ? " hidden-item" : ""}`} {...rowProps(index)}>
              <span className="ss-initials" aria-hidden>
                {companyInitials(entry.company)}
              </span>
              <div className="body">
                <div className="titlerow">
                  <span className="nm">{entry.role}</span>
                  <span className="ss-rule" aria-hidden />
                  <span className="nm" style={{ fontWeight: 400 }}>
                    {entry.company}
                  </span>
                </div>
                {range && <div className="meta">{range}</div>}
                {entry.description && <p className="desc">{entry.description}</p>}
              </div>

              <CardActions
                kind="experience"
                id={entry.id}
                hidden={entry.is_hidden}
                name={`${entry.role} at ${entry.company}`}
                deleteLabel="Delete this experience entry"
                onDelete={() => deleteExperience(entry.id)}
              >
                <ExperienceForm
                  entry={entry}
                  trigger={
                    <button
                      type="button"
                      className="ss-cardact"
                      title="Edit experience"
                      aria-label="Edit experience"
                    >
                      <Pencil />
                    </button>
                  }
                />
              </CardActions>
              <CardGrip />
            </li>
          </Fragment>
        );
      })}
      {dropIndex === order.length && <CardDropLane {...laneProps} />}
    </ul>
  );
}

export function ExperienceForm({

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
        {trigger ?? (
          <button type="button" className="ss-btn">
            <Plus /> Add new experience
          </button>
        )}
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
