"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUp, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { uploadAvatar, deleteAvatar } from "@/lib/actions/builder-profile";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface AvatarUploadProps {
  avatarUrl: string | null;
  displayName: string;
}

export function AvatarUpload({ avatarUrl, displayName }: AvatarUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "?";

  const submitFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error("Photo must be a JPEG, PNG, or WebP image.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Photo exceeds 5 MB limit.");
        return;
      }
      const formData = new FormData();
      formData.set("file", file);
      startTransition(async () => {
        const result = await uploadAvatar(formData);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Profile photo updated");
        router.refresh();
      });
    },
    [router]
  );

  // Pasting an image anywhere on the page sets it as the photo — except into
  // text fields, where an accidental image in the clipboard shouldn't upload.
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/")
      );
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      submitFile(file);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [submitFile]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    submitFile(file);
  }

  async function remove() {
    if (
      !(await confirm({
        title: "Remove your profile photo?",
        description: "Your avatar will revert to your initials. You can upload a new one anytime.",
        confirmText: "Remove photo",
        cancelText: "Cancel",
        icon: Trash2,
        tone: "danger",
      }))
    )
      return;
    startTransition(async () => {
      const result = await deleteAvatar();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile photo removed");
      router.refresh();
    });
  }

  return (
    <div className="ss-mediarow">
      {avatarUrl ? (
        // Signed URLs rotate per render, so next/image optimization would
        // never cache hit — a plain img keeps this simple.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={displayName} className="ss-avatar" />
      ) : (
        <span className="ss-avatar">{initials}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="ss-mediarow" style={{ gap: "var(--spacing-md)" }}>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            className="ss-btn"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
          >
            <ImageUp />
            {isPending ? "Working\u2026" : avatarUrl ? "Upload new photo" : "Upload"}
          </button>
          {avatarUrl && (
            <button
              type="button"
              className="ss-btn icon danger"
              onClick={remove}
              disabled={isPending}
              title="Remove photo"
              aria-label="Remove photo"
            >
              <Trash2 />
            </button>
          )}
        </div>
        <p className="ss-hint" style={{ marginTop: "var(--spacing-sm)" }}>
          Or copy an image and paste it here (Ctrl/Cmd+V).
        </p>
      </div>
      {confirmDialog}
    </div>
  );
}
