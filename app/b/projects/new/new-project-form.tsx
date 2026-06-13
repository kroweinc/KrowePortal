"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/actions/projects";
import { uploadProjectMaterial } from "@/lib/actions/project-materials";
import { ATTACHMENT_ACCEPT } from "@/lib/attachments-constants";

const inputClass =
  "w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";

type LinkRow = { url: string; label: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NewProjectForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  function addLink() {
    setLinks((prev) => [...prev, { url: "", label: "" }]);
  }
  function updateLink(i: number, patch: Partial<LinkRow>) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) setFiles((prev) => [...prev, ...selected]);
    e.target.value = ""; // allow re-selecting the same file
  }
  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the document a name.");
      return;
    }
    startTransition(async () => {
      const cleanLinks = links
        .map((l) => ({ url: l.url.trim(), label: l.label.trim() || undefined }))
        .filter((l) => l.url.length > 0);

      const result = await createProject({
        name: name.trim(),
        prospectName: prospectName.trim() || undefined,
        prospectEmail: prospectEmail.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        liveUrl: liveUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        links: cleanLinks.length ? cleanLinks : undefined,
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      // Second phase: upload pending files to the now-created project. Failures
      // are non-fatal — the project exists and files can be re-added from its page.
      let failed = 0;
      for (const file of files) {
        const fd = new FormData();
        fd.append("project_id", result.id);
        fd.append("file", file);
        const up = await uploadProjectMaterial(fd);
        if (up.error) failed++;
      }
      if (failed > 0) {
        toast.error(
          `Document created, but ${failed} file${failed > 1 ? "s" : ""} didn't upload. Add them from the document page.`
        );
      }

      router.push(`/b/projects/${result.id}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title="The business" hint="Who you're preparing documents for.">
        <Field label="Document name" required hint="Usually the business name.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder="e.g. Nissan of McKinney"
            className={inputClass}
          />
        </Field>

        <Field label="Contact name" hint="The person you're pitching. Optional.">
          <input
            value={prospectName}
            onChange={(e) => setProspectName(e.target.value)}
            type="text"
            placeholder="e.g. Dana Reyes"
            className={inputClass}
          />
        </Field>

        <Field label="Contact email" hint="Where you'll send document links. Optional.">
          <input
            value={prospectEmail}
            onChange={(e) => setProspectEmail(e.target.value)}
            type="email"
            placeholder="e.g. dana@example.com"
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="Context" hint="Where the business lives and any materials you have. Used to seed AI drafts.">
        <Field label="LinkedIn" hint="Company or contact LinkedIn URL. Optional.">
          <input
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            type="text"
            inputMode="url"
            placeholder="e.g. linkedin.com/company/nissan"
            className={inputClass}
          />
        </Field>

        <Field label="Business website" hint="Their main site. Optional.">
          <input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            type="text"
            inputMode="url"
            placeholder="e.g. nissanofmckinney.com"
            className={inputClass}
          />
        </Field>

        <Field label="Live work URL" hint="Link to the deliverable — a deployed app or demo people can interact with. Optional.">
          <input
            value={liveUrl}
            onChange={(e) => setLiveUrl(e.target.value)}
            type="text"
            inputMode="url"
            placeholder="e.g. app.nissanofmckinney.com"
            className={inputClass}
          />
        </Field>

        <Field label="Materials" hint="Links to a deck, doc, or article — and files you can upload.">
          <div className="space-y-3">
            {links.map((link, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5">
                  <input
                    value={link.url}
                    onChange={(e) => updateLink(i, { url: e.target.value })}
                    type="text"
                    inputMode="url"
                    placeholder="https://… (link URL)"
                    className={inputClass}
                  />
                  <input
                    value={link.label}
                    onChange={(e) => updateLink(i, { label: e.target.value })}
                    type="text"
                    placeholder="Label (optional) — e.g. Pitch deck"
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="mt-1 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                  aria-label="Remove link"
                >
                  Remove
                </button>
              </div>
            ))}

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((file, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-neutral-700">
                      {file.name}
                      <span className="ml-2 text-xs text-neutral-400">{formatBytes(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="shrink-0 rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                      aria-label="Remove file"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addLink}>
                + Add link
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
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
        </Field>

        <Field label="Notes" hint="Anything else worth knowing. Optional.">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={20000}
            placeholder="e.g. Leads scattered across 5 sources and getting lost. Wants one place to track every lead."
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create document"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-4 pl-3 border-l-2 border-neutral-100">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-900 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-500 mb-1.5">{hint}</span>}
      {children}
    </label>
  );
}
