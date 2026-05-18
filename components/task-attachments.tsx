"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import {
  Paperclip,
  Download,
  X,
  Plus,
  Link2,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  uploadAttachment,
  deleteAttachment,
  getAttachmentSignedUrl,
  addLinkAttachment,
  addTextAttachment,
} from "@/lib/actions/attachments";
import { useActiveRole } from "@/lib/role-context";
import type { TaskAttachment } from "@/lib/types";
import {
  MAX_ATTACHMENT_SIZE,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
} from "@/lib/attachments-constants";

const MAX_SIZE = MAX_ATTACHMENT_SIZE;
const ALLOWED_EXTENSIONS = ALLOWED_ATTACHMENT_EXTENSIONS;
const ACCEPT = ATTACHMENT_ACCEPT;

type AddMode = null | "picker" | "link" | "text";

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
  currentUserId: string;
  initial: TaskAttachment[];
  isDeliverable?: boolean;
  readOnly?: boolean;
}

export function TaskAttachments({
  taskId,
  currentUserId,
  initial,
  isDeliverable = false,
  readOnly = false,
}: TaskAttachmentsProps) {
  const role = useActiveRole();
  const [attachments, setAttachments] = useState<TaskAttachment[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [textContent, setTextContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initial.length > 0) return;
    fetch(`/api/attachments?taskId=${taskId}&isDeliverable=${isDeliverable}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAttachments(data);
      })
      .catch(() => {});
  }, [taskId, initial.length, isDeliverable]);

  function closeAdd() {
    setAddMode(null);
    setLinkUrl("");
    setLinkLabel("");
    setTextContent("");
  }

  function canDelete(a: TaskAttachment) {
    return role === "builder" || a.uploaded_by === currentUserId;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    closeAdd();

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

  function handleAddLink() {
    if (!linkUrl.trim()) return;
    startTransition(async () => {
      const result = await addLinkAttachment(
        taskId,
        linkUrl.trim(),
        linkLabel.trim() || undefined
      );
      if (result.error) {
        toast.error(result.error);
      } else if (result.attachment) {
        setAttachments((prev) => [result.attachment!, ...prev]);
        closeAdd();
        toast.success("Link added");
      }
    });
  }

  function handleAddText() {
    if (!textContent.trim()) return;
    startTransition(async () => {
      const result = await addTextAttachment(taskId, textContent.trim());
      if (result.error) {
        toast.error(result.error);
      } else if (result.attachment) {
        setAttachments((prev) => [result.attachment!, ...prev]);
        closeAdd();
        toast.success("Note added");
      }
    });
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
      {!isDeliverable && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            {collapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            <Paperclip className="h-3 w-3" />
            Attachments
            {attachments.length > 0 && (
              <span className="font-normal text-neutral-400">
                ({attachments.length})
              </span>
            )}
          </button>
          {!readOnly && !collapsed && addMode === null && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-neutral-400 hover:text-neutral-700"
              onClick={() => setAddMode("picker")}
              disabled={isPending}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          )}
        </div>
      )}

      {!collapsed && !readOnly && addMode === "picker" && (
        <div className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5">
          <span className="text-xs text-neutral-400 mr-1">Add:</span>
          <button
            onClick={() => {
              setAddMode(null);
              fileInputRef.current?.click();
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 transition-colors"
          >
            <Paperclip className="h-3 w-3" />
            File
          </button>
          <button
            onClick={() => setAddMode("link")}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 transition-colors"
          >
            <Link2 className="h-3 w-3" />
            Link
          </button>
          <button
            onClick={() => setAddMode("text")}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 transition-colors"
          >
            <FileText className="h-3 w-3" />
            Text
          </button>
          <button
            onClick={closeAdd}
            className="ml-auto rounded p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {!collapsed && !readOnly && addMode === "link" && (
        <div className="space-y-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
          <input
            type="url"
            placeholder="https://..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-neutral-400"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-neutral-400"
            onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-6 px-3 text-xs"
              onClick={handleAddLink}
              disabled={isPending || !linkUrl.trim()}
            >
              Add link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-neutral-400"
              onClick={closeAdd}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!collapsed && !readOnly && addMode === "text" && (
        <div className="space-y-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
          <textarea
            placeholder="Add a note..."
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            rows={3}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-400 resize-none"
            autoFocus
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-6 px-3 text-xs"
              onClick={handleAddText}
              disabled={isPending || !textContent.trim()}
            >
              Add note
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-neutral-400"
              onClick={closeAdd}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
      )}

      {!collapsed && attachments.length === 0 && !isDeliverable ? (
        <p className="py-1 text-xs text-neutral-400">No attachments</p>
      ) : !collapsed ? (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs"
            >
              {a.attachment_type === "link" ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Link2 className="h-3 w-3 shrink-0 text-neutral-400" />
                  <a
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-medium text-neutral-700 hover:underline"
                  >
                    {a.file_name}
                  </a>
                  {a.uploader && (
                    <Badge
                      variant={a.uploader.role === "operator" ? "operator" : "builder"}
                      className="shrink-0 px-1.5 py-0 text-[10px]"
                    >
                      {a.uploader.role}
                    </Badge>
                  )}
                </div>
              ) : a.attachment_type === "text" ? (
                <div className="flex min-w-0 items-start gap-2">
                  <FileText className="h-3 w-3 shrink-0 text-neutral-400 mt-0.5" />
                  <span className="truncate text-neutral-700 leading-relaxed">
                    {a.text_content}
                  </span>
                  {a.uploader && (
                    <Badge
                      variant={a.uploader.role === "operator" ? "operator" : "builder"}
                      className="shrink-0 px-1.5 py-0 text-[10px]"
                    >
                      {a.uploader.role}
                    </Badge>
                  )}
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-neutral-700">
                    {a.file_name}
                  </span>
                  {a.size_bytes != null && (
                    <span className="shrink-0 text-neutral-400">
                      {formatBytes(a.size_bytes)}
                    </span>
                  )}
                  {a.uploader && (
                    <Badge
                      variant={a.uploader.role === "operator" ? "operator" : "builder"}
                      className="shrink-0 px-1.5 py-0 text-[10px]"
                    >
                      {a.uploader.role}
                    </Badge>
                  )}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-1">
                {a.attachment_type === "link" && (
                  <a
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open link"
                    className="rounded p-1 text-neutral-400 transition-colors hover:text-neutral-700"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {a.attachment_type === "file" && (
                  <button
                    onClick={() => handleDownload(a.id)}
                    disabled={isPending}
                    title="Download"
                    className="rounded p-1 text-neutral-400 transition-colors hover:text-neutral-700"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                )}
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
      ) : null}
    </div>
  );
}
