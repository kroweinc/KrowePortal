"use client";

/* PRD Dashboard — the builder's PRD screen with two modes:
   • Edit    — summary strip + section rail with click-any-field inline editing.
   • Preview — the same summary strip + section rail, read-only: every edit
               affordance (inputs, add/remove, Save/Send/Delete) hidden.
   Edits persist automatically (debounced) the moment any field — tech stack,
   integrations, any section — changes; the explicit Save button is an optional
   "save now". Also carries Send / Delete. */

import { useState, useTransition, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Send, Sparkles, Check, Link2, Receipt } from "lucide-react";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { updatePrdContent, sendPrd, deletePrd } from "@/lib/actions/prds";
import type { Prd, PrdContent } from "@/lib/types";
import { PrdDocument } from "@/components/prd/prd-document";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";
import { EditContext, InlineText } from "./inline-edit";
import { PrdStatStrip } from "./prd-stat-strip";
import { PrdRail } from "./prd-rail";
import { RefineSectionDialog } from "./refine-section-dialog";
import "./prd-dashboard.css";

/** How long after the last edit we flush to the server. */
const AUTOSAVE_DELAY_MS = 1200;

type SaveState = "saved" | "unsaved" | "saving" | "error";

/** Stable serialization of the editable surface, used to detect real changes. */
function serializePrd(title: string, content: PrdContent): string {
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

interface PrdDashboardProps {
  prd: Prd;
  backHref: string;
  projectName: string;
}

export function PrdDashboard({ prd, backHref, projectName }: PrdDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isDraft = prd.status === "draft";
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [title, setTitle] = useState(prd.title);
  const [content, setContent] = useState<PrdContent>(prd.content ?? {});
  const [refine, setRefine] = useState<{ open: boolean; sectionId: string | null }>({
    open: false,
    sectionId: null,
  });

  // --- Auto-save plumbing ----------------------------------------------------
  // `lastSavedRef` is the serialized snapshot the server currently holds; the live
  // snapshot differing from it is what "dirty" means. The latest title/content are
  // mirrored into refs so a single write function can always flush the freshest
  // values without going stale, and `savingRef`/`savePromiseRef` serialize writes
  // so two flushes never overlap (which could land out of order).
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const lastSavedRef = useRef(serializePrd(prd.title, prd.content ?? {}));
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;

  const snapshot = useMemo(() => serializePrd(title, content), [title, content]);
  const dirty = snapshot !== lastSavedRef.current;

  function patch(p: Partial<PrdContent> | ((prev: PrdContent) => Partial<PrdContent>)) {
    setContent((prev) => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));
  }

  /** Single source of truth for persistence. Waits for any in-flight write, then
      flushes the latest title/content if they differ from what's saved. Returns
      the action result (or null when there was nothing to save). */
  const writePrd = useCallback(async (): Promise<{ success: true } | { error: string } | null> => {
    if (savingRef.current && savePromiseRef.current) await savePromiseRef.current;
    const snap = serializePrd(titleRef.current, contentRef.current);
    if (snap === lastSavedRef.current) return null; // nothing changed
    savingRef.current = true;
    setSaveState("saving");
    const run = updatePrdContent(prd.id, { title: titleRef.current, content: contentRef.current });
    savePromiseRef.current = run.then(() => undefined);
    const result = await run;
    savingRef.current = false;
    if ("error" in result) {
      setSaveState("error");
      return result;
    }
    lastSavedRef.current = snap;
    // Only fall back to "saved" if a fresh edit didn't flip us to "unsaved" mid-flight.
    setSaveState((s) => (s === "saving" ? "saved" : s));
    return result;
  }, [prd.id]);

  // Debounced auto-save: whenever the doc is dirty (and no explicit action is in
  // flight), flush ~1.2s after the last change. Typing resets the timer.
  useEffect(() => {
    if (!dirty || isPending) return;
    setSaveState("unsaved");
    const t = setTimeout(() => void writePrd(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [dirty, isPending, snapshot, writePrd]);

  // Guard against closing the tab / hard-navigating with unsaved or in-flight edits.
  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saveState]);

  /** Explicit "save now" — flush immediately and surface the outcome. */
  function saveNow() {
    startTransition(async () => {
      const result = await writePrd();
      if (result && "error" in result) toast.error(result.error);
      else if (result) toast.success("Saved");
    });
  }

  /** Flush pending edits, then client-navigate (so in-app back never drops a change). */
  async function leave(href: string) {
    await writePrd();
    router.push(href);
  }

  /** Flush pending edits, then mark a draft "sent" so its public link resolves
      (clients get a 404 on a draft token). A non-draft is already shareable.
      Returns true on success. */
  async function publish(): Promise<boolean> {
    const saved = await writePrd();
    if (saved && "error" in saved) {
      toast.error(saved.error);
      return false;
    }
    if (!isDraft) return true;
    const result = await sendPrd(prd.id);
    if ("error" in result) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  function send() {
    if (!confirm("Send this PRD to the client? You can still edit it afterward.")) return;
    startTransition(async () => {
      if (!(await publish())) return;
      toast.success("PRD sent");
      router.refresh();
    });
  }

  /** Copy the public share link. Publishing a draft first makes it visible to
      the client, so confirm before flipping its status. */
  function copyLink() {
    if (isDraft && !confirm("Sharing a link makes this PRD visible to the client. Continue?")) return;
    const wasDraft = isDraft;
    startTransition(async () => {
      if (!(await publish())) return;
      const url = `${window.location.origin}/prd/${prd.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied");
      } catch {
        // Clipboard can be blocked (insecure context / denied permission) — show the URL so it's still usable.
        toast.message("Copy this link", { description: url });
      }
      if (wasDraft) router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deletePrd(prd.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(backHref);
    });
  }

  const editing = mode === "edit";

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

        <header className="dash-header">
          <div className="dash-header__actions">
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
              <Link
                href={`${backHref}/quotes/new?fromPrd=${prd.id}`}
                className="prd-btn prd-btn--outline"
                title="Generate a priced quote from this PRD"
              >
                <Receipt className="h-3.5 w-3.5" /> Generate quote
              </Link>
              <button
                type="button"
                className="prd-btn prd-btn--outline"
                onClick={copyLink}
                disabled={isPending}
              >
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

          <div className="dash-header__lead">
            <EditContext.Provider value={{ editing }}>
              <h1 className="dash-title dash-title--serif">
                <InlineText value={title} onChange={setTitle} placeholder="PRD title" serif />
              </h1>
            </EditContext.Provider>
            <div className="dash-meta">
              <BriefStatusPill status={prd.status} />
              {prd.sent_at && <span className="dash-updated">Sent {formatDateTime(prd.sent_at)}</span>}
            </div>
          </div>
        </header>

        <PrdStatStrip content={content} />

        <EditContext.Provider value={{ editing }}>
          <div className="dash-grid">
            <PrdRail
              content={content}
              patch={patch}
              onRefine={(sectionId) => setRefine({ open: true, sectionId })}
            />
          </div>
        </EditContext.Provider>
      </div>

      <RefineSectionDialog
        prdId={prd.id}
        open={refine.open}
        onOpenChange={(o) => setRefine((r) => ({ ...r, open: o }))}
        initialSectionId={refine.sectionId}
        currentContent={content}
        onApply={(p) => patch(p)}
      />
    </div>

    {/* Print-only canonical document — hidden on screen, surfaced when the
        builder hits Download PDF so the PDF matches the public client view
        exactly (not the editable rail). Renders the live, edited content. */}
    <div className="prd-doc-stage prd-print-only" aria-hidden="true">
      <div className="preview-stage">
        <div className="preview-doc">
          <header className="preview-head">
            <div className="preview-head__text">
              <p className="preview-eyebrow">Product Requirements Document</p>
              <h1 className="preview-title">{title}</h1>
            </div>
          </header>
          <div className="preview-card">
            <PrdDocument content={content} />
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
