"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/actions/projects";

type ActionResult = { error: string } | undefined;

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = await createProject(formData);
      return result ?? undefined;
    },
    undefined
  );

  useEffect(() => {
    if (state && "error" in state) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-8">
      <Section title="The business" hint="Who you're preparing documents for.">
        <Field label="Project name" required hint="Usually the business name.">
          <input
            name="name"
            type="text"
            required
            placeholder="e.g. Nissan of McKinney"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>

        <Field label="Contact name" hint="The person you're pitching. Optional.">
          <input
            name="prospectName"
            type="text"
            placeholder="e.g. Dana Reyes"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>

        <Field label="Contact email" hint="Where you'll send document links. Optional.">
          <input
            name="prospectEmail"
            type="email"
            placeholder="e.g. dana@example.com"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <Section title="Context" hint="Anything you know about the business. Used to seed AI drafts.">
        <Field label="Notes" hint="What they do, the problem, who's involved — whatever you have. Optional.">
          <textarea
            name="context"
            rows={8}
            placeholder="e.g. Car dealership, ~40 staff. Leads scattered across 5 sources and getting lost. Wants one place to track every lead."
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create project"}
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
