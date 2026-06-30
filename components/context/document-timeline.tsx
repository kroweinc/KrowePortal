"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  FilePlus,
  Send,
  Eye,
  MessageSquare,
  RotateCw,
  Check,
  PenLine,
  X,
  Trash2,
  Plus,
} from "lucide-react";
import {
  getDocumentEvents,
  logChangeRequest,
  type DocumentEventRow,
} from "@/lib/actions/context-graph";
import type { DocEventKind, DocEventType } from "@/lib/context/document-events";

const EVENT_META: Record<
  DocEventType,
  { label: string; color: string; icon: ReactNode }
> = {
  created: { label: "Created", color: "#64748b", icon: <FilePlus size={12} strokeWidth={2.2} /> },
  sent: { label: "Sent", color: "#3b82f6", icon: <Send size={12} strokeWidth={2.2} /> },
  viewed: { label: "Viewed", color: "#94a3b8", icon: <Eye size={12} strokeWidth={2.2} /> },
  changes_requested: {
    label: "Changes requested",
    color: "#f59e0b",
    icon: <MessageSquare size={12} strokeWidth={2.2} />,
  },
  re_sent: { label: "Re-sent", color: "#3b82f6", icon: <RotateCw size={12} strokeWidth={2.2} /> },
  accepted: { label: "Accepted", color: "#10b981", icon: <Check size={12} strokeWidth={2.2} /> },
  signed: { label: "Signed", color: "#10b981", icon: <PenLine size={12} strokeWidth={2.2} /> },
  rejected: { label: "Rejected", color: "#ef4444", icon: <X size={12} strokeWidth={2.2} /> },
  deleted: { label: "Deleted", color: "#9ca3af", icon: <Trash2 size={12} strokeWidth={2.2} /> },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventDetail(ev: DocumentEventRow): string | null {
  const p = ev.payload ?? {};
  if (typeof p.changesText === "string" && p.changesText.trim()) return p.changesText;
  if (typeof p.rejectionNote === "string" && p.rejectionNote.trim()) return p.rejectionNote;
  return null;
}

function actorLine(ev: DocumentEventRow): string {
  const p = ev.payload ?? {};
  const signer = typeof p.signerName === "string" ? p.signerName : null;
  const role = ev.actor_role ? ev.actor_role[0].toUpperCase() + ev.actor_role.slice(1) : null;
  if (signer && (ev.event_type === "signed" || ev.event_type === "accepted")) {
    return `by ${signer}${role ? ` · ${role}` : ""}`;
  }
  return role ? `by ${role}` : "";
}

export function DocumentTimeline({
  docKind,
  docId,
  engagementId,
}: {
  docKind: DocEventKind;
  docId: string;
  engagementId: string;
}) {
  const [events, setEvents] = useState<DocumentEventRow[] | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [text, setText] = useState("");
  const [isSaving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    getDocumentEvents(docKind, docId, engagementId).then((rows) => {
      if (!cancelled) setEvents(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [docKind, docId, engagementId]);

  function onSave() {
    const body = text.trim();
    if (!body) {
      toast.error("Describe the requested changes.");
      return;
    }
    startSave(async () => {
      const res = await logChangeRequest(docKind, docId, engagementId, body);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const rows = await getDocumentEvents(docKind, docId, engagementId);
      setEvents(rows);
      setText("");
      setShowComposer(false);
      toast.success("Change request logged.");
    });
  }

  return (
    <div>
      {events === null ? (
        <div className="ctx-timeline-empty">Loading timeline…</div>
      ) : events.length === 0 ? (
        <div className="ctx-timeline-empty">No history recorded yet.</div>
      ) : (
        <div className="ctx-timeline">
          {events.map((ev) => {
            const meta = EVENT_META[ev.event_type] ?? EVENT_META.created;
            const detail = eventDetail(ev);
            const actor = actorLine(ev);
            return (
              <div key={ev.id} className="ctx-timeline-item">
                <span className="ctx-timeline-dot" style={{ background: meta.color }}>
                  {meta.icon}
                </span>
                <div className="ctx-timeline-body">
                  <div className="ctx-timeline-line">
                    <span className="ctx-timeline-label">{meta.label}</span>
                    <span className="ctx-timeline-when">{formatWhen(ev.created_at)}</span>
                  </div>
                  {actor && <div className="ctx-timeline-actor">{actor}</div>}
                  {detail && <div className="ctx-timeline-detail">{detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ctx-cr">
        {showComposer ? (
          <>
            <textarea
              className="ctx-cr-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={5000}
              placeholder="What changes did the client/operator ask for?"
              autoFocus
            />
            <div className="ctx-cr-row">
              <button type="button" className="add-mini" onClick={onSave} disabled={isSaving}>
                <span className="ai"><Plus size={14} strokeWidth={2} /></span>
                {isSaving ? "Saving…" : "Save change request"}
              </button>
              <button
                type="button"
                className="add-mini"
                onClick={() => {
                  setShowComposer(false);
                  setText("");
                }}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="add-mini" onClick={() => setShowComposer(true)}>
            <span className="ai"><MessageSquare size={14} strokeWidth={2} /></span>
            Log change request
          </button>
        )}
      </div>
    </div>
  );
}
