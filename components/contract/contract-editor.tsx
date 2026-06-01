"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorSection, TextField, StringListEditor } from "@/components/doc/editor-primitives";
import {
  updateContractContent,
  sendContract,
  deleteContract,
  regenerateContract,
} from "@/lib/actions/contracts";
import type { Contract, ContractContent } from "@/lib/types";

// Long-form sections rendered as labeled textareas, in document order.
const TEXT_SECTIONS: { key: keyof ContractContent; title: string; hint?: string }[] = [
  { key: "scopeOfServices", title: "Scope of Services" },
  { key: "fees", title: "Fees", hint: "Pricing model and amounts." },
  { key: "paymentTerms", title: "Payment Terms", hint: "Schedule, deposit, late fees." },
  { key: "timeline", title: "Timeline" },
  { key: "ipOwnership", title: "Intellectual Property" },
  { key: "confidentiality", title: "Confidentiality" },
  { key: "warranties", title: "Warranties" },
  { key: "liability", title: "Limitation of Liability" },
  { key: "termination", title: "Termination" },
  { key: "changeManagement", title: "Change Management" },
  { key: "governingLaw", title: "Governing Law" },
];

interface ContractEditorProps {
  contract: Contract;
  backHref: string;
}

export function ContractEditor({ contract, backHref }: ContractEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isDraft = contract.status === "draft";
  const [title, setTitle] = useState(contract.title);
  const [content, setContent] = useState<ContractContent>(contract.content ?? {});
  const [notes, setNotes] = useState(contract.source_notes ?? "");
  const [showRegen, setShowRegen] = useState(false);

  function patch(p: Partial<ContractContent>) {
    setContent((prev) => ({ ...prev, ...p }));
  }
  function patchParties(p: Partial<NonNullable<ContractContent["parties"]>>) {
    setContent((prev) => ({ ...prev, parties: { ...prev.parties, ...p } }));
  }

  function save() {
    startTransition(async () => {
      const result = await updateContractContent(contract.id, { title, content });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  function send() {
    if (!confirm("Send this contract to the client? You can still edit it afterward.")) return;
    startTransition(async () => {
      const saved = await updateContractContent(contract.id, { title, content });
      if ("error" in saved) {
        toast.error(saved.error);
        return;
      }
      const result = await sendContract(contract.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Contract sent");
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteContract(contract.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(backHref);
    });
  }

  function regenerate() {
    if (!confirm("Re-draft this contract from the notes below? Your current edits will be replaced.")) return;
    startTransition(async () => {
      const result = await regenerateContract(contract.id, notes);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setContent(result.content);
      setShowRegen(false);
      toast.success("Re-drafted");
      router.refresh();
    });
  }

  const actions = (
    <div className="flex items-center gap-2 shrink-0">
      {isDraft && (
        <Button variant="ghost" onClick={remove} disabled={isPending} size="sm">
          Delete
        </Button>
      )}
      <Button variant="outline" onClick={save} disabled={isPending} size="sm">
        {isPending ? "Saving…" : isDraft ? "Save draft" : "Save changes"}
      </Button>
      {isDraft && (
        <Button onClick={send} disabled={isPending} size="sm">
          <Send className="h-3.5 w-3.5" /> Send to client
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Contract title"
          className="flex-1 text-2xl font-semibold text-neutral-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-neutral-300"
        />
        {actions}
      </div>

      {isDraft && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <button
            type="button"
            onClick={() => setShowRegen((s) => !s)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            <Sparkles className="h-4 w-4" /> Re-draft from notes
          </button>
          {showRegen && (
            <div className="mt-3 space-y-2">
              <TextField value={notes} onChange={setNotes} rows={8} placeholder="Paste fresh notes to re-draft from…" />
              <div className="flex justify-end">
                <Button onClick={regenerate} disabled={isPending} size="sm">
                  {isPending ? "Drafting…" : "Re-draft contract"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Parties */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Provider</span>
            <input
              type="text"
              value={content.parties?.provider ?? ""}
              onChange={(e) => patchParties({ provider: e.target.value })}
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Client</span>
            <input
              type="text"
              value={content.parties?.client ?? ""}
              onChange={(e) => patchParties({ client: e.target.value })}
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Effective date</span>
            <input
              type="text"
              value={content.effectiveDate ?? ""}
              onChange={(e) => patch({ effectiveDate: e.target.value })}
              placeholder="e.g. 2026-06-01"
              className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
        </div>
      </div>

      <EditorSection title="Deliverables" hint="Concrete outcomes the provider will deliver.">
        <StringListEditor
          items={content.deliverables ?? []}
          onChange={(v) => patch({ deliverables: v })}
          placeholder="e.g. Lead management web app"
        />
      </EditorSection>

      {TEXT_SECTIONS.map((s) => (
        <EditorSection key={s.key as string} title={s.title} hint={s.hint}>
          <TextField
            value={(content[s.key] as string | undefined) ?? ""}
            onChange={(v) => patch({ [s.key]: v } as Partial<ContractContent>)}
            rows={3}
          />
        </EditorSection>
      ))}

      <EditorSection title="Additional Terms" hint="Any other clauses.">
        <StringListEditor
          items={content.additionalTerms ?? []}
          onChange={(v) => patch({ additionalTerms: v })}
          placeholder="e.g. Provider may display the work in their portfolio"
        />
      </EditorSection>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">{actions}</div>
    </div>
  );
}
