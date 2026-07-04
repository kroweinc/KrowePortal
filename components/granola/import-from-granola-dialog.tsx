"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  listGranolaNotesForImport,
  importGranolaNoteToProject,
  draftTasksFromGranolaNote,
  draftTasksFromPastedTranscript,
  draftTasksFromTranscriptFile,
  approveGranolaTasks,
  approveExtractedTasks,
  type ApprovedTaskDraft,
  type GranolaFolderItem,
  type GranolaImportTargetInput,
  type GranolaNoteListItem,
} from "@/lib/actions/granola-import";
import { GranolaTaskReview } from "@/components/granola/granola-task-review";
import { GrSelect } from "@/components/granola/gr-select";
import { streamTaskDrafts } from "@/lib/ai/stream-client";
import { SOP_ACCEPT, MAX_SOP_CHARS } from "@/lib/attachments-constants";
import type { ExtractedTaskDraft } from "@/lib/ai/schemas";
import type { ProjectSopTranscript } from "@/lib/types";

type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not-connected" }
  | { status: "key-invalid" }
  | { status: "error"; message: string }
  | { status: "ready"; notes: GranolaNoteListItem[]; cursor: string | null; hasMore: boolean };

interface ReviewState {
  /** Granola calls carry the note id for the dedupe ledger; pasted/uploaded
      transcripts have no note behind them. */
  source: { kind: "granola"; noteId: string } | { kind: "manual" };
  noteTitle: string | null;
  noteCreatedAt: string | null;
  drafts: ExtractedTaskDraft[];
  /** True while drafts are still streaming in — approval stays locked until
      the final (authoritative) list replaces the progressive one. */
  streaming?: boolean;
}

const GROUP_ORDER = ["Today", "This week", "Earlier"] as const;

function callGroup(createdAt: string | null): (typeof GROUP_ORDER)[number] {
  if (!createdAt) return "Earlier";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) return "This week";
  return "Earlier";
}

function formatCallDate(createdAt: string | null) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ImportFromGranolaDialog({
  target,
  engagements,
  onImportedTranscript,
  triggerClassName,
  triggerLabel,
}: {
  target: GranolaImportTargetInput;
  /** Board mode: lets the builder switch which client the tasks land under. */
  engagements?: { id: string; title: string }[];
  /** Project imports: lets the SOP card append the new row without a reload. */
  onImportedTranscript?: (transcript: ProjectSopTranscript) => void;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: "idle" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  // Granola folders (paid workspaces only — [] hides the filter row) are
  // account-level, so they survive client switches and folder filtering.
  const [folders, setFolders] = useState<GranolaFolderItem[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  // Manual sources (paste / file upload) — tasks-mode counterpart of the SOP flow.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteLabel, setPasteLabel] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedEngagementId, setSelectedEngagementId] = useState(
    target.kind === "engagement" ? target.engagementId : ""
  );
  // Guards against a slow list response for one client overwriting the list
  // after the user has already switched to another.
  const loadSeqRef = useRef(0);
  // In-flight draft stream — aborted when the dialog closes or the builder
  // backs out, which also stops the server-side generation.
  const streamAbortRef = useRef<AbortController | null>(null);

  function cancelStream() {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }

  /**
   * Try the SSE extraction route: drafts appear in the review screen one by
   * one instead of behind a spinner for the whole generation. Resolves
   * "fallback" when the route can't serve (streaming flag off, network cut) —
   * the caller then runs the blocking server action as before.
   */
  async function runDraftStream(
    body:
      | { kind: "granola"; engagementId: string; noteId: string }
      | { kind: "paste"; engagementId: string; content: string; label?: string },
    source: ReviewState["source"]
  ): Promise<"handled" | "fallback"> {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    const meta = { noteTitle: null as string | null, noteCreatedAt: null as string | null };
    let opened = false;
    try {
      const final = await streamTaskDrafts("/api/ai/granola/extract-tasks/stream", body, {
        signal: controller.signal,
        onMeta: (m) => {
          meta.noteTitle = m.noteTitle;
          meta.noteCreatedAt = m.noteCreatedAt;
        },
        onTask: (item) => {
          // First draft in: switch from the list spinner to the live review.
          if (!opened) {
            opened = true;
            if (source.kind === "manual") resetPaste();
            setReview({
              source,
              noteTitle: meta.noteTitle,
              noteCreatedAt: meta.noteCreatedAt,
              drafts: [item],
              streaming: true,
            });
          } else {
            setReview((prev) => prev && { ...prev, drafts: [...prev.drafts, item] });
          }
        },
      });

      if (final.type === "unavailable") {
        if (opened) setReview(null);
        return "fallback";
      }
      if (final.type === "error") {
        toast.error(final.error);
        if (opened) setReview(null);
        return "handled";
      }
      if (final.drafts.length === 0) {
        toast.info(
          source.kind === "granola"
            ? "No actionable tasks found in this call."
            : "No actionable tasks found in this transcript."
        );
        if (opened) setReview(null);
        return "handled";
      }
      // The done array is authoritative — swap it in and unlock approval.
      if (source.kind === "manual") resetPaste();
      setReview({
        source,
        noteTitle: meta.noteTitle,
        noteCreatedAt: meta.noteCreatedAt,
        drafts: final.drafts,
        streaming: false,
      });
      return "handled";
    } catch (err) {
      // Builder closed the dialog / backed out — nothing more to do.
      if ((err as Error)?.name === "AbortError") return "handled";
      if (opened) setReview(null);
      return "fallback";
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
    }
  }

  const effectiveTarget: GranolaImportTargetInput =
    engagements && target.kind === "engagement"
      ? { kind: "engagement", engagementId: selectedEngagementId }
      : target;

  async function loadNotes(
    cursor?: string,
    forTarget: GranolaImportTargetInput = effectiveTarget,
    forFolderId: string | null = folderId,
    includeFolders = false
  ) {
    const seq = cursor ? loadSeqRef.current : ++loadSeqRef.current;
    try {
      const result = await listGranolaNotesForImport(forTarget, cursor, {
        folderId: forFolderId ?? undefined,
        includeFolders,
      });
      if (seq !== loadSeqRef.current) return;
      if ("notConnected" in result) {
        setList({ status: "not-connected" });
        return;
      }
      if ("keyInvalid" in result) {
        setList({ status: "key-invalid" });
        return;
      }
      if ("error" in result) {
        setList({ status: "error", message: result.error });
        return;
      }
      if (result.folders !== undefined) setFolders(result.folders);
      setList((prev) => ({
        status: "ready",
        notes:
          cursor && prev.status === "ready" ? [...prev.notes, ...result.notes] : result.notes,
        cursor: result.cursor,
        hasMore: result.hasMore,
      }));
    } catch {
      // A thrown action (network blip) must not strand the "Loading…" state.
      if (seq !== loadSeqRef.current) return;
      setList({ status: "error", message: "Couldn't load your Granola calls." });
    }
  }

  function resetPaste() {
    setPasteOpen(false);
    setPasteLabel("");
    setPasteText("");
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) cancelStream();
    if (next) {
      setReview(null);
      resetPaste();
      setQuery("");
      setFolders([]);
      setFolderId(null);
      setList({ status: "loading" });
      if (target.kind === "engagement") setSelectedEngagementId(target.engagementId);
      void loadNotes(undefined, target, null, true);
    }
  }

  function onEngagementChange(id: string) {
    setSelectedEngagementId(id);
    setReview(null);
    resetPaste();
    setQuery("");
    setList({ status: "loading" });
    void loadNotes(undefined, { kind: "engagement", engagementId: id });
  }

  function onFolderChange(id: string | null) {
    if (id === folderId) return;
    setFolderId(id);
    setQuery("");
    setList({ status: "loading" });
    void loadNotes(undefined, effectiveTarget, id);
  }

  function refresh() {
    setQuery("");
    setList({ status: "loading" });
    void loadNotes(undefined, effectiveTarget, folderId, true);
  }

  async function loadMore() {
    if (list.status !== "ready" || !list.cursor) return;
    setLoadingMore(true);
    await loadNotes(list.cursor);
    setLoadingMore(false);
  }

  async function onPickNote(note: GranolaNoteListItem) {
    setBusyNoteId(note.id);
    try {
      if (effectiveTarget.kind === "project") {
        const result = await importGranolaNoteToProject(effectiveTarget.projectId, note.id);
        if (result.error || !result.transcript) {
          toast.error(result.error ?? "Import failed.");
          return;
        }
        toast.success(`Imported “${note.title ?? "Granola call"}”.`);
        onImportedTranscript?.(result.transcript);
        setOpen(false);
      } else {
        // Streaming first (drafts render as they're generated); the blocking
        // action is the fallback when the route can't serve.
        const streamed = await runDraftStream(
          { kind: "granola", engagementId: effectiveTarget.engagementId, noteId: note.id },
          { kind: "granola", noteId: note.id }
        );
        if (streamed === "handled") return;
        const result = await draftTasksFromGranolaNote(effectiveTarget.engagementId, note.id);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        if (result.drafts.length === 0) {
          toast.info("No actionable tasks found in this call.");
          return;
        }
        setReview({
          source: { kind: "granola", noteId: note.id },
          noteTitle: result.noteTitle,
          noteCreatedAt: result.noteCreatedAt,
          drafts: result.drafts,
        });
      }
    } catch {
      toast.error("Something went wrong — please try again.");
    } finally {
      setBusyNoteId(null);
    }
  }

  function handleManualDraftResult(result: {
    noteTitle: string | null;
    noteCreatedAt: string | null;
    drafts: ExtractedTaskDraft[];
    error?: string;
  }) {
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.drafts.length === 0) {
      toast.info("No actionable tasks found in this transcript.");
      return;
    }
    setReview({
      source: { kind: "manual" },
      noteTitle: result.noteTitle,
      noteCreatedAt: result.noteCreatedAt,
      drafts: result.drafts,
    });
    resetPaste();
  }

  async function onDraftFromPaste() {
    if (effectiveTarget.kind !== "engagement") return;
    const content = pasteText.trim();
    if (!content) {
      toast.error("Paste the transcript text.");
      return;
    }
    setManualBusy(true);
    try {
      const streamed = await runDraftStream(
        {
          kind: "paste",
          engagementId: effectiveTarget.engagementId,
          content,
          label: pasteLabel.trim() || undefined,
        },
        { kind: "manual" }
      );
      if (streamed === "handled") return;
      handleManualDraftResult(
        await draftTasksFromPastedTranscript(
          effectiveTarget.engagementId,
          content,
          pasteLabel.trim() || undefined
        )
      );
    } catch {
      toast.error("Something went wrong — please try again.");
    } finally {
      setManualBusy(false);
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || effectiveTarget.kind !== "engagement") return;
    setManualBusy(true);
    try {
      const fd = new FormData();
      fd.append("engagement_id", effectiveTarget.engagementId);
      fd.append("file", file);
      handleManualDraftResult(await draftTasksFromTranscriptFile(fd));
    } catch {
      toast.error("Something went wrong — please try again.");
    } finally {
      setManualBusy(false);
    }
  }

  async function onApprove(items: ApprovedTaskDraft[]) {
    if (!review || effectiveTarget.kind !== "engagement") return;
    setCreating(true);
    try {
      const result =
        review.source.kind === "granola"
          ? await approveGranolaTasks({
              engagementId: effectiveTarget.engagementId,
              noteId: review.source.noteId,
              noteTitle: review.noteTitle,
              noteCreatedAt: review.noteCreatedAt,
              items,
            })
          : await approveExtractedTasks({
              engagementId: effectiveTarget.engagementId,
              items,
            });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created ${result.created} task${result.created === 1 ? "" : "s"}.`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Something went wrong creating the tasks — please try again.");
    } finally {
      setCreating(false);
    }
  }

  const isProject = effectiveTarget.kind === "project";
  const title = review
    ? `Tasks from “${review.noteTitle ?? (review.source.kind === "granola" ? "Granola call" : "transcript")}”`
    : isProject
      ? "Import from Granola"
      : "Tasks from meeting";
  const sub = review
    ? "Review the drafted tasks — uncheck or edit anything before creating."
    : isProject
      ? "Pick a call to add its summary and transcript as a discovery transcript."
      : "Pick a Granola call — or paste or upload a transcript — to draft tasks from its action items.";

  // Client-side search over the loaded pages, grouped Today / This week / Earlier.
  const q = query.trim().toLowerCase();
  const groups =
    list.status === "ready"
      ? GROUP_ORDER.map((label) => ({
          label,
          items: list.notes.filter(
            (n) =>
              callGroup(n.createdAt) === label &&
              (!q || (n.title ?? "Untitled call").toLowerCase().includes(q))
          ),
        })).filter((g) => g.items.length > 0)
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className={triggerClassName ?? "add-mini"}>
          {triggerClassName ? (
            <AudioLines size={15} strokeWidth={2} />
          ) : (
            <span className="ai">
              <AudioLines size={14} strokeWidth={2} />
            </span>
          )}
          {triggerLabel ?? "Import from Granola"}
        </button>
      </DialogTrigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="krowe-gr-scrim" />
        <DialogPrimitive.Content
          className="krowe-gr-modal"
          aria-label={review ? "Review tasks" : "Import from Granola"}
        >
          <div className="krowe-gr-head">
            {review && (
              <button
                type="button"
                className="krowe-gr-back"
                onClick={() => {
                  cancelStream();
                  setReview(null);
                }}
              >
                <ChevronLeft size={15} strokeWidth={2} /> All calls
              </button>
            )}
            <div className="krowe-gr-head-row">
              <div>
                <DialogPrimitive.Title asChild>
                  <h2 className="krowe-gr-title">{title}</h2>
                </DialogPrimitive.Title>
                <DialogPrimitive.Description asChild>
                  <p className="krowe-gr-sub">{sub}</p>
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close asChild>
                <button type="button" className="krowe-gr-x" title="Close">
                  <X size={18} strokeWidth={2} />
                </button>
              </DialogPrimitive.Close>
            </div>
            {!review && list.status === "ready" && (
              <div className="krowe-gr-conn">
                <span className="krowe-gr-dot" /> Connected to Granola
                <button
                  type="button"
                  className="refresh"
                  onClick={refresh}
                  disabled={busyNoteId !== null || manualBusy}
                >
                  <RefreshCw size={13} strokeWidth={2} /> Refresh
                </button>
              </div>
            )}
          </div>

          {review ? (
            <GranolaTaskReview
              drafts={review.drafts}
              submitting={creating}
              streaming={review.streaming ?? false}
              sourceLabel={review.source.kind === "granola" ? "from the call" : "from the transcript"}
              onSubmit={onApprove}
              onCancel={() => {
                cancelStream();
                setOpen(false);
              }}
            />
          ) : (
            <div className="krowe-gr-body">
              {engagements && engagements.length > 1 && !pasteOpen && (
                <div style={{ marginBottom: 4 }}>
                  <div className="krowe-gr-field-label">Client</div>
                  <GrSelect
                    value={selectedEngagementId}
                    onChange={onEngagementChange}
                    options={engagements.map((eng) => ({ value: eng.id, label: eng.title }))}
                    size="lg"
                    disabled={busyNoteId !== null || creating || manualBusy}
                    ariaLabel="Client"
                  />
                </div>
              )}

              {folders.length > 0 && !pasteOpen && (
                <div className="krowe-gr-folders" role="group" aria-label="Filter by folder">
                  <button
                    type="button"
                    className={`krowe-gr-folder-chip${folderId === null ? " active" : ""}`}
                    onClick={() => onFolderChange(null)}
                    disabled={busyNoteId !== null || manualBusy}
                  >
                    All calls
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`krowe-gr-folder-chip${folderId === f.id ? " active" : ""}`}
                      onClick={() => onFolderChange(f.id)}
                      disabled={busyNoteId !== null || manualBusy}
                    >
                      {f.title}
                      {f.noteCount !== null && <span className="ct">{f.noteCount}</span>}
                    </button>
                  ))}
                </div>
              )}

              {pasteOpen ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={pasteLabel}
                    onChange={(e) => setPasteLabel(e.target.value)}
                    type="text"
                    placeholder="Label (optional) — e.g. Discovery call, Jun 10"
                    className="krowe-input"
                    disabled={manualBusy}
                  />
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={8}
                    maxLength={MAX_SOP_CHARS}
                    placeholder="Paste the call transcript or meeting notes here…"
                    className="krowe-textarea"
                    autoFocus
                    disabled={manualBusy}
                  />
                  <div className="text-xs" style={{ color: "var(--faint-foreground)" }}>
                    {pasteText.length.toLocaleString()} / {MAX_SOP_CHARS.toLocaleString()} chars
                  </div>
                  {manualBusy && (
                    <p className="krowe-gr-hint-line">
                      <Loader2 size={13} className="animate-spin" />
                      Reading the transcript and drafting tasks — this takes a few seconds…
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="krowe-gr-btn primary"
                      onClick={onDraftFromPaste}
                      disabled={manualBusy}
                    >
                      {manualBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Plus size={14} strokeWidth={2.25} />
                      )}
                      Draft tasks
                    </button>
                    <button
                      type="button"
                      className="krowe-gr-btn ghost"
                      onClick={resetPaste}
                      disabled={manualBusy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : list.status === "loading" || list.status === "idle" ? (
                <p className="krowe-gr-hint-line" style={{ padding: "24px 0" }}>
                  <Loader2 size={15} className="animate-spin" /> Loading your Granola calls…
                </p>
              ) : list.status === "not-connected" ? (
                <p className="krowe-gr-status">
                  Connect your Granola account first in{" "}
                  <Link href="/b/settings/granola">Settings → Integrations</Link>.
                </p>
              ) : list.status === "key-invalid" ? (
                <p className="krowe-gr-status">
                  Your Granola connection expired — reconnect it in{" "}
                  <Link href="/b/settings/granola">Settings → Integrations</Link>.
                </p>
              ) : list.status === "error" ? (
                <p className="krowe-gr-status error">{list.message}</p>
              ) : list.notes.length === 0 ? (
                <p className="krowe-gr-status">
                  {folderId !== null
                    ? "No processed calls in this folder yet."
                    : "No processed calls in Granola yet. Notes appear once Granola finishes their summary and transcript."}
                </p>
              ) : (
                <>
                  <label className="krowe-gr-search">
                    <span className="si">
                      <Search size={15} strokeWidth={2} />
                    </span>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search calls"
                    />
                  </label>
                  {groups.length === 0 ? (
                    <div className="krowe-gr-empty">No calls match &ldquo;{query}&rdquo;.</div>
                  ) : (
                    groups.map((g) => (
                      <div key={g.label}>
                        <div className="krowe-gr-group-label">{g.label}</div>
                        {g.items.map((note) => {
                          const busy = busyNoteId === note.id;
                          const disabled =
                            note.alreadyImported || busyNoteId !== null || manualBusy;
                          const date = formatCallDate(note.createdAt);
                          return (
                            <button
                              key={note.id}
                              type="button"
                              className={`krowe-gr-call${note.alreadyImported ? " imported" : ""}`}
                              onClick={() => onPickNote(note)}
                              disabled={disabled}
                            >
                              <span className="krowe-gr-call-ic">
                                <AudioLines size={18} strokeWidth={1.9} />
                              </span>
                              <span className="krowe-gr-call-main">
                                <span className="krowe-gr-call-title">
                                  {note.title ?? "Untitled call"}
                                </span>
                                <span className="krowe-gr-call-meta">
                                  {date && <span className="mono">{date}</span>}
                                  {date && note.summarySnippet && <span className="dot" />}
                                  {note.summarySnippet && (
                                    <span className="snip">{note.summarySnippet}</span>
                                  )}
                                </span>
                              </span>
                              {note.alreadyImported && (
                                <span className="krowe-gr-items">Imported</span>
                              )}
                              {busy ? (
                                <Loader2
                                  size={16}
                                  className="animate-spin"
                                  style={{ color: "var(--faint-foreground)", flexShrink: 0 }}
                                />
                              ) : (
                                <span className="krowe-gr-call-chev">
                                  <ChevronRight size={18} strokeWidth={2} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                  {busyNoteId && effectiveTarget.kind === "engagement" && (
                    <p className="krowe-gr-hint-line">
                      <Loader2 size={13} className="animate-spin" />
                      Reading the transcript and drafting tasks — this takes a few seconds…
                    </p>
                  )}
                  {list.hasMore && (
                    <button
                      type="button"
                      className="krowe-gr-load-more"
                      onClick={loadMore}
                      disabled={loadingMore || busyNoteId !== null || manualBusy}
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </button>
                  )}
                </>
              )}

              {/* Manual transcript sources — mirrors the SOP documents flow
                  (paste / upload / Granola), tasks mode only. */}
              {!pasteOpen && effectiveTarget.kind === "engagement" && (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="krowe-pill-ghost"
                      onClick={() => setPasteOpen(true)}
                      disabled={manualBusy || busyNoteId !== null}
                    >
                      <Plus size={14} strokeWidth={2} /> Paste transcript
                    </button>
                    <button
                      type="button"
                      className="krowe-pill-ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={manualBusy || busyNoteId !== null}
                    >
                      {manualBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Plus size={14} strokeWidth={2} />
                      )}
                      Upload file
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={SOP_ACCEPT}
                      onChange={onFileSelected}
                      className="hidden"
                    />
                  </div>
                  {manualBusy && !pasteOpen && (
                    <p className="krowe-gr-hint-line">
                      <Loader2 size={13} className="animate-spin" />
                      Reading the transcript and drafting tasks — this takes a few seconds…
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
