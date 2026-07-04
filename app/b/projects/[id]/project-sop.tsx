"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, ClipboardList, AudioLines, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { SOP_ACCEPT, MAX_SOP_CHARS } from "@/lib/attachments-constants";
import { ImportFromGranolaDialog } from "@/components/granola/import-from-granola-dialog";
import {
  addSopTranscriptText,
  uploadSopTranscript,
  deleteSopTranscript,
  getSopTranscriptSignedUrl,
} from "@/lib/actions/project-sop";
import type { ProjectSopTranscript } from "@/lib/types";

const inputClass =
  "w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";

function formatCount(n: number | null): string {
  if (!n) return "";
  if (n < 1000) return `${n} chars`;
  return `${Math.round(n / 1000)}k chars`;
}

export function ProjectSop({
  projectId,
  initialTranscripts,
}: {
  projectId: string;
  initialTranscripts: ProjectSopTranscript[];
}) {
  const [transcripts, setTranscripts] = useState<ProjectSopTranscript[]>(initialTranscripts);
  const [showPasteForm, setShowPasteForm] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [pasteLabel, setPasteLabel] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetPaste() {
    setShowPasteForm(false);
    setPasteContent("");
    setPasteLabel("");
  }

  function onAddPaste() {
    const content = pasteContent.trim();
    if (!content) {
      toast.error("Paste the transcript text.");
      return;
    }
    startTransition(async () => {
      const result = await addSopTranscriptText(projectId, content, pasteLabel.trim() || undefined);
      if (result.error || !result.transcript) {
        toast.error(result.error ?? "Couldn't add transcript.");
        return;
      }
      setTranscripts((prev) => [result.transcript as ProjectSopTranscript, ...prev]);
      resetPaste();
    });
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!selected.length) return;
    startTransition(async () => {
      for (const file of selected) {
        const fd = new FormData();
        fd.append("project_id", projectId);
        fd.append("file", file);
        const result = await uploadSopTranscript(fd);
        if (result.error || !result.transcript) {
          toast.error(`${file.name}: ${result.error ?? "upload failed"}`);
          continue;
        }
        setTranscripts((prev) => [result.transcript as ProjectSopTranscript, ...prev]);
      }
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const result = await deleteSopTranscript(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setTranscripts((prev) => prev.filter((t) => t.id !== id));
      setExpandedId((cur) => (cur === id ? null : cur));
    });
  }

  async function onOpenOriginal(id: string) {
    const result = await getSopTranscriptSignedUrl(id);
    if (result.error || !result.url) {
      toast.error(result.error ?? "Couldn't open file.");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section id="sop" className="section">
      <div className="sec-head">
        <div>
          <h2 className="sec-title">Discovery transcripts (SOP)</h2>
          <p className="sec-desc">
            Paste or upload your discovery-call transcripts. Their text feeds the PRD, quote, and
            contract drafts — kept separate from Notes so the same info isn&apos;t entered twice.
          </p>
        </div>
      </div>

      {transcripts.length > 0 ? (
        <ul className="rows">
          {transcripts.map((t) => {
            const expanded = expandedId === t.id;
            return (
              <li key={t.id} className="row" style={{ flexWrap: "wrap" }}>
                <span className="row-ico">
                  {t.source_type === "paste" ? (
                    <ClipboardList size={17} strokeWidth={1.9} />
                  ) : t.source_type === "granola" ? (
                    <AudioLines size={17} strokeWidth={1.9} />
                  ) : (
                    <FileText size={17} strokeWidth={1.9} />
                  )}
                </span>
                <div className="row-main">
                  <div className="row-titleline">
                    <button
                      type="button"
                      className="row-name"
                      onClick={() => setExpandedId(expanded ? null : t.id)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      {expanded ? (
                        <ChevronDown size={14} strokeWidth={2} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={2} />
                      )}
                      {t.label ||
                        (t.source_type === "paste"
                          ? "Pasted transcript"
                          : t.source_type === "granola"
                            ? "Granola call"
                            : t.file_name)}
                    </button>
                    <span className="chip chip-kind">
                      {t.source_type === "paste" ? "Pasted" : t.source_type === "granola" ? "Granola" : "File"}
                    </span>
                  </div>
                  <div className="row-sub">
                    <span>
                      {[
                        t.source_type === "file" && t.file_name ? t.file_name : null,
                        formatCount(t.char_count),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(t.id)}
                  disabled={isPending}
                  className="row-trail"
                  aria-label="Remove transcript"
                >
                  Remove
                </button>

                {expanded && (
                  <div style={{ flexBasis: "100%", marginTop: 8 }}>
                    {t.source_type === "file" && (
                      <button
                        type="button"
                        className="add-mini"
                        onClick={() => onOpenOriginal(t.id)}
                        style={{ marginBottom: 8 }}
                      >
                        Open original file
                      </button>
                    )}
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        maxHeight: 280,
                        overflow: "auto",
                        margin: 0,
                        padding: "10px 12px",
                        fontSize: 12,
                        lineHeight: 1.55,
                        background: "#fafafa",
                        border: "1px solid #ededed",
                        borderRadius: 6,
                        fontFamily: "inherit",
                      }}
                    >
                      {t.content}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">
          No transcripts yet — paste or upload a discovery-call transcript to seed AI drafts.
        </div>
      )}

      {showPasteForm && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={pasteLabel}
            onChange={(e) => setPasteLabel(e.target.value)}
            type="text"
            placeholder="Label (optional) — e.g. Discovery call, Jun 10"
            className={inputClass}
          />
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            rows={8}
            maxLength={MAX_SOP_CHARS}
            placeholder="Paste the call transcript or discovery notes here…"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
            autoFocus
          />
          <div className="text-xs text-neutral-400">
            {pasteContent.length.toLocaleString()} / {MAX_SOP_CHARS.toLocaleString()} chars
          </div>
        </div>
      )}

      <div className="add-row">
        {showPasteForm ? (
          <>
            <button type="button" className="add-mini" onClick={onAddPaste} disabled={isPending}>
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Save transcript
            </button>
            <button type="button" className="add-mini" onClick={resetPaste} disabled={isPending}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="add-mini"
            onClick={() => setShowPasteForm(true)}
            disabled={isPending}
          >
            <span className="ai"><Plus size={14} strokeWidth={2} /></span>Paste transcript
          </button>
        )}
        <button
          type="button"
          className="add-mini"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
        >
          <span className="ai"><Plus size={14} strokeWidth={2} /></span>Upload file
        </button>
        <ImportFromGranolaDialog
          target={{ kind: "project", projectId }}
          onImportedTranscript={(t) => setTranscripts((prev) => [t, ...prev])}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={SOP_ACCEPT}
          onChange={onFilesSelected}
          className="hidden"
        />
      </div>
    </section>
  );
}
