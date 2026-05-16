"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Paperclip, Download, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  uploadAttachment,
  deleteAttachment,
  getAttachmentSignedUrl,
} from "@/lib/actions/attachments";
import type { TaskAttachment, Role } from "@/lib/types";

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TaskAttachmentsProps {
  taskId: string;
  role: Role;
  currentUserId: string;
  initial: TaskAttachment[];
}

export function TaskAttachments({
  taskId,
  role,
  currentUserId,
  initial,
}: TaskAttachmentsProps) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>(initial);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from server when opened in a context without server-side data (e.g. slide-over)
  useEffect(() => {
    if (initial.length > 0) return;
    fetch(`/api/attachments?taskId=${taskId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAttachments(data);
      })
      .catch(() => {});
  }, [taskId, initial.length]);

  function canDelete(a: TaskAttachment) {
    return role === "builder" || a.uploaded_by === currentUserId;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} exceeds the 25 MB limit`);
        continue;
      }
      if (!ALLOWED_EXTENSIONS.has(getExt(file.name))) {
        toast.error(`${file.name}: file type not allowed`);
        continue;
      }

      const fd = new FormData();
      fd.set("task_id", taskId);
      fd.set("file", file);

      startTransition(async () => {
        const result = await uploadAttachment(fd);
        if (result.error) {
          toast.error(result.error);
        } else if (result.attachment) {
          setAttachments((prev) => [result.attachment!, ...prev]);
          toast.success(`${file.name} uploaded`);
        }
      });
    }
  }

  function handleDelete(id: string) {
    const target = attachments.find((a) => a.id === id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));

    startTransition(async () => {
      const result = await deleteAttachment(id);
      if (result.error) {
        toast.error(result.error);
        if (target) setAttachments((prev) => [target, ...prev]);
      }
    });
  }

  function handleDownload(id: string) {
    startTransition(async () => {
      const result = await getAttachmentSignedUrl(id);
      if (result.error || !result.url) {
        toast.error("Could not generate download link");
      } else {
        window.open(result.url, "_blank");
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <Paperclip className="h-3 w-3" />
          Attachments
          {attachments.length > 0 && (
            <span className="font-normal text-neutral-400">
              ({attachments.length})
            </span>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-neutral-400 hover:text-neutral-700"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />

      {attachments.length === 0 ? (
        <p className="py-1 text-xs text-neutral-400">No files attached</p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-neutral-700">
                  {a.file_name}
                </span>
                <span className="shrink-0 text-neutral-400">
                  {formatBytes(a.size_bytes)}
                </span>
                {a.uploader && (
                  <Badge
                    variant={
                      a.uploader.role === "operator" ? "operator" : "builder"
                    }
                    className="shrink-0 px-1.5 py-0 text-[10px]"
                  >
                    {a.uploader.role}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => handleDownload(a.id)}
                  disabled={isPending}
                  title="Download"
                  className="rounded p-1 text-neutral-400 transition-colors hover:text-neutral-700"
                >
                  <Download className="h-3 w-3" />
                </button>
                {canDelete(a) && (
                  <button
                    onClick={() => handleDelete(a.id)}
                    disabled={isPending}
                    title="Delete"
                    className="rounded p-1 text-neutral-400 transition-colors hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
