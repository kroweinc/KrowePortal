"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ActionResult = { error: string } | undefined;
type DocAction = (formData: FormData) => Promise<{ error: string } | void>;

interface NewDocFormProps {
  action: DocAction;
  projectId: string;
  initialTitle?: string | null;
  submitLabel: string;
  pendingLabel: string;
  titleLabel: string;
  titlePlaceholder: string;
  notesHint: string;
  notesPlaceholder: string;
}

export function NewDocForm({
  action,
  projectId,
  initialTitle,
  submitLabel,
  pendingLabel,
  titleLabel,
  titlePlaceholder,
  notesHint,
  notesPlaceholder,
}: NewDocFormProps) {
  const [title, setTitle] = useState(initialTitle ?? "");

  const [state, formAction, isPending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = await action(formData);
      return result ?? undefined;
    },
    undefined
  );

  useEffect(() => {
    if (state && "error" in state) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="projectId" value={projectId} />

      <Section title="About this document">
        <Field label={titleLabel} required>
          <input
            name="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <Section title="Notes" hint={notesHint}>
        <Field label="Raw notes" required>
          <textarea
            name="notes"
            rows={16}
            required
            placeholder={notesPlaceholder}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
        <Button type="submit" disabled={isPending}>
          {isPending ? pendingLabel : submitLabel}
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
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-900 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
