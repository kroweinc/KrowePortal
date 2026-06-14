"use client";

/* Refine-section wizard — a small in-page dialog that sharpens ONE PRD section.
   It sends the live PRD content (including unsaved inline edits) to the AI, asks
   a couple of targeted questions, then stages the refined fields back into the
   dashboard's edit state via onApply (the builder reviews + clicks Save draft).
   Modeled on ai-subtask-generator-dialog.tsx; adds a section picker and a
   read-only preview step, and supports multi-select questions. */

import { useState, useEffect, useTransition } from "react";
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
import type { Question } from "@/lib/ai/schemas";
import type { PrdContent } from "@/lib/types";

const OTHER = "__other__";

const isRealOption = (opt: string) => {
  const o = opt.trim().toLowerCase();
  return o !== "other" && !o.includes("specify");
};

// Tolerant match between an option string and the AI's `recommended` value
// (handles whitespace/case). A non-matching value yields no badge, never an error.
const matchesRecommended = (opt: string, rec?: string) =>
  !!rec && opt.trim().toLowerCase() === rec.trim().toLowerCase();

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
  risks: "Risks",
  openQuestions: "Open Questions",
  milestoneList: "Milestones",
};

type State =
  | { kind: "pick" }
  | { kind: "idle"; sectionId: string }
  | { kind: "loading"; sectionId: string }
  | {
      kind: "questions";
      sectionId: string;
      items: Question[];
      selections: Record<string, string[]>;
      otherText: Record<string, string>;
    }
  | { kind: "preview"; sectionId: string; patch: Partial<PrdContent> }
  | { kind: "applying" };

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
  const [round, setRound] = useState(0);
  const [, startTransition] = useTransition();

  // Reset to the right entry point each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setRound(0);
    setState(initialSectionId ? { kind: "idle", sectionId: initialSectionId } : { kind: "pick" });
  }, [open, initialSectionId]);

  function sectionTitle(id: string): string {
    return refinableSection(id)?.title ?? id;
  }

  function answerFor(
    q: Question,
    selections: Record<string, string[]>,
    otherText: Record<string, string>
  ): string {
    const sel = selections[q.id] ?? [];
    const parts: string[] = [];
    for (const s of sel) {
      if (s === OTHER) {
        const t = (otherText[q.id] ?? "").trim();
        if (t) parts.push(t);
      } else {
        parts.push(s);
      }
    }
    return parts.join(", ");
  }

  function generate(sectionId: string, answers?: { questionId: string; question: string; answer: string }[]) {
    setState({ kind: "loading", sectionId });
    const thisRound = round;
    startTransition(async () => {
      const result = await refinePrdSection({
        prdId,
        sectionId,
        currentContent: currentContent as Record<string, unknown>,
        answers,
        round: thisRound,
      });
      setRound(thisRound + 1);

      if ("error" in result) {
        toast.error(result.error);
        setState({ kind: "idle", sectionId });
        return;
      }

      if (result.kind === "questions") {
        setState({
          kind: "questions",
          sectionId,
          items: result.items,
          // Pre-select the AI's recommended option (when it matches a real
          // option) so the builder just confirms; fully overridable.
          selections: Object.fromEntries(
            result.items.map((q) => [
              q.id,
              q.recommended && q.options.some((o) => matchesRecommended(o, q.recommended))
                ? [q.recommended]
                : [],
            ])
          ),
          otherText: Object.fromEntries(result.items.map((q) => [q.id, ""])),
        });
      } else {
        setState({ kind: "preview", sectionId, patch: result.patch });
      }
    });
  }

  function toggleOption(q: Question, opt: string) {
    setState((prev) => {
      if (prev.kind !== "questions") return prev;
      const cur = prev.selections[q.id] ?? [];
      let next: string[];
      if (q.multiSelect) {
        next = cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt];
      } else {
        next = [opt];
      }
      return { ...prev, selections: { ...prev.selections, [q.id]: next } };
    });
  }

  function submitAnswers() {
    if (state.kind !== "questions") return;
    const s = state;
    const answers = s.items.map((q) => ({
      questionId: q.id,
      question: q.text,
      answer: answerFor(q, s.selections, s.otherText),
    }));
    generate(s.sectionId, answers);
  }

  const questionsReady =
    state.kind === "questions" &&
    state.items.every((q) => answerFor(q, state.selections, state.otherText).length > 0);

  function apply() {
    if (state.kind !== "preview") return;
    const patch = state.patch;
    setState({ kind: "applying" });
    onApply(patch);
    toast.success("Refined — review and Save draft to keep it");
    onOpenChange(false);
  }

  const isLoading = state.kind === "loading" || state.kind === "applying";

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
                  onClick={() => setState({ kind: "idle", sectionId: s.id })}
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

        {state.kind === "idle" && (
          <>
            <DialogHeader>
              <DialogTitle>Refine “{sectionTitle(state.sectionId)}”</DialogTitle>
            </DialogHeader>
            <div className="px-6 py-4 text-sm text-neutral-600">
              The AI will read the full PRD (including your unsaved edits) and ask a couple of focused questions before rewriting just this section. Nothing is saved until you click Save draft.
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => generate(state.sectionId)}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Start
              </Button>
            </DialogFooter>
          </>
        )}

        {state.kind === "loading" && (
          <>
            <DialogHeader>
              <DialogTitle>Thinking…</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center px-6 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          </>
        )}

        {state.kind === "questions" && (
          <>
            <DialogHeader>
              <DialogTitle>A few questions about “{sectionTitle(state.sectionId)}”</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 px-6 py-4 flex-1 min-h-0 overflow-y-auto">
              {state.items.map((q) => {
                const selected = state.selections[q.id] ?? [];
                const inputType = q.multiSelect ? "checkbox" : "radio";
                return (
                  <div key={q.id} className="space-y-2">
                    <p className="text-sm font-medium text-neutral-800">{q.text}</p>
                    <div className="space-y-1.5">
                      {[...q.options.filter(isRealOption), OTHER].map((opt) => {
                        const checked = selected.includes(opt);
                        const label = opt === OTHER ? "Other (specify)" : opt;
                        const isRecommended = matchesRecommended(opt, q.recommended);
                        return (
                          <label
                            key={opt}
                            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
                              checked
                                ? "border-neutral-700 bg-neutral-50 text-neutral-900"
                                : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                            }`}
                          >
                            <input
                              type={inputType}
                              name={q.id}
                              checked={checked}
                              onChange={() => toggleOption(q, opt)}
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-neutral-700"
                            />
                            <span className="flex-1 leading-snug">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span>{label}</span>
                                {isRecommended && (
                                  <span className="rounded-full border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                                    Recommended
                                  </span>
                                )}
                              </span>
                              {isRecommended && q.recommendation && (
                                <span className="mt-0.5 block text-xs font-normal text-neutral-500">
                                  {q.recommendation}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      {selected.includes(OTHER) && (
                        <textarea
                          rows={2}
                          autoFocus
                          value={state.otherText[q.id] ?? ""}
                          onChange={(e) =>
                            setState((prev) =>
                              prev.kind === "questions"
                                ? { ...prev, otherText: { ...prev.otherText, [q.id]: e.target.value } }
                                : prev
                            )
                          }
                          placeholder="Type your answer…"
                          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400 resize-none"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setState({ kind: "idle", sectionId: state.sectionId })}>
                Back
              </Button>
              <Button onClick={submitAnswers} disabled={isLoading || !questionsReady}>
                {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                Refine section
              </Button>
            </DialogFooter>
          </>
        )}

        {state.kind === "preview" && (
          <>
            <DialogHeader>
              <DialogTitle>Proposed “{sectionTitle(state.sectionId)}”</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 px-6 py-4 flex-1 min-h-0 overflow-y-auto">
              {Object.keys(state.patch).length === 0 ? (
                <p className="text-sm text-neutral-500">The AI didn’t propose any changes for this section.</p>
              ) : (
                <>
                  <p className="text-xs text-neutral-500">
                    Applying replaces this section in your editor. Review and tweak inline, then click Save draft to keep it.
                  </p>
                  {Object.entries(state.patch).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {FIELD_LABELS[key] ?? key}
                      </p>
                      <PreviewValue value={value} />
                    </div>
                  ))}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => generate(state.sectionId)}>Regenerate</Button>
              <Button onClick={apply} disabled={isLoading || Object.keys(state.patch).length === 0}>
                Apply to section
              </Button>
            </DialogFooter>
          </>
        )}

        {state.kind === "applying" && (
          <>
            <DialogHeader>
              <DialogTitle>Applying…</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center px-6 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
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
