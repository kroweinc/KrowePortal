"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Link as LinkIcon, FileArchive, Plus } from "lucide-react";
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
    <section id="materials" className="section">
      <div className="sec-head">
        <div>
          <h2 className="sec-title">Materials</h2>
          <p className="sec-desc">Links and files about the business. These help seed AI drafts.</p>
        </div>
      </div>

      {materials.length > 0 ? (
        <ul className="rows">
          {materials.map((m) => (
            <li key={m.id} className="row">
              <span className="row-ico">
                {m.material_type === "link" ? (
                  <LinkIcon size={17} strokeWidth={1.9} />
                ) : (
                  <FileArchive size={17} strokeWidth={1.9} />
                )}
              </span>
              <div className="row-main">
                <div className="row-titleline">
                  {m.material_type === "link" ? (
                    <a
                      className="row-name"
                      href={safeExternalHref(m.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {m.label?.trim() || m.url}
                    </a>
                  ) : (
                    <button type="button" className="row-name" onClick={() => onOpenFile(m.id)}>
                      {m.file_name}
                    </button>
                  )}
                  <span className="chip chip-kind">{m.material_type === "link" ? "Link" : "File"}</span>
                </div>
                <div className="row-sub">
                  <span>
                    {m.material_type === "link"
                      ? "Link"
                      : ["File", formatBytes(m.size_bytes)].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(m.id)}
                disabled={isPending}
                className="row-trail"
                aria-label="Remove material"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">No materials yet — add a link or upload a file to seed AI drafts.</div>
      )}

      {showLinkForm && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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

      <div className="add-row">
        {showLinkForm ? (
          <>
            <button type="button" className="add-mini" onClick={onAddLink} disabled={isPending}>
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Add
            </button>
            <button
              type="button"
              className="add-mini"
              onClick={() => {
                setShowLinkForm(false);
                setLinkUrl("");
                setLinkLabel("");
              }}
              disabled={isPending}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="add-mini"
            onClick={() => setShowLinkForm(true)}
            disabled={isPending}
          >
            <span className="ai"><Plus size={14} strokeWidth={2} /></span>Add link
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={onFilesSelected}
          className="hidden"
        />
      </div>
    </section>
  );
}
