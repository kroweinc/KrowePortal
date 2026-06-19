"use client";

/* Quote Dashboard — the builder's quote screen with two modes:
   • Edit    — total banner + section rail with click-any-field inline editing.
   • Preview — the same, read-only.
   Edits persist automatically (debounced); money edits recompute subtotals + the
   grand total live via recomputeTotals. Also carries Send / Delete / Copy-link.
   Mirrors prd-dashboard.tsx. */

import { useState, useTransition, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Sparkles, Check, Link2, Trash2 } from "lucide-react";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { updateQuoteContent, sendQuote, deleteQuote } from "@/lib/actions/quote-docs";
import type { Quote, QuoteContent } from "@/lib/types";
import { recomputeTotals, applyMilestonePercents } from "@/lib/quote/totals";
import { QuoteDocument } from "@/components/quote/quote-document";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";
import { EditContext, InlineText } from "@/components/prd/dashboard/inline-edit";
import { QuoteStatStrip } from "./quote-stat-strip";
import { QuoteRail } from "./quote-rail";
import { QuoteIdentity } from "./quote-sections";
import { RefineSectionDialog } from "./refine-section-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import "@/components/prd/dashboard/prd-dashboard.css";
import "@/components/quote/quote.css";

const AUTOSAVE_DELAY_MS = 1200;

type SaveState = "saved" | "unsaved" | "saving" | "error";

function serializeQuote(title: string, content: QuoteContent): string {
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

interface QuoteDashboardProps {
  quote: Quote;
  backHref: string;
  projectName: string;
}

export function QuoteDashboard({ quote, backHref, projectName }: QuoteDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const isDraft = quote.status === "draft";
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [title, setTitle] = useState(quote.title);
  // Heal on open: re-derive percent milestones from the grand total so a quote
  // saved before this logic (stale payment amounts) displays a tied-out payment
  // structure immediately, without waiting for the first edit.
  const initialContent = useMemo(
    () => applyMilestonePercents(recomputeTotals(quote.content ?? {})),
    [quote.content]
  );
  const [content, setContent] = useState<QuoteContent>(initialContent);
  const [refine, setRefine] = useState<{ open: boolean; sectionId: string | null }>({
    open: false,
    sectionId: null,
  });

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const lastSavedRef = useRef(serializeQuote(quote.title, initialContent));
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;

  const snapshot = useMemo(() => serializeQuote(title, content), [title, content]);
  const dirty = snapshot !== lastSavedRef.current;

  // Every patch recomputes totals so subtotals + grand total stay live, then
  // re-derives percent-based payment milestones from the new grand total so the
  // payment structure follows edits to hours / rate / modules. Milestones the
  // builder pinned to a fixed amount (percent cleared) are left untouched.
  function patch(p: Partial<QuoteContent> | ((prev: QuoteContent) => Partial<QuoteContent>)) {
    setContent((prev) =>
      applyMilestonePercents(recomputeTotals({ ...prev, ...(typeof p === "function" ? p(prev) : p) }))
    );
  }

  const writeQuote = useCallback(async (): Promise<{ success: true } | { error: string } | null> => {
    if (savingRef.current && savePromiseRef.current) await savePromiseRef.current;
    const snap = serializeQuote(titleRef.current, contentRef.current);
    if (snap === lastSavedRef.current) return null;
    savingRef.current = true;
    setSaveState("saving");
    const run = updateQuoteContent(quote.id, { title: titleRef.current, content: contentRef.current });
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
  }, [quote.id]);

  useEffect(() => {
    if (!dirty || isPending) return;
    setSaveState("unsaved");
    const t = setTimeout(() => void writeQuote(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [dirty, isPending, snapshot, writeQuote]);

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
      const result = await writeQuote();
      if (result && "error" in result) toast.error(result.error);
      else if (result) toast.success("Saved");
    });
  }

  async function leave(href: string) {
    await writeQuote();
    router.push(href);
  }

  async function publish(): Promise<boolean> {
    const saved = await writeQuote();
    if (saved && "error" in saved) {
      toast.error(saved.error);
      return false;
    }
    if (!isDraft) return true;
    const result = await sendQuote(quote.id);
    if ("error" in result) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  async function send() {
    if (
      !(await confirm({
        title: "Send this quote to the client?",
        description:
          "They’ll get a link to the live document. You can still edit it afterward — changes appear instantly.",
        confirmText: "Send to client",
        icon: Send,
        tone: "brand",
      }))
    )
      return;
    startTransition(async () => {
      if (!(await publish())) return;
      toast.success("Quote sent");
      router.refresh();
    });
  }

  async function copyLink() {
    if (
      isDraft &&
      !(await confirm({
        title: "Share this quote with the client?",
        description:
          "Copying the link publishes this draft so the client can open it. You can keep editing afterward.",
        confirmText: "Copy share link",
        icon: Link2,
        tone: "brand",
      }))
    )
      return;
    const wasDraft = isDraft;
    startTransition(async () => {
      if (!(await publish())) return;
      const url = `${window.location.origin}/quotes/${quote.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied");
      } catch {
        toast.message("Copy this link", { description: url });
      }
      if (wasDraft) router.refresh();
    });
  }

  async function remove() {
    if (
      !(await confirm({
        title: "Delete this draft?",
        description: "This permanently removes the quote. This can’t be undone.",
        confirmText: "Delete draft",
        cancelText: "Keep draft",
        icon: Trash2,
        tone: "danger",
      }))
    )
      return;
    startTransition(async () => {
      const result = await deleteQuote(quote.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(backHref);
    });
  }


  const editing = mode === "edit";
  const headerTitle = content.companyName || projectName;

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

          {/* Action toolbar — the old header bar's controls, kept intact. The
              quote title now folds into the summary strip below. */}
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
                <button
                  type="button"
                  className="prd-btn prd-btn--ghost"
                  onClick={() => setRefine({ open: true, sectionId: null })}
                  disabled={isPending}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Refine a section
                </button>
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

          {/* Summary strip — the title, with the client-identity pills (Company /
              Prepared for / Product) directly below it, then the stat cards. */}
          <EditContext.Provider value={{ editing }}>
            <div className="quote-summary">
              <div className="quote-summary__head">
                <div className="quote-summary__lead">
                  <h1 className="dash-title dash-title--serif">
                    <InlineText value={title} onChange={setTitle} placeholder="Quote title" serif />
                  </h1>
                  <QuoteIdentity content={content} patch={patch} />
                </div>
                <div className="dash-meta">
                  <BriefStatusPill status={quote.status} />
                  {quote.sent_at && <span className="dash-updated">Sent {formatDateTime(quote.sent_at)}</span>}
                </div>
              </div>
              <QuoteStatStrip content={content} status={quote.status} />
            </div>
          </EditContext.Provider>

          <EditContext.Provider value={{ editing }}>
            <div className="dash-grid">
              <QuoteRail
                content={content}
                patch={patch}
                onRefine={(sectionId) => setRefine({ open: true, sectionId })}
              />
            </div>
          </EditContext.Provider>
        </div>

        <RefineSectionDialog
          quoteId={quote.id}
          open={refine.open}
          onOpenChange={(o) => setRefine((r) => ({ ...r, open: o }))}
          initialSectionId={refine.sectionId}
          currentContent={content}
          onApply={(p) => patch(p)}
        />

        {confirmDialog}
      </div>

      {/* Print-only canonical document — surfaced on Download PDF so the PDF
          matches the public client view exactly. Renders the live, edited content. */}
      <div className="prd-doc-stage prd-print-only" aria-hidden="true">
        <div className="preview-stage">
          <div className="preview-doc">
            <header className="preview-head">
              <div className="preview-head__text">
                <p className="preview-eyebrow">Product Quote Breakdown</p>
                <h1 className="preview-title">{headerTitle}</h1>
                {content.productSubtitle && <p className="preview-prepared">{content.productSubtitle}</p>}
              </div>
            </header>
            <div className="preview-card">
              <QuoteDocument content={content} />
            </div>
            <p className="preview-footer">Powered by Krowe Portal</p>
          </div>
        </div>
      </div>
    </>
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
