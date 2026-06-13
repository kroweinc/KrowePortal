"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadResume, deleteResume, importFromResume } from "@/lib/actions/builder-profile";

interface ResumeUploadProps {
  resumeFileName: string | null;
}

export function ResumeUpload({ resumeFileName }: ResumeUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

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

  function remove() {
    if (!confirm("Remove your resume from the profile?")) return;
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      {resumeFileName ? (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-neutral-700">
          <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
          <span className="truncate">{resumeFileName}</span>
        </span>
      ) : (
        <span className="text-sm text-neutral-400">No resume uploaded.</span>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />
        {resumeFileName && (
          <Button variant="outline" size="sm" onClick={importExperience} disabled={isPending}>
            <Sparkles className="h-3.5 w-3.5" />
            {isPending ? "Working…" : "Fill profile from resume"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
        >
          <Upload className="h-3.5 w-3.5" />
          {isPending ? "Uploading…" : resumeFileName ? "Replace" : "Upload PDF"}
        </Button>
        {resumeFileName && (
          <Button variant="outline" size="sm" onClick={remove} disabled={isPending}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
