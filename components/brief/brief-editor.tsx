"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefLineItems } from "./brief-line-items";
import { updateBriefContent, sendBrief, deleteBrief } from "@/lib/actions/briefs";
import type { Brief, BriefContent, BriefDeliverable, BriefLineItem } from "@/lib/types";

const PRE_WORK_SUGGESTIONS: { label: string; hours: number }[] = [
  { label: "Discovery sprint", hours: 8 },
  { label: "Kickoff & credentials gathering", hours: 2 },
  { label: "Repo / Supabase project setup", hours: 3 },
  { label: "Domain & DNS", hours: 1 },
];

const OUT_OF_SCOPE_SUGGESTIONS = [
  "Hosting fees (Vercel, Supabase paid plans)",
  "Third-party SaaS subscriptions",
  "Content migration",
  "Post-launch support beyond 30 days",
];

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Hour-based line items are always priced as hours × rate. Flat-fee items
// (hours left blank) keep their manually-typed amount. This reconciles a
// stored amount against the current rate — used both on initial load (so the
// price is correct on first paint, never stale) and when the rate changes.
function repriceHourItems(items: BriefLineItem[] | undefined, rate: number): BriefLineItem[] {
  return (items ?? []).map((li) =>
    li.hours != null && !Number.isNaN(li.hours)
      ? { ...li, amount: Math.round(li.hours * rate) }
      : li
  );
}

interface BriefEditorProps {
  brief: Brief;
  /** Where to navigate after a draft is deleted. Defaults to the legacy brief list. */
  backHref?: string;
}

export function BriefEditor({ brief, backHref = "/b/brief" }: BriefEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isDraft = brief.status === "draft";
  const saveLabel = isDraft ? "Save draft" : "Save changes";

  const [title, setTitle] = useState(brief.title);
  // Reconcile stored amounts against hours × rate up front so the price is
  // correct on first load — not only after the user nudges an hours field.
  const [content, setContent] = useState<BriefContent>(() => {
    const rate = brief.content.hourlyRate ?? 175;
    return {
      ...brief.content,
      preWork: repriceHourItems(brief.content.preWork, rate),
      projectLineItems: repriceHourItems(brief.content.projectLineItems, rate),
    };
  });

  const hourlyRate = content.hourlyRate ?? 175;
  const preWork = content.preWork ?? [];
  const projectItems = content.projectLineItems ?? [];
  const deliverables = content.deliverables ?? [];

  const totals = useMemo(() => {
    const pw = preWork.reduce((s, li) => s + li.amount, 0);
    const pj = projectItems.reduce((s, li) => s + li.amount, 0);
    return { preWork: pw, project: pj, grand: pw + pj };
  }, [preWork, projectItems]);

  function patch(p: Partial<BriefContent>) {
    setContent((prev) => ({ ...prev, ...p }));
  }

  // Changing the rate re-prices every hour-based line item. Items entered as a
  // flat fee (hours left blank) keep their manually-typed amount.
  function changeHourlyRate(rate: number) {
    patch({
      hourlyRate: rate,
      preWork: repriceHourItems(preWork, rate),
      projectLineItems: repriceHourItems(projectItems, rate),
    });
  }

  function save() {
    startTransition(async () => {
      const result = await updateBriefContent(brief.id, {
        title,
        content: { ...content, totals },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  function send() {
    if (!confirm("Send this quote to the client? You can still edit it afterward.")) return;
    startTransition(async () => {
      // Save first to capture latest edits
      const saveResult = await updateBriefContent(brief.id, {
        title,
        content: { ...content, totals },
      });
      if ("error" in saveResult) {
        toast.error(saveResult.error);
        return;
      }
      const result = await sendBrief(brief.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Brief sent");
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteBrief(brief.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(backHref);
    });
  }

  function addDeliverable() {
    patch({ deliverables: [...deliverables, { title: "", acceptanceCriteria: "" }] });
  }
  function updateDeliverable(i: number, p: Partial<BriefDeliverable>) {
    patch({ deliverables: deliverables.map((d, idx) => (idx === i ? { ...d, ...p } : d)) });
  }
  function removeDeliverable(i: number) {
    patch({ deliverables: deliverables.filter((_, idx) => idx !== i) });
  }

  function addPreWorkSuggestion(label: string, hours: number) {
    const amount = Math.round(hours * hourlyRate);
    const next: BriefLineItem = { label, hours, amount, notes: null };
    patch({ preWork: [...preWork, next] });
  }

  function addOutOfScopeSuggestion(text: string) {
    const current = content.outOfScope ?? [];
    if (current.includes(text)) return;
    patch({ outOfScope: [...current, text] });
  }

  function updateStringList(field: "outOfScope" | "assumptions", items: string[]) {
    patch({ [field]: items });
  }

  const outOfScope = content.outOfScope ?? [];
  const assumptions = content.assumptions ?? [];

  return (
    <div className="space-y-6">
      {/* Title + actions */}
      <div className="flex items-start justify-between gap-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Brief title"
          className="flex-1 text-2xl font-semibold text-neutral-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-neutral-300"
        />
        <div className="flex items-center gap-2 shrink-0">
          {isDraft && (
            <Button variant="ghost" onClick={remove} disabled={isPending} size="sm">
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={save} disabled={isPending} size="sm">
            {isPending ? "Saving…" : saveLabel}
          </Button>
          {isDraft && (
            <Button onClick={send} disabled={isPending} size="sm">
              <Send className="h-3.5 w-3.5" /> Send to client
            </Button>
          )}
        </div>
      </div>

      {/* Pricing settings */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Hourly rate</span>
            <input
              type="number"
              min="0"
              step="5"
              value={content.hourlyRate ?? 175}
              onChange={(e) => changeHourlyRate(Number(e.target.value) || 0)}
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Validity (days)</span>
            <input
              type="number"
              min="1"
              value={content.validityDays ?? 30}
              onChange={(e) => patch({ validityDays: Number(e.target.value) || 0 })}
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Payment terms</span>
            <input
              type="text"
              value={content.paymentTerms ?? ""}
              onChange={(e) => patch({ paymentTerms: e.target.value })}
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
        </div>
      </div>

      {/* Summary */}
      <EditorSection title="Summary" hint="The problem this project solves, in 1–3 sentences.">
        <textarea
          value={content.summary ?? ""}
          onChange={(e) => patch({ summary: e.target.value })}
          rows={3}
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="What problem are we solving for them?"
        />
      </EditorSection>

      {/* Proposed solution */}
      <EditorSection title="Proposed Solution" hint="Non-technical description of the approach.">
        <textarea
          value={content.proposedSolution ?? ""}
          onChange={(e) => patch({ proposedSolution: e.target.value })}
          rows={4}
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="How are we going to solve it?"
        />
      </EditorSection>

      {/* Deliverables */}
      <EditorSection title="Deliverables" hint="Concrete outcomes with acceptance criteria the operator can verify.">
        <div className="space-y-3">
          {deliverables.map((d, i) => (
            <div key={i} className="rounded-md border border-neutral-200 bg-white p-3 space-y-2">
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={d.title}
                  onChange={(e) => updateDeliverable(i, { title: e.target.value })}
                  placeholder="Deliverable title"
                  className="flex-1 rounded border border-neutral-200 px-2 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
                <button
                  type="button"
                  onClick={() => removeDeliverable(i)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-500"
                  aria-label="Remove deliverable"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <textarea
                value={d.acceptanceCriteria ?? ""}
                onChange={(e) => updateDeliverable(i, { acceptanceCriteria: e.target.value })}
                rows={2}
                placeholder="Accepted when… (a testable behavior)"
                className="w-full rounded border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addDeliverable}
            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
          >
            <Plus className="h-3 w-3" /> Add deliverable
          </button>
        </div>
      </EditorSection>

      {/* Pre-work */}
      <EditorSection
        title="Pre-Work / Onboarding"
        hint="One-time costs before build starts. Add whatever applies to this project."
      >
        <BriefLineItems
          items={preWork}
          hourlyRate={hourlyRate}
          onChange={(items) => patch({ preWork: items })}
          disabled={isPending}
        />
        <div className="flex flex-wrap gap-1.5 pt-2">
          {PRE_WORK_SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => addPreWorkSuggestion(s.label, s.hours)}
              className="krowe-chip text-xs"
            >
              + {s.label}
            </button>
          ))}
        </div>
      </EditorSection>

      {/* Project line items */}
      <EditorSection title="Project Line Items" hint="The build itself. Auto-seeded from engagement tasks; edit freely.">
        <BriefLineItems
          items={projectItems}
          hourlyRate={hourlyRate}
          onChange={(items) => patch({ projectLineItems: items })}
          disabled={isPending}
        />
      </EditorSection>

      {/* Totals */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500">Pre-work subtotal</span>
          <span className="font-medium">{formatCurrency(totals.preWork)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500">Project subtotal</span>
          <span className="font-medium">{formatCurrency(totals.project)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-200 pt-1.5 mt-1.5">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Grand total</span>
          <span className="text-lg font-semibold">{formatCurrency(totals.grand)}</span>
        </div>
      </div>

      {/* Timeline */}
      <EditorSection title="Timeline" hint="Milestones and target dates.">
        <textarea
          value={content.timeline ?? ""}
          onChange={(e) => patch({ timeline: e.target.value })}
          rows={3}
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="Week 1: discovery. Weeks 2-4: build. Week 5: review + acceptance."
        />
      </EditorSection>

      {/* Out of scope */}
      <EditorSection title="Out of Scope" hint="Specific things explicitly NOT included.">
        <StringListEditor
          items={outOfScope}
          onChange={(items) => updateStringList("outOfScope", items)}
          placeholder="e.g. Native mobile app"
        />
        <div className="flex flex-wrap gap-1.5 pt-2">
          {OUT_OF_SCOPE_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addOutOfScopeSuggestion(s)}
              className="krowe-chip text-xs"
            >
              + {s}
            </button>
          ))}
        </div>
      </EditorSection>

      {/* Assumptions */}
      <EditorSection title="Assumptions" hint="What the proposal depends on the client doing.">
        <StringListEditor
          items={assumptions}
          onChange={(items) => updateStringList("assumptions", items)}
          placeholder="e.g. Client provides brand assets within 5 business days"
        />
      </EditorSection>

      {/* Footer actions repeated */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
        <Button variant="outline" onClick={save} disabled={isPending} size="sm">
          {isPending ? "Saving…" : saveLabel}
        </Button>
        {isDraft && (
          <Button onClick={send} disabled={isPending} size="sm">
            <Send className="h-3.5 w-3.5" /> Send to client
          </Button>
        )}
      </div>
    </div>
  );
}

function EditorSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {hint && <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function StringListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  function update(i: number, value: string) {
    onChange(items.map((it, idx) => (idx === i ? value : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, ""]);
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={it}
            onChange={(e) => update(i, e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-500"
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  );
}

interface BriefSentActionsProps {
  token: string;
}

export function BriefSentActions({ token }: BriefSentActionsProps) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const url = `${window.location.origin}/quote/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Button variant="outline" onClick={copy} size="sm">
      <Copy className="h-3.5 w-3.5" /> {copied ? "Copied!" : "Copy quote link"}
    </Button>
  );
}
