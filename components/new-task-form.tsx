"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X, Paperclip, Maximize2, Minimize2 } from "lucide-react";
import { Ember } from "@/components/design-atoms";
import { createTask } from "@/lib/actions/tasks";
import { uploadAttachment } from "@/lib/actions/attachments";

const MAX_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf",
  ".txt", ".csv", ".md", ".json", ".html", ".htm", ".zip",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls",
]);
const ACCEPT = [
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml",
  "application/pdf", "text/plain,text/csv,text/html", "application/json",
  "application/zip", ".md,.html,.htm,.docx,.xlsx,.pptx,.doc,.xls",
].join(",");

function getExt(name: string) { return "." + (name.split(".").pop()?.toLowerCase() ?? "bin"); }

interface NewTaskFormProps {
  engagementId?: string;
  placeholder?: string;
  onSuccess?: () => void;
}

export function NewTaskForm({ engagementId, placeholder, onSuccess }: NewTaskFormProps) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    const valid = selected.filter((f) => f.size <= MAX_SIZE && ALLOWED_EXTENSIONS.has(getExt(f.name)));
    setFiles((prev) => [...prev, ...valid]);
  }

  function handleClose() { setOpen(false); setModal(false); setError(null); setFiles([]); }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createTask(formData);
      if (result?.error) { setError(result.error); return; }
      if (result?.taskId && files.length > 0) {
        await Promise.all(files.map((file) => {
          const fd = new FormData();
          fd.set("task_id", result.taskId!);
          fd.set("file", file);
          return uploadAttachment(fd);
        }));
      }
      formRef.current?.reset();
      handleClose();
      onSuccess?.();
    });
  }

  const panel = (
    <div className="krowe-newtask-panel" style={modal ? { position: "static", width: "min(520px, 92vw)" } : undefined}>
      <div className="krowe-newtask-head">
        <div className="krowe-newtask-title"><Ember size={14} /> New task</div>
        <div className="krowe-newtask-head-actions">
          <button className="krowe-iconbtn" onClick={() => setModal((v) => !v)} title={modal ? "Collapse" : "Expand"}>
            {modal ? <Minimize2 width={14} height={14} /> : <Maximize2 width={14} height={14} />}
          </button>
          <button className="krowe-iconbtn" onClick={handleClose} title="Close">
            <X width={14} height={14} />
          </button>
        </div>
      </div>
      <form ref={formRef} action={handleSubmit}>
        {engagementId && <input type="hidden" name="engagement_id" value={engagementId} />}
        <div className="krowe-form-row">
          <input
            className="krowe-input"
            name="title"
            placeholder={placeholder ?? "What needs to be built or fixed?"}
            required
            autoFocus
          />
        </div>
        <div className="krowe-form-row">
          <textarea
            className="krowe-textarea"
            name="description"
            placeholder="More context — a sentence or two is fine."
            rows={modal ? 5 : 3}
          />
        </div>
        <div className="krowe-form-row">
          <label className="krowe-form-label">Priority</label>
          <select className="krowe-select" name="priority" defaultValue="medium">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="krowe-form-row">
          <div className="krowe-form-label-row">
            <span className="krowe-form-label">Attachments</span>
            <button type="button" className="krowe-link-btn" onClick={() => fileInputRef.current?.click()}>
              <Paperclip width={12} height={12} /> Add file
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="sr-only" onChange={handleFileChange} />
          {files.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
              {files.map((f, i) => (
                <li key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "var(--surface-subtle)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: 12,
                }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <button type="button" className="krowe-iconbtn" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}>
                    <X width={12} height={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</p>}
        <button className="krowe-btn-primary accent" type="submit" disabled={isPending}>
          <Plus width={14} height={14} /> {isPending ? "Adding…" : "Add task"}
        </button>
      </form>
    </div>
  );

  return (
    <>
      {open && modal && (
        <div
          className="krowe-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          {panel}
        </div>
      )}
      {open && !modal && panel}
      <button
        className={`krowe-fab ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="New task"
        aria-label="New task"
      >
        {open ? <X width={20} height={20} /> : <Plus width={20} height={20} />}
      </button>
    </>
  );
}
