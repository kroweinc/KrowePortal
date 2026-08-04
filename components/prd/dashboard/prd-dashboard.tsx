"use client";

/* PRD Dashboard — the builder's PRD screen: summary strip + section rail with
   click-any-field inline editing. Always editable; the client-facing read-only
   rendering lives in the public view and the print stage below.
   Edits persist automatically (debounced) the moment any field — tech stack,
   integrations, any section — changes; the explicit Save button is an optional
   "save now". Also carries Send / Delete. */

import { useState, useTransition, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Send,
  Check,
  ChevronLeft,
  Download,
  Link2,
  Receipt,
  RotateCcw,
  Settings2,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { updatePrdContent, sendPrd, deletePrd } from "@/lib/actions/prds";
import type { Prd, PrdContent } from "@/lib/types";
import { PrdDocument } from "@/components/prd/prd-document";
import { printPrd } from "@/components/prd/prd-download-button";
import { ShareLinkControls } from "@/components/doc/share-link-controls";
import { ContextMenu, useContextMenu, type MenuItem } from "@/components/ui/context-menu";
import { EditContext, InlineText } from "./inline-edit";
import { PrdStatStrip } from "./prd-stat-strip";
import { PrdRail } from "./prd-rail";
import { RefineSectionDialog } from "./refine-section-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import "./prd-dashboard.css";
import "./prd-editor.css";

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
  const [confirm, confirmDialog] = useConfirm();
  const options = useContextMenu();

  const isDraft = prd.status === "draft";
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

  async function send() {
    const ok = await confirm({
      title: "Send this PRD to the client?",
      description:
        "They’ll get a link to the live document. You can still edit it afterward — changes appear instantly.",
      confirmText: "Send to client",
      icon: Send,
      tone: "brand",
    });
    if (!ok) return;
    startTransition(async () => {
      if (!(await publish())) return;
      toast.success("PRD sent");
      router.refresh();
    });
  }

  /** Copy the public share link. Publishing a draft first makes it visible to
      the client, so confirm before flipping its status. */
  async function copyLink() {
    if (isDraft) {
      const ok = await confirm({
        title: "Share this PRD with the client?",
        description:
          "Copying the link publishes this draft so the client can open it. You can keep editing afterward.",
        confirmText: "Copy share link",
        icon: Link2,
        tone: "brand",
      });
      if (!ok) return;
    }
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

  /** Start the PRD over: back through the wizard, which replaces this draft in
      place when it finishes (same id, same share link). Draft-only. */
  async function regenerate() {
    const ok = await confirm({
      title: "Start this PRD over?",
      description:
        "You’ll go back through the wizard. When it finishes, this draft’s content is replaced — the share link stays the same.",
      confirmText: "Restart wizard",
      cancelText: "Keep this draft",
      icon: RotateCcw,
      tone: "brand",
    });
    if (!ok) return;
    void leave(`${backHref}/prd/new?regenerate=${prd.id}`);
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this draft?",
      description: "This permanently removes the PRD. This can’t be undone.",
      confirmText: "Delete draft",
      cancelText: "Keep draft",
      icon: Trash2,
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deletePrd(prd.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(backHref);
    });
  }

  /* "Options" — everything that isn't Refine or Send. Kept in one menu so the
     sticky header stays a single row at document width. */
  const optionItems: MenuItem[] = [
    {
      label: "Download PDF",
      icon: <Download className="h-3.5 w-3.5" />,
      onSelect: () => printPrd(title),
    },
    {
      label: "Generate quote",
      icon: <Receipt className="h-3.5 w-3.5" />,
      onSelect: () => leave(`${backHref}/quotes/new?fromPrd=${prd.id}`),
    },
    {
      label: "Copy link",
      icon: <Link2 className="h-3.5 w-3.5" />,
      onSelect: copyLink,
    },
    // Regenerate and Delete are both draft-only — a sent PRD is live at a link the
    // client may already hold, so neither rewrites nor removes it out from under them.
    ...(isDraft
      ? [
          {
            label: "Regenerate",
            icon: <RotateCcw className="h-3.5 w-3.5" />,
            onSelect: regenerate,
            separatorBefore: true,
          },
          {
            label: "Delete draft",
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onSelect: remove,
            destructive: true,
            separatorBefore: true,
          },
        ]
      : []),
  ];

  return (
    <>
    <div className="prd-dashboard prd-editor">
      <div className="dash">
        <header className="dash-dochead">
          <div className="dochead-lead">
            <button
              type="button"
              className="dochead-back"
              onClick={() => void leave(backHref)}
              title={`Back to ${projectName}`}
              aria-label={`Back to ${projectName}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <EditContext.Provider value={{ editing: true }}>
              <h1 className="dash-title">
                <InlineText value={title} onChange={setTitle} placeholder="PRD title" />
              </h1>
            </EditContext.Provider>
            <div className="dash-meta">
              <BriefStatusPill status={prd.status} />
              {prd.sent_at && <span className="dash-updated">Sent {formatDateTime(prd.sent_at)}</span>}
            </div>
          </div>

          <div className="dochead-actions">
            <SaveControl
              state={saveState}
              dirty={dirty}
              isDraft={isDraft}
              isPending={isPending}
              onSave={saveNow}
            />
            <button
              type="button"
              className="prd-btn prd-btn--primary"
              onClick={() => setRefine({ open: true, sectionId: null })}
              disabled={isPending}
            >
              <WandSparkles className="h-3.5 w-3.5" /> Refine
            </button>
            {isDraft && (
              <button type="button" className="prd-btn prd-btn--outline" onClick={send} disabled={isPending}>
                <Send className="h-3.5 w-3.5" /> Send to client
              </button>
            )}
            <ShareLinkControls
              kind="prd"
              id={prd.id}
              token={prd.token}
              expiresAt={prd.token_expires_at}
              revokedAt={prd.token_revoked_at}
              isDraft={isDraft}
            />
            <button
              type="button"
              className="prd-btn prd-btn--outline"
              onClick={(e) => options.openAtAnchor(e.currentTarget)}
              disabled={isPending}
              aria-haspopup="menu"
              aria-expanded={options.isOpen}
            >
              <Settings2 className="h-3.5 w-3.5" /> Options
            </button>
          </div>
        </header>

        <PrdStatStrip content={content} />

        <EditContext.Provider value={{ editing: true }}>
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

      <ContextMenu state={options.state} items={optionItems} onClose={options.close} />

      {confirmDialog}
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
