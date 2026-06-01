"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createBriefDraft } from "@/lib/actions/briefs";

type ActionResult = { error: string } | undefined;

interface NewBriefFormProps {
  projectId: string;
  initialTitle?: string | null;
  initialClientName?: string | null;
}

export function NewBriefForm({ projectId, initialTitle, initialClientName }: NewBriefFormProps) {
  const [title, setTitle] = useState(initialTitle ?? "");

  const [state, formAction, isPending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = await createBriefDraft(formData);
      return result ?? undefined;
    },
    undefined
  );

  useEffect(() => {
    if (state && "error" in state) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="projectId" value={projectId} />
      <Section
        title="About this project"
        hint="Identifying info — what is it and who's it for."
      >
        <Field label="Quote title" required hint="A short internal name for this quote.">
          <input
            name="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Customer education portal — Phase 1"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>

        <Field label="Client / company name" hint="Who is this for? Shown on the quote.">
          <input
            name="clientName"
            type="text"
            defaultValue={initialClientName ?? ""}
            placeholder="e.g. Nissan of McKinney"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <Section
        title="Discovery-call notes"
        hint="Paste your raw notes from the discovery call — messy is fine. The AI organizes them into a structured SOP, then drafts the quote."
      >
        <Field
          label="Raw notes"
          required
          hint="Don't clean these up. Dump everything you captured: their business, the problem, what they want, who's involved, timeline, budget signals — whatever you have."
        >
          <textarea
            name="rawNotes"
            rows={16}
            required
            placeholder={`e.g.\nNissan of McKinney — sells/services cars, ~40 staff. Pain: leads come in from 5 sources (web form, calls, walk-ins, FB, AutoTrader) and get lost in a shared inbox + whiteboard. Manager spends 2hrs/day reconciling. Wants one place to see every lead + who's on it.\nThinks it should look like a Trello board. Already tried a spreadsheet, broke at scale.\nUses HubSpot CRM (sort of), DealerSocket DMS. GM signs off, sales manager reviews daily.\nWants it before Q3 sales push (~6 wks). Budget unclear, mentioned they pay $1500/mo for tools they barely use.`}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Parsing & drafting…" : "Generate quote draft"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-4 pl-3 border-l-2 border-neutral-100">{children}</div>
    </section>
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
