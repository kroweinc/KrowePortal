"use client";

/* Contract Dashboard — the builder's contract screen with two modes:
   • Edit    — a structured form: parties, prose clauses, and the editable
               Scope-of-Work / Payment-Schedule exhibits (snapshotted from the
               quote breakdown).
   • Preview — the canonical ContractDocument the client e-signs.
   Edits persist automatically (debounced). Carries Send / Delete / Copy-link /
   Download PDF. Mirrors quote-dashboard.tsx. */

import { useState, useTransition, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Check, Link2, Plus, X } from "lucide-react";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import {
  updateContractContent,
  sendContract,
  deleteContract,
} from "@/lib/actions/contracts";
import type {
  Contract,
  ContractContent,
  ContractScopeItem,
  ContractPaymentMilestone,
} from "@/lib/types";
import { ContractDocument } from "@/components/contract/contract-document";
import { useTodayISODate } from "@/lib/contract/use-today";
import { formatEffectiveDate } from "@/lib/contract/effective-date";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";
import { EditContext, InlineText } from "@/components/prd/dashboard/inline-edit";
import { EditorSection, TextField, StringListEditor } from "@/components/doc/editor-primitives";
import { formatUSD, parseMoney } from "@/lib/quote/format";
import "@/components/prd/dashboard/prd-dashboard.css";
import "@/components/quote/quote.css";

const AUTOSAVE_DELAY_MS = 1200;

type SaveState = "saved" | "unsaved" | "saving" | "error";

// Long-form clauses, edited as labeled textareas in document order.
const TEXT_SECTIONS: { key: keyof ContractContent; title: string; hint?: string }[] = [
  { key: "paymentTerms", title: "Payment Terms", hint: "Deposit, invoicing cadence, late fees." },
  { key: "timeline", title: "Timeline" },
  { key: "ipOwnership", title: "Intellectual Property" },
  { key: "confidentiality", title: "Confidentiality" },
  { key: "warranties", title: "Warranties" },
  { key: "liability", title: "Limitation of Liability" },
  { key: "termination", title: "Termination" },
  { key: "changeManagement", title: "Change Management" },
  { key: "governingLaw", title: "Governing Law" },
];

function serializeContract(title: string, content: ContractContent): string {
  return JSON.stringify({ title, content });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ContractDashboardProps {
  contract: Contract;
  backHref: string;
  projectName: string;
}

export function ContractDashboard({ contract, backHref, projectName }: ContractDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isDraft = contract.status === "draft";
  const [mode, setMode] = useState<"edit" | "preview">(isDraft ? "edit" : "preview");
  const [title, setTitle] = useState(contract.title);
  const [content, setContent] = useState<ContractContent>(contract.content ?? {});

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const lastSavedRef = useRef(serializeContract(contract.title, contract.content ?? {}));
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;

  const snapshot = useMemo(() => serializeContract(title, content), [title, content]);
  const dirty = snapshot !== lastSavedRef.current;
  const editable = contract.status !== "signed";

  // The effective date is system-managed: it floats to today while the contract
  // is a draft, then freezes to the day it's sent. Once sent, use the frozen
  // value from the server (the prop), not local edit state.
  const today = useTodayISODate();
  const effectiveDate = isDraft ? today : contract.content?.effectiveDate ?? null;

  function patch(p: Partial<ContractContent>) {
    setContent((prev) => ({ ...prev, ...p }));
  }
  function patchParties(p: Partial<NonNullable<ContractContent["parties"]>>) {
    setContent((prev) => ({ ...prev, parties: { ...prev.parties, ...p } }));
  }

  const writeContract = useCallback(async (): Promise<{ success: true } | { error: string } | null> => {
    if (savingRef.current && savePromiseRef.current) await savePromiseRef.current;
    const snap = serializeContract(titleRef.current, contentRef.current);
    if (snap === lastSavedRef.current) return null;
    savingRef.current = true;
    setSaveState("saving");
    const run = updateContractContent(contract.id, { title: titleRef.current, content: contentRef.current });
    savePromiseRef.current = run.then(() => undefined);
    const result = await run;
    savingRef.current = false;
    if ("error" in result) {
      setSaveState("error");
      return result;
    }
    lastSavedRef.current = snap;
    setSaveState((s) => (s === "saving" ? "saved" : s));
    return result;
  }, [contract.id]);

  useEffect(() => {
    if (!dirty || isPending || !editable) return;
    setSaveState("unsaved");
    const t = setTimeout(() => void writeContract(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [dirty, isPending, editable, snapshot, writeContract]);

  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saveState]);

  function saveNow() {
    startTransition(async () => {
      const result = await writeContract();
      if (result && "error" in result) toast.error(result.error);
      else if (result) toast.success("Saved");
    });
  }

  async function leave(href: string) {
    if (editable) await writeContract();
    router.push(href);
  }

  async function publish(): Promise<boolean> {
    const saved = await writeContract();
    if (saved && "error" in saved) {
      toast.error(saved.error);
      return false;
    }
    if (!isDraft) return true;
    const result = await sendContract(contract.id, today);
    if ("error" in result) {
      toast.error(result.error);
      return false;
    }
    // Mirror the frozen effective date into local state so later edits (a sent
    // contract is still editable) don't autosave it back to empty.
    setContent((prev) => ({ ...prev, effectiveDate: result.effectiveDate }));
    return true;
  }

  function send() {
    if (!confirm("Send this contract to the client? You can still edit it afterward.")) return;
    startTransition(async () => {
      if (!(await publish())) return;
      toast.success("Contract sent");
      router.refresh();
    });
  }

  function copyLink() {
    if (isDraft && !confirm("Sharing a link makes this contract visible to the client. Continue?")) return;
    const wasDraft = isDraft;
    startTransition(async () => {
      if (!(await publish())) return;
      const url = `${window.location.origin}/contract/${contract.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied");
      } catch {
        toast.message("Copy this link", { description: url });
      }
      if (wasDraft) router.refresh();
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

  const editing = mode === "edit" && editable;
  const providerName = content.parties?.provider;

  return (
    <>
      <div className="prd-dashboard">
        <div className="dash">
          <a
            href={backHref}
            className="dash-back"
            onClick={(e) => {
              e.preventDefault();
              void leave(backHref);
            }}
          >
            ← {projectName}
          </a>

          <div className="quote-toolbar">
            <div className="mode-toggle" role="tablist" aria-label="View mode">
              <button
                type="button"
                className={"mode-seg" + (mode === "preview" ? " is-active" : "")}
                onClick={() => setMode("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                className={"mode-seg" + (mode === "edit" ? " is-active" : "")}
                onClick={() => setMode("edit")}
                disabled={!editable}
              >
                Edit
              </button>
            </div>
            <PrdDownloadButton title={title} className="prd-btn prd-btn--outline" />
            <button type="button" className="prd-btn prd-btn--outline" onClick={copyLink} disabled={isPending}>
              <Link2 className="h-3.5 w-3.5" /> Copy link
            </button>
            {editing && (
              <div className="dash-actions">
                {isDraft && (
                  <button type="button" className="prd-btn prd-btn--ghost" onClick={remove} disabled={isPending}>
                    Delete
                  </button>
                )}
                <SaveControl
                  state={saveState}
                  dirty={dirty}
                  isDraft={isDraft}
                  isPending={isPending}
                  onSave={saveNow}
                />
                {isDraft && (
                  <button type="button" className="prd-btn prd-btn--primary" onClick={send} disabled={isPending}>
                    <Send className="h-3.5 w-3.5" /> Send to client
                  </button>
                )}
              </div>
            )}
          </div>

          <EditContext.Provider value={{ editing }}>
            <div className="quote-summary">
              <div className="quote-summary__head">
                <div className="quote-summary__lead">
                  <h1 className="dash-title dash-title--serif">
                    <InlineText value={title} onChange={setTitle} placeholder="Contract title" serif />
                  </h1>
                </div>
                <div className="dash-meta">
                  <BriefStatusPill status={contract.status} />
                  {contract.sent_at && <span className="dash-updated">Sent {formatDateTime(contract.sent_at)}</span>}
                  {contract.signed_at && (
                    <span className="dash-updated">
                      Signed {formatDateTime(contract.signed_at)}
                      {contract.signed_by_name ? ` by ${contract.signed_by_name}` : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </EditContext.Provider>

          {editing ? (
            <div className="dash-grid">
              <div className="space-y-6">
                {/* Parties */}
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                  <div className="grid grid-cols-3 gap-4">
                    <PartyField label="Provider" value={content.parties?.provider} onChange={(v) => patchParties({ provider: v })} />
                    <PartyField label="Client" value={content.parties?.client} onChange={(v) => patchParties({ client: v })} />
                    <ReadOnlyField
                      label="Effective date"
                      value={formatEffectiveDate(effectiveDate)}
                      hint={isDraft ? "Set to today — locks when sent." : "Locked on send."}
                    />
                  </div>
                </div>

                <EditorSection title="Scope of Services">
                  <TextField value={content.scopeOfServices ?? ""} onChange={(v) => patch({ scopeOfServices: v })} rows={4} />
                </EditorSection>

                <EditorSection title="Deliverables" hint="Concrete outcomes the provider will deliver.">
                  <StringListEditor
                    items={content.deliverables ?? []}
                    onChange={(v) => patch({ deliverables: v })}
                    placeholder="e.g. Lead management web app"
                  />
                </EditorSection>

                <EditorSection title="Exhibit A — Scope of Work" hint="Pulled from the quote breakdown. Edit to match the agreed build.">
                  <ScopeItemsEditor items={content.scopeItems ?? []} onChange={(v) => patch({ scopeItems: v })} />
                </EditorSection>

                <EditorSection title="Fees">
                  <TextField value={content.fees ?? ""} onChange={(v) => patch({ fees: v })} rows={3} />
                </EditorSection>

                <EditorSection title="Exhibit B — Payment Schedule" hint="Pulled from the quote's payment milestones. Amounts are frozen into the signed contract.">
                  <PaymentScheduleEditor
                    items={content.paymentSchedule ?? []}
                    total={content.quoteTotal ?? null}
                    onChange={(v) => patch({ paymentSchedule: v })}
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
              </div>
            </div>
          ) : (
            <div className="prd-doc-stage">
              <div className="preview-stage">
                <div className="preview-doc">
                  <header className="preview-head">
                    <div className="preview-head__text">
                      <p className="preview-eyebrow">Services Agreement</p>
                      <h1 className="preview-title">{title}</h1>
                      {providerName && (
                        <p className="preview-prepared">
                          Prepared by <span>{providerName}</span>
                        </p>
                      )}
                    </div>
                  </header>
                  <div className="preview-card">
                    <ContractDocument content={content} effectiveDate={effectiveDate} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Print-only canonical document — surfaced on Download PDF so the PDF
          matches the public client view exactly. Renders the live content. */}
      <div className="prd-doc-stage prd-print-only" aria-hidden="true">
        <div className="preview-stage">
          <div className="preview-doc">
            <header className="preview-head">
              <div className="preview-head__text">
                <p className="preview-eyebrow">Services Agreement</p>
                <h1 className="preview-title">{title}</h1>
                {providerName && (
                  <p className="preview-prepared">
                    Prepared by <span>{providerName}</span>
                  </p>
                )}
              </div>
            </header>
            <div className="preview-card">
              <ContractDocument content={content} effectiveDate={effectiveDate} />
            </div>
            <p className="preview-footer">Powered by Krowe Portal</p>
          </div>
        </div>
      </div>
    </>
  );
}

function PartyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">{label}</span>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
      />
    </label>
  );
}

// System-managed field shown in the parties grid (e.g. the effective date,
// which floats to today until the contract is sent, then locks).
function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value?: string | null;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">{label}</span>
      <div className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-700 tabular-nums">
        {value || "—"}
      </div>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </label>
  );
}

// A money cell with a local string draft so typing isn't fought by re-parsing.
function MoneyCell({ value, onChange }: { value?: number | null; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!active) setDraft(value != null ? String(value) : "");
  }, [value, active]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setActive(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setActive(false);
        onChange(parseMoney(draft));
      }}
      placeholder="$0"
      className="w-28 rounded border border-neutral-200 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-neutral-400"
    />
  );
}

function RowInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={"rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 " + className}
    />
  );
}

function RemoveRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-500"
      aria-label="Remove"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900">
      <Plus className="h-3 w-3" /> {label}
    </button>
  );
}

function ScopeItemsEditor({ items, onChange }: { items: ContractScopeItem[]; onChange: (v: ContractScopeItem[]) => void }) {
  const update = (i: number, p: Partial<ContractScopeItem>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <RowInput value={it.title} onChange={(v) => update(i, { title: v })} placeholder="Item" className="flex-1" />
          <RowInput value={it.purpose} onChange={(v) => update(i, { purpose: v })} placeholder="Purpose" className="flex-1" />
          <MoneyCell value={it.cost} onChange={(n) => update(i, { cost: n })} />
          <RemoveRow onClick={() => onChange(items.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <AddRow label="Add scope item" onClick={() => onChange([...items, { title: "", purpose: "", cost: 0 }])} />
    </div>
  );
}

function PaymentScheduleEditor({
  items,
  total,
  onChange,
}: {
  items: ContractPaymentMilestone[];
  total: number | null;
  onChange: (v: ContractPaymentMilestone[]) => void;
}) {
  const update = (i: number, p: Partial<ContractPaymentMilestone>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  const sum = items.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const shownTotal = total != null ? total : sum;
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <RowInput value={it.label} onChange={(v) => update(i, { label: v })} placeholder="Milestone" className="flex-1" />
          <input
            type="text"
            inputMode="numeric"
            value={it.percent != null ? String(it.percent) : ""}
            onChange={(e) => {
              const n = e.target.value.replace(/[^0-9]/g, "");
              update(i, { percent: n === "" ? null : Number(n) });
            }}
            placeholder="%"
            className="w-14 rounded border border-neutral-200 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <MoneyCell value={it.amount} onChange={(n) => update(i, { amount: n })} />
          <RemoveRow onClick={() => onChange(items.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <AddRow label="Add milestone" onClick={() => onChange([...items, { label: "", amount: 0, percent: null }])} />
        <span className="text-xs text-neutral-500">
          Total <span className="font-medium text-neutral-800 tabular-nums">{formatUSD(shownTotal)}</span>
        </span>
      </div>
    </div>
  );
}

/** Combined save pill: reflects the live auto-save state and, whenever there are
    pending edits, doubles as the explicit "save now" button. At rest it reads
    "Saved"; with unsaved edits it reads "Save draft" / "Save changes". */
function SaveControl({
  state,
  dirty,
  isDraft,
  isPending,
  onSave,
}: {
  state: SaveState;
  dirty: boolean;
  isDraft: boolean;
  isPending: boolean;
  onSave: () => void;
}) {
  if (state === "saving") {
    return (
      <span className="prd-btn prd-btn--outline is-saved" aria-live="polite">
        <span className="save-spinner" aria-hidden="true" /> Saving…
      </span>
    );
  }
  if (state === "error") {
    return (
      <button
        type="button"
        className="prd-btn prd-btn--outline is-error"
        onClick={onSave}
        disabled={isPending}
        aria-live="polite"
      >
        Save failed — retry
      </button>
    );
  }
  if (dirty) {
    return (
      <button type="button" className="prd-btn prd-btn--outline" onClick={onSave} disabled={isPending}>
        {isDraft ? "Save draft" : "Save changes"}
      </button>
    );
  }
  return (
    <span className="prd-btn prd-btn--outline is-saved" aria-live="polite">
      <Check className="h-3 w-3" aria-hidden="true" /> Saved
    </span>
  );
}
