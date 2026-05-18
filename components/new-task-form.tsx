"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X, Paperclip, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createTask } from "@/lib/actions/tasks";
import { uploadAttachment } from "@/lib/actions/attachments";

const MAX_SIZE = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".pdf",
  ".txt", ".csv", ".md", ".json",
  ".html", ".htm",
  ".zip",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls",
]);

const ACCEPT = [
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml",
  "application/pdf",
  "text/plain,text/csv,text/html",
  "application/json",
  "application/zip",
  ".md,.html,.htm,.docx,.xlsx,.pptx,.doc,.xls",
].join(",");

function getExt(fileName: string) {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

interface NewTaskFormProps {
  placeholder?: string;
  onSuccess?: () => void;
}

export function NewTaskForm({ placeholder, onSuccess }: NewTaskFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    const valid = selected.filter((f) => {
      if (f.size > MAX_SIZE) return false;
      if (!ALLOWED_EXTENSIONS.has(getExt(f.name))) return false;
      return true;
    });
    setFiles((prev) => [...prev, ...valid]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleClose() {
    setExpanded(false);
    setModal(false);
    setError(null);
    setFiles([]);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createTask(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }

      if (result?.taskId && files.length > 0) {
        await Promise.all(
          files.map((file) => {
            const fd = new FormData();
            fd.set("task_id", result.taskId!);
            fd.set("file", file);
            return uploadAttachment(fd);
          })
        );
      }

      formRef.current?.reset();
      handleClose();
      onSuccess?.();
    });
  }

  const formContent = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-900">New task</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setModal((v) => !v)}
            className="text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label={modal ? "Collapse" : "Expand"}
          >
            {modal ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={handleClose}
            className="text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <form ref={formRef} action={handleSubmit} className="space-y-3">
        <Input
          name="title"
          placeholder={placeholder ?? "What needs to be built or fixed?"}
          required
          autoFocus
        />
        <Textarea
          name="description"
          placeholder="More context (optional)"
          rows={modal ? 5 : 3}
        />
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">Priority</label>
          <Select name="priority" defaultValue="medium">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-neutral-700">Attachments</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <Paperclip className="h-3 w-3" />
              Add file
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1 text-xs"
                >
                  <span className="truncate text-neutral-700">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button type="submit" size="sm" className="w-full" disabled={isPending}>
          {isPending ? "Adding…" : "Add task"}
        </Button>
      </form>
    </>
  );

  return (
    <>
      {expanded && modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/30"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-2xl p-6 space-y-3 mx-4">
            {formContent}
          </div>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {expanded && !modal && (
          <div className="w-80 rounded-xl border border-neutral-200 bg-white shadow-xl p-4 space-y-3">
            {formContent}
          </div>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg hover:bg-neutral-700 transition-colors"
          aria-label="New task"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}
