"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateBriefContent, reparseSopIntake } from "@/lib/actions/briefs";
import type { SopIntake } from "@/lib/types";

const FIELDS: { key: keyof SopIntake; label: string; hint: string }[] = [
  { key: "businessContext", label: "Business context", hint: "What they do, who they serve, team size." },
  { key: "theirIdeas", label: "Their ideas", hint: "Solution they've already sketched / are attached to." },
  { key: "whyNow", label: "Why now", hint: "The trigger and cost of inaction." },
  { key: "problemCurrentState", label: "Problem / current state", hint: "What happens today and where it breaks." },
  { key: "desiredOutcome", label: "Desired outcome", hint: "What 'good' looks like in their words." },
  { key: "scope", label: "Scope", hint: "Deliverables imagined, must-haves vs nice-to-haves." },
  { key: "audienceBrand", label: "Audience & brand", hint: "End users; tone/brand constraints." },
  { key: "stackAccessOwnership", label: "Stack, access & ownership", hint: "Tools, accounts, integrations." },
  { key: "stakeholders", label: "Stakeholders & decisions", hint: "Who signs, who reviews, how feedback flows." },
  { key: "timelineConstraints", label: "Timeline & constraints", hint: "Dates, blackout periods, gates." },
  { key: "budgetSignal", label: "Budget signal", hint: "Range, ceiling, or comparison shopping." },
];

interface SopIntakeCardProps {
  briefId: string;
  sopIntake: SopIntake;
}

export function SopIntakeCard({ briefId, sopIntake }: SopIntakeCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reparseOpen, setReparseOpen] = useState(false);
  const [rawNotes, setRawNotes] = useState("");

  const [sop, setSop] = useState<SopIntake>(sopIntake ?? {});
  const riskFlags = sop.riskFlags ?? [];

  function setField(key: keyof SopIntake, value: string) {
    setSop((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await updateBriefContent(briefId, { sopIntake: sop });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("SOP saved");
      router.refresh();
    });
  }

  function reparse() {
    if (rawNotes.trim().length === 0) {
      toast.error("Paste your notes first.");
      return;
    }
    if (!confirm("Re-parse from notes? This re-drafts the quote below from the fresh notes.")) return;
    startTransition(async () => {
      const result = await reparseSopIntake(briefId, rawNotes);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSop(result.sopIntake);
      setReparseOpen(false);
      setRawNotes("");
      toast.success("Re-parsed & re-drafted");
      router.refresh();
    });
  }

  const filledCount = FIELDS.filter((f) => (sop[f.key] as string | undefined)?.trim()).length;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
          <span className="text-sm font-semibold text-neutral-900">Discovery SOP</span>
          <span className="text-xs text-neutral-500">
            {filledCount}/{FIELDS.length} fields
            {riskFlags.length > 0 && ` · ${riskFlags.length} risk flag${riskFlags.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <span className="text-xs text-neutral-400">parsed from your notes</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-neutral-100 px-4 py-4">
          {riskFlags.length > 0 && (
            <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Risk flags
              </div>
              <ul className="list-disc space-y-1 pl-4 text-sm text-amber-900">
                {riskFlags.map((flag, i) => (
                  <li key={i}>{flag}</li>
                ))}
              </ul>
            </div>
          )}

          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="block text-sm font-medium text-neutral-900">{f.label}</span>
              <span className="mb-1 block text-xs text-neutral-500">{f.hint}</span>
              <textarea
                rows={2}
                value={(sop[f.key] as string | undefined) ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder="(not captured)"
                className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </label>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReparseOpen((v) => !v)}
              disabled={isPending}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Re-parse from notes
            </Button>
            <Button variant="outline" size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save SOP"}
            </Button>
          </div>

          {reparseOpen && (
            <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs text-neutral-600">
                Paste updated discovery notes. Re-parsing overwrites the SOP fields above and re-drafts the quote.
              </p>
              <textarea
                rows={8}
                value={rawNotes}
                onChange={(e) => setRawNotes(e.target.value)}
                placeholder="Paste raw notes…"
                className="w-full rounded border border-neutral-200 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={reparse} disabled={isPending}>
                  {isPending ? "Re-parsing…" : "Re-parse & re-draft"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
