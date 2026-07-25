"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Sparkles, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { uploadResume, deleteResume, importFromResume } from "@/lib/actions/builder-profile";

interface ResumeUploadProps {
  resumeFileName: string | null;
}

export function ResumeUpload({ resumeFileName }: ResumeUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Resume must be a PDF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Resume exceeds 10 MB limit.");
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadResume(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Resume uploaded");
      router.refresh();
    });
  }

  async function remove() {
    if (
      !(await confirm({
        title: "Remove your resume?",
        description: "It’ll be removed from your profile. You can upload a new one anytime.",
        confirmText: "Remove resume",
        cancelText: "Cancel",
        icon: Trash2,
        tone: "danger",
      }))
    )
      return;
    startTransition(async () => {
      const result = await deleteResume();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Resume removed");
      router.refresh();
    });
  }

  function importExperience() {
    startTransition(async () => {
      const result = await importFromResume();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const parts: string[] = [];
      if (result.imported) {
        parts.push(`${result.imported} experience ${result.imported === 1 ? "entry" : "entries"} added`);
      }
      if (result.basicsUpdated) parts.push("headline & bio filled in");
      if (result.skipped && !result.imported) parts.push("already up to date");
      toast.success(parts.length > 0 ? `Imported from resume: ${parts.join(", ")}.` : "Profile updated from resume.");
      router.refresh();
    });
  }

  return (
    <div className="ss-field">
      <span className="ss-label">Resume</span>
      <div className="ss-filerow">
        {resumeFileName ? (
          <div className="ss-mediarow" style={{ gap: "var(--spacing-md)" }}>
            <span className="ss-file">
              <FileText />
              <span>{resumeFileName}</span>
            </span>
            <button type="button" className="ss-btn" onClick={importExperience} disabled={isPending}>
              <Sparkles />
              {isPending ? "Working\u2026" : "Autofill profile"}
            </button>
          </div>
        ) : (
          <span className="ss-file">No resume uploaded.</span>
        )}
        <div className="acts">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            className="ss-btn"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
          >
            <Upload />
            {isPending ? "Uploading\u2026" : resumeFileName ? "Upload new resume" : "Upload"}
          </button>
          {resumeFileName && (
            <button
              type="button"
              className="ss-btn icon danger"
              onClick={remove}
              disabled={isPending}
              title="Remove resume"
              aria-label="Remove resume"
            >
              <Trash2 />
            </button>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
