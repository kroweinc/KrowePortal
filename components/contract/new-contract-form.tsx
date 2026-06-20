"use client";

/* New-contract form. The builder picks which quote and PRD to build from
   (each shown with its price / status / created time, most-recent first),
   optionally adds extra terms as notes, and the AI drafts the agreement.
   Notes are optional — a contract can be drafted purely from the selected
   quote + PRD. Mirrors new-doc-form.tsx's action/toast plumbing. */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Receipt, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type DocAction = (formData: FormData) => Promise<{ error: string } | { contractId: string }>;

export interface ContractDocOption {
  id: string;
  title: string;
  status: string;
  createdLabel: string;
  priceLabel?: string;
}

interface Props {
  action: DocAction;
  projectId: string;
  initialTitle?: string | null;
  /** Project quotes, newest-first. */
  quotes: ContractDocOption[];
  /** Project PRDs, newest-first. */
  prds: ContractDocOption[];
  defaultQuoteId?: string | null;
  defaultPrdId?: string | null;
}

export function NewContractForm({
  action,
  projectId,
  initialTitle,
  quotes,
  prds,
  defaultQuoteId,
  defaultPrdId,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [quoteId, setQuoteId] = useState<string>(defaultQuoteId ?? "");
  const [prdId, setPrdId] = useState<string>(defaultPrdId ?? "");
  const [isPending, setIsPending] = useState(false);
  // Bumping this abandons an in-flight draft so a cancelled generation can't
  // navigate away when it finally resolves on the server.
  const genId = useRef(0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    const formData = new FormData(e.currentTarget);
    const myGen = ++genId.current;
    setIsPending(true);
    try {
      const result = await action(formData);
      if (myGen !== genId.current) return; // cancelled — ignore the result
      if ("error" in result) {
        toast.error(result.error);
        setIsPending(false);
        return;
      }
      // Leave the spinner up through the navigation that unmounts this form.
      router.push(`/b/projects/${projectId}/contract/${result.contractId}`);
    } catch (err) {
      if (myGen !== genId.current) return;
      toast.error(err instanceof Error ? err.message : "Couldn't draft the contract.");
      setIsPending(false);
    }
  }

  // Cancel an in-progress draft: abandon the result and restore the form (the
  // builder's title / quote / PRD / notes are all preserved).
  function cancel() {
    genId.current += 1;
    setIsPending(false);
  }

  // Esc cancels an in-progress draft, mirroring the Cancel button.
  useEffect(() => {
    if (!isPending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <input type="hidden" name="projectId" value={projectId} />
      {/* Radios are controlled in state and mirrored into these hidden fields,
          so the selected ids (or "" for none) post with the form. */}
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="prdId" value={prdId} />

      <Section title="About this document">
        <Field label="Contract title" required>
          <input
            name="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lead portal — Services Agreement"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <Section
        title="Quote"
        hint="Attach a quote to freeze its total and payment schedule into the contract."
      >
        <DocPicker
          icon="quote"
          options={quotes}
          value={quoteId}
          onChange={setQuoteId}
          emptyLabel="No quotes in this document yet — drafting without pricing."
          noneLabel="No quote — draft without pricing"
        />
      </Section>

      <Section
        title="PRD"
        hint="Attach a PRD to base the scope of services and deliverables on it."
      >
        <DocPicker
          icon="prd"
          options={prds}
          value={prdId}
          onChange={setPrdId}
          emptyLabel="No PRDs in this document yet — drafting without a scope source."
          noneLabel="No PRD — draft without a scope source"
        />
      </Section>

      <Section
        title="Notes"
        hint="Optional. Extra terms or context for the AI — ownership, warranty, jurisdiction, anything special. Fair defaults fill the rest."
      >
        <Field label="Notes">
          <textarea
            name="notes"
            rows={5}
            placeholder={`e.g. Client owns the code once paid in full. 30-day warranty. Texas law.`}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-100">
        {isPending ? (
          <>
            <span className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Drafting…
            </span>
            <button
              type="button"
              onClick={cancel}
              className="text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-700 hover:underline"
            >
              Cancel · Esc
            </button>
          </>
        ) : (
          <Button type="submit">Generate contract draft</Button>
        )}
      </div>
    </form>
  );
}

function DocPicker({
  icon,
  options,
  value,
  onChange,
  emptyLabel,
  noneLabel,
}: {
  icon: "quote" | "prd";
  options: ContractDocOption[];
  value: string;
  onChange: (v: string) => void;
  emptyLabel: string;
  noneLabel: string;
}) {
  const Icon = icon === "quote" ? Receipt : FileText;
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const selected = value === o.id;
        return (
          <label
            key={o.id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition ${
              selected
                ? "border-neutral-700 bg-neutral-50"
                : "border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <input
              type="radio"
              checked={selected}
              onChange={() => onChange(o.id)}
              className="mt-1 h-3.5 w-3.5 shrink-0 accent-neutral-700"
            />
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-neutral-900">{o.title}</span>
                {o.priceLabel && (
                  <span className="rounded-full border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-neutral-700">
                    {o.priceLabel}
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-500">
                <span className="uppercase tracking-wide text-neutral-400">{o.status}</span>
                <span aria-hidden>·</span>
                <span>{o.createdLabel}</span>
              </span>
            </span>
          </label>
        );
      })}

      <label
        className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm transition ${
          value === ""
            ? "border-neutral-700 bg-neutral-50 text-neutral-900"
            : "border-neutral-200 text-neutral-500 hover:border-neutral-300"
        }`}
      >
        <input
          type="radio"
          checked={value === ""}
          onChange={() => onChange("")}
          className="h-3.5 w-3.5 shrink-0 accent-neutral-700"
        />
        <span>{options.length ? noneLabel : emptyLabel}</span>
      </label>
    </div>
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
