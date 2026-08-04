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
import { SuggestInput } from "./suggest-input";
import { BrandLogo } from "@/components/prd/brand-logo";
import { UNIVERSITY_NAMES, COMMON_MAJORS, findUniversityDomain } from "@/lib/education";
import { CardActions, CardGrip, CardDropLane } from "./card-actions";
import { useDragReorder } from "./use-drag-reorder";
import {
  addEducation,
  updateEducation,
  deleteEducation,
  reorderEducation,
} from "@/lib/actions/builder-profile";
import { EDUCATION_LEVELS, EDUCATION_MONTHS, type BuilderProfileEducation } from "@/lib/types";

// A generous window either side of "now" — degrees in progress list a future
// expected end, and a career-changer's first degree can be decades back.
// Rendered on the client only (see EducationForm), so Date here is safe.
function yearOptions(): string[] {
  const now = new Date().getFullYear();
  const out: string[] = [];
  for (let y = now + 8; y >= now - 60; y--) out.push(String(y));
  return out;
}

/** "Bachelor's, Computer Science" — either part may be missing. */
function degreeLine(entry: BuilderProfileEducation): string {
  return [entry.level, entry.field_of_study].filter(Boolean).join(", ");
}

/** "Aug 2021 - May 2025". Legacy 0049 rows carry a freeform label in end_year
    ("Class of 2027") and no start, which renders verbatim. */
function dateRange(entry: BuilderProfileEducation): string | null {
  const start = [entry.start_month, entry.start_year].filter(Boolean).join(" ");
  const end = [entry.end_month, entry.end_year].filter(Boolean).join(" ");
  if (!start && !end) return null;
  if (!start) return end;
  return `${start} – ${end || "Present"}`;
}

/** "S1", "S2" — the marker the Figma cards carry, keyed off list position so
    it stays stable regardless of how the school is spelled. Shown only when the
    school has no logo to put in the tile instead. */
function positionMark(index: number): string {
  return `S${index + 1}`;
}

export function EducationEditor({ entries }: { entries: BuilderProfileEducation[] }) {
  // Local mirror so a drag paints instantly; re-seeded on every server list.
  const [order, setOrder] = useState(entries);
  useEffect(() => setOrder(entries), [entries]);

  const { dropIndex, rowProps, laneProps } = useDragReorder({
    items: order,
    onReorder: setOrder,
    persist: reorderEducation,
  });

  // With nothing to list, the dialog would be a pointless extra click — the
  // empty frame in the design puts the fields straight onto the card.
  if (order.length === 0) return <EducationFields />;

  return (
    <ul className="ss-items">
      {order.map((entry, index) => {
        const degree = degreeLine(entry);
        const range = dateRange(entry);
        // The school's crest, matching what the public page shows; the position
        // mark stands in for schools outside the known-university directory.
        const domain = findUniversityDomain(entry.school);
        return (
          <Fragment key={entry.id}>
            {dropIndex === index && <CardDropLane {...laneProps} />}
            <li className={`ss-item${entry.is_hidden ? " hidden-item" : ""}`} {...rowProps(index)}>
              <span className="ss-initials" aria-hidden>
                {domain ? (
                  <BrandLogo
                    domain={domain}
                    name={entry.school}
                    size={40}
                    plain
                    fallback={positionMark(index)}
                  />
                ) : (
                  positionMark(index)
                )}
              </span>
              <div className="body">
                <div className="titlerow">
                  <span className="nm">{degree || entry.school}</span>
                  {degree && (
                    <>
                      <span className="ss-rule" aria-hidden />
                      <span className="nm" style={{ fontWeight: 400 }}>
                        {entry.school}
                      </span>
                    </>
                  )}
                </div>
                {range && <div className="meta">{range}</div>}
              </div>

              <CardActions
                kind="education"
                id={entry.id}
                hidden={entry.is_hidden}
                name={entry.school}
                deleteLabel="Delete this education entry"
                onDelete={() => deleteEducation(entry.id)}
              >
                <EducationForm
                  entry={entry}
                  trigger={
                    <button
                      type="button"
                      className="ss-cardact"
                      title="Edit education"
                      aria-label="Edit education"
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

interface EducationDraft {
  school: string;
  level: string;
  fieldOfStudy: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
}

function seed(entry?: BuilderProfileEducation): EducationDraft {
  return {
    school: entry?.school ?? "",
    level: entry?.level ?? "",
    fieldOfStudy: entry?.field_of_study ?? "",
    startMonth: entry?.start_month ?? "",
    startYear: entry?.start_year ?? "",
    endMonth: entry?.end_month ?? "",
    endYear: entry?.end_year ?? "",
  };
}

// The field set, shared by the inline first-entry form and the dialog so the
// two can never drift. `onSave` owns the server call.
function EducationFieldset({
  value,
  onChange,
}: {
  value: EducationDraft;
  onChange: (next: EducationDraft) => void;
}) {
  const years = yearOptions();
  const set = <K extends keyof EducationDraft>(key: K, v: EducationDraft[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <>
      <div className="ss-field">
        <label htmlFor="bp-edu-school">
          School <span className="req">*</span>
        </label>
        <SuggestInput
          id="bp-edu-school"
          value={value.school}
          onChange={(v) => set("school", v)}
          suggestions={UNIVERSITY_NAMES}
          maxLength={120}
          placeholder="e.g., University of Texas at Austin"
          logoDomain={findUniversityDomain}
        />
      </div>

      <div className="ss-row">
        <div className="ss-field">
          <label htmlFor="bp-edu-level">Education level</label>
          <select
            id="bp-edu-level"
            className="ss-input"
            value={value.level}
            onChange={(e) => set("level", e.target.value)}
          >
            <option value="">e.g., Bachelor&rsquo;s</option>
            {EDUCATION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <div className="ss-field">
          <label htmlFor="bp-edu-field">Field of study</label>
          <SuggestInput
            id="bp-edu-field"
            value={value.fieldOfStudy}
            onChange={(v) => set("fieldOfStudy", v)}
            suggestions={COMMON_MAJORS}
            maxLength={120}
            placeholder="e.g., Computer Science"
          />
        </div>
      </div>

      <div className="ss-field">
        <span className="ss-label">Start date</span>
        <div className="ss-row">
          <select
            className="ss-input"
            value={value.startMonth}
            onChange={(e) => set("startMonth", e.target.value)}
            aria-label="Start month"
          >
            <option value="">Month</option>
            {EDUCATION_MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            className="ss-input"
            value={value.startYear}
            onChange={(e) => set("startYear", e.target.value)}
            aria-label="Start year"
          >
            <option value="">Year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ss-field">
        <span className="ss-label">End date (or expected)</span>
        <div className="ss-row">
          <select
            className="ss-input"
            value={value.endMonth}
            onChange={(e) => set("endMonth", e.target.value)}
            aria-label="End month"
          >
            <option value="">Month</option>
            {EDUCATION_MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            className="ss-input"
            value={value.endYear}
            onChange={(e) => set("endYear", e.target.value)}
            aria-label="End year"
          >
            <option value="">Year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <p className="ss-hint">Leave blank if you&rsquo;re still studying.</p>
      </div>
    </>
  );
}

function toInput(draft: EducationDraft) {
  return {
    school: draft.school.trim(),
    level: draft.level.trim(),
    field_of_study: draft.fieldOfStudy.trim(),
    start_month: draft.startMonth.trim(),
    start_year: draft.startYear.trim(),
    end_month: draft.endMonth.trim(),
    end_year: draft.endYear.trim(),
  };
}

// The very first entry, rendered straight onto the card. Saves once the school
// is filled in — the rest of the fields are optional, so a Save button that
// waited on them would never enable.
function EducationFields() {
  const router = useRouter();
  const [draft, setDraft] = useState<EducationDraft>(seed());
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await addEducation(toInput(draft));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Education added.");
      setDraft(seed());
      router.refresh();
    });
  }

  return (
    <>
      <EducationFieldset value={draft} onChange={setDraft} />
      <div>
        <button
          type="button"
          className="ss-btn"
          onClick={save}
          disabled={isPending || !draft.school.trim()}
        >
          <Plus />
          {isPending ? "Saving…" : "Add education"}
        </button>
      </div>
    </>
  );
}

export function EducationForm({
  entry,
  trigger,
}: {
  entry?: BuilderProfileEducation;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const editing = !!entry;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EducationDraft>(seed(entry));
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setDraft(seed(entry));
  }

  function save() {
    const input = toInput(draft);
    startTransition(async () => {
      const result = editing ? await updateEducation(entry.id, input) : await addEducation(input);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Education updated." : "Education added.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button type="button" className="ss-btn">
            <Plus /> Add new education
          </button>
        )}
      </DialogTrigger>
      {/* .ppsetup scopes the field styles and the dialog renders in a portal
          outside it, so re-establish the scope on the content itself. */}
      <DialogContent className="ppsetup sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit education" : "Add education"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6 pt-2">
          <EducationFieldset value={draft} onChange={setDraft} />
          <Button onClick={save} disabled={isPending || !draft.school.trim()} className="w-full">
            {isPending ? "Saving…" : editing ? "Save changes" : "Add education"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
