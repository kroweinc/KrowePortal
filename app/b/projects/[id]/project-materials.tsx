"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ATTACHMENT_ACCEPT } from "@/lib/attachments-constants";
import { safeExternalHref } from "@/lib/project/business-context";
import {
  addProjectMaterialLink,
  uploadProjectMaterial,
  deleteProjectMaterial,
  getProjectMaterialSignedUrl,
} from "@/lib/actions/project-materials";
import type { ProjectMaterial } from "@/lib/types";

const inputClass =
  "w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectMaterials({
  projectId,
  initialMaterials,
}: {
  projectId: string;
  initialMaterials: ProjectMaterial[];
}) {
  const [materials, setMaterials] = useState<ProjectMaterial[]>(initialMaterials);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onAddLink() {
    const url = linkUrl.trim();
    if (!url) {
      toast.error("Enter a link URL.");
      return;
    }
    startTransition(async () => {
      const result = await addProjectMaterialLink(projectId, url, linkLabel.trim() || undefined);
      if (result.error || !result.material) {
        toast.error(result.error ?? "Couldn't add link.");
        return;
      }
      setMaterials((prev) => [result.material as ProjectMaterial, ...prev]);
      setLinkUrl("");
      setLinkLabel("");
      setShowLinkForm(false);
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
        const result = await uploadProjectMaterial(fd);
        if (result.error || !result.material) {
          toast.error(`${file.name}: ${result.error ?? "upload failed"}`);
          continue;
        }
        setMaterials((prev) => [result.material as ProjectMaterial, ...prev]);
      }
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const result = await deleteProjectMaterial(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setMaterials((prev) => prev.filter((m) => m.id !== id));
    });
  }

  async function onOpenFile(id: string) {
    const result = await getProjectMaterialSignedUrl(id);
    if (result.error || !result.url) {
      toast.error(result.error ?? "Couldn't open file.");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section>
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-neutral-900">Materials</h2>
        <p className="text-xs text-neutral-500">
          Links and files about the business. These help seed AI drafts.
        </p>
      </div>

      {materials.length > 0 ? (
        <ul className="space-y-2 mb-3">
          {materials.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                {m.material_type === "link" ? (
                  <a
                    href={safeExternalHref(m.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-neutral-900 hover:underline truncate block"
                  >
                    {m.label?.trim() || m.url}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenFile(m.id)}
                    className="text-sm font-medium text-neutral-900 hover:underline truncate block text-left"
                  >
                    {m.file_name}
                  </button>
                )}
                <div className="text-xs text-neutral-400 mt-0.5">
                  {m.material_type === "link"
                    ? "Link"
                    : ["File", formatBytes(m.size_bytes)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(m.id)}
                disabled={isPending}
                className="shrink-0 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
                aria-label="Remove material"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-400 mb-3">
          No materials yet.
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
        {showLinkForm && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              type="text"
              inputMode="url"
              placeholder="https://… (link URL)"
              className={inputClass}
              autoFocus
            />
            <input
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              type="text"
              placeholder="Label (optional)"
              className={`${inputClass} sm:max-w-[200px]`}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {showLinkForm ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onAddLink} disabled={isPending}>
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowLinkForm(false);
                  setLinkUrl("");
                  setLinkLabel("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowLinkForm(true)}
              disabled={isPending}
            >
              + Add link
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
          >
            + Upload file
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={onFilesSelected}
            className="hidden"
          />
        </div>
      </div>
    </section>
  );
}
