"use client";

/* Refine-section dialog — sharpens ONE PRD section from a freeform instruction
   the builder types ("add stripe", "shorter", "mention the March deadline"). It
   sends the live PRD content (including unsaved inline edits) with that
   instruction, then stages the returned fields back into the dashboard's edit
   state via onApply, which autosaves. The preview marks each item as kept, new
   or removed so it's obvious the refine added to the section rather than
   replacing it. */

import { useState, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { refinePrdSection } from "@/lib/actions/prds";
import { REFINABLE_SECTIONS, refinableSection } from "@/lib/prd/section-fields";
import { FieldDiff } from "@/components/doc/refine-field-diff";
import { MIN_INSTRUCTION, MAX_INSTRUCTION } from "@/lib/doc/refine";
import type { PrdContent } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  overview: "Overview",
  goals: "Goals",
  successMetrics: "Success Metrics",
  users: "User Types",
  targetUsers: "Target Users",
  coreUserFlow: "Core User Flow",
  features: "Features",
  requirements: "Functional Requirements",
  pagesScreens: "Pages & Screens",
  successCriteria: "Success Criteria",
  nonFunctionalRequirements: "Non-Functional Requirements",
  scopeLater: "Scope — Later",
  futureExpansion: "Future Expansion",
  dataModel: "Data Model",
  integrations: "Integrations",
  techStack: "Tech Stack",
  uxFlows: "UX Flows",
  assumptions: "Assumptions",
  constraintsDetail: "Constraints",
  constraints: "Constraints",
  milestoneList: "Milestones",
};

type State =
  | { kind: "pick" }
  | { kind: "compose"; sectionId: string }
  | { kind: "loading"; sectionId: string }
  | { kind: "preview"; sectionId: string; patch: Partial<PrdContent> };

interface Props {
  prdId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section to refine; null opens the section picker first. */
  initialSectionId: string | null;
  /** Live PRD content (with unsaved inline edits) — sent to the AI for context. */
  currentContent: PrdContent;
  onApply: (patch: Partial<PrdContent>) => void;
}

export function RefineSectionDialog({
  prdId,
  open,
  onOpenChange,
  initialSectionId,
  currentContent,
  onApply,
}: Props) {
  const [state, setState] = useState<State>({ kind: "pick" });
  const [instruction, setInstruction] = useState("");

  // Reset to the right entry point each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setState(initialSectionId ? { kind: "compose", sectionId: initialSectionId } : { kind: "pick" });
  }, [open, initialSectionId]);

  function sectionTitle(id: string): string {
    return refinableSection(id)?.title ?? id;
  }

  async function generate(sectionId: string) {
    if (!canSubmit) return;
    setState({ kind: "loading", sectionId });
    const result = await refinePrdSection({
      prdId,
      sectionId,
      currentContent: currentContent as Record<string, unknown>,
      instruction: instruction.trim(),
    });

    if ("error" in result) {
      toast.error(result.error);
      setState({ kind: "compose", sectionId });
      return;
    }
    setState({ kind: "preview", sectionId, patch: result.patch });
  }

  function apply() {
    if (state.kind !== "preview") return;
    onApply(state.patch);
    toast.success("Applied to your draft");
    onOpenChange(false);
  }

  const canSubmit = instruction.trim().length >= MIN_INSTRUCTION;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col" aria-describedby={undefined}>
        {state.kind === "pick" && (
          <>
            <DialogHeader>
              <DialogTitle>Refine a section</DialogTitle>
            </DialogHeader>
            <div className="space-y-1 px-6 py-4 flex-1 min-h-0 overflow-y-auto">
              <p className="mb-3 text-xs text-neutral-500">
                Pick the section to sharpen. The AI reads the whole PRD (including your unsaved edits) but only rewrites the section you choose.
              </p>
              {REFINABLE_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                  onClick={() => setState({ kind: "compose", sectionId: s.id })}
                >
                  <span>{s.title}</span>
                  <Sparkles className="h-3.5 w-3.5 text-neutral-400" />
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            </DialogFooter>
          </>
        )}

        {state.kind === "compose" && (
          <>
            <DialogHeader>
              <DialogTitle>Refine “{sectionTitle(state.sectionId)}”</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 px-6 py-4">
              <label className="krowe-refine-label" htmlFor="prd-refine-instruction">
                What do you want to change?
              </label>
              <textarea
                id="prd-refine-instruction"
                className="krowe-refine-textarea"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    generate(state.sectionId);
                  }
                }}
                placeholder="e.g. add stripe for payments"
                rows={3}
                maxLength={MAX_INSTRUCTION}
                autoFocus
              />
              <p className="krowe-refine-hint">
                Plain English is fine — a few words work. Krowe keeps what’s already in this section.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => generate(state.sectionId)} disabled={!canSubmit}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Refine
              </Button>
            </DialogFooter>
          </>
        )}

        {state.kind === "loading" && (
          <>
            <DialogHeader>
              <DialogTitle>Applying your change…</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center px-6 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          </>
        )}

        {state.kind === "preview" && (
          <>
            <DialogHeader>
              <DialogTitle>Proposed “{sectionTitle(state.sectionId)}”</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 px-6 py-4 flex-1 min-h-0 overflow-y-auto">
              {Object.keys(state.patch).length === 0 ? (
                <p className="text-sm text-neutral-500">
                  The AI didn’t find anything to change for “{instruction.trim()}”. Try naming what to add or which part to rework.
                </p>
              ) : (
                <>
                  <p className="text-xs text-neutral-500">
                    Applying replaces this section in your editor. Review and tweak inline — your draft saves automatically.
                  </p>
                  {Object.entries(state.patch).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {FIELD_LABELS[key] ?? key}
                      </p>
                      <FieldDiff
                        current={(currentContent as Record<string, unknown>)[key]}
                        next={value}
                        renderValue={(v) => <PreviewValue value={v} />}
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setState({ kind: "compose", sectionId: state.sectionId })}>
                Refine again
              </Button>
              <Button onClick={apply} disabled={Object.keys(state.patch).length === 0}>
                Apply to section
              </Button>
            </DialogFooter>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}

/* Best-effort read-only renderer for a refined field value (string, string[], or
   an array/object of primitives). The authoritative editing happens inline in the
   dashboard after Apply — this is just a review surface. */
function PreviewValue({ value }: { value: unknown }) {
  if (value == null || value === "") {
    return <p className="text-sm italic text-neutral-400">(empty)</p>;
  }
  if (typeof value === "string") {
    return <p className="whitespace-pre-wrap text-sm text-neutral-700">{value}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-sm italic text-neutral-400">(empty)</p>;
    if (value.every((v) => typeof v === "string")) {
      return (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-neutral-700">
          {(value as string[]).map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-md border border-neutral-200 p-2">
            <PreviewValue value={v} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return (
      <div className="space-y-0.5 text-sm text-neutral-700">
        {Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-1">
              <span className="font-medium text-neutral-500">{k}:</span>
              <span>{Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}</span>
            </div>
          ))}
      </div>
    );
  }
  return <p className="text-sm text-neutral-700">{String(value)}</p>;
}
