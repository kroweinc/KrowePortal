import { createAdminClient } from "@/lib/supabase/server";
import { isPreviewableImage } from "@/lib/attachments-constants";
import type { TaskAttachment } from "@/lib/types";

// Preview links outlive the 60s download link from getAttachmentSignedUrl: the
// detail sheet can sit open for a long stretch, and a minute-long URL would
// leave a broken <img> behind it. An hour covers a working session.
const PREVIEW_TTL_SECONDS = 60 * 60;

/**
 * Mints a signed URL for every image attachment in the list, in one storage
 * round trip, and returns the rows with `preview_url` filled in. Non-images and
 * rows with no stored file pass through untouched.
 *
 * Every read path that feeds <TaskAttachments> runs through this, so the
 * component never has to sign anything itself.
 */
export async function withPreviewUrls<T extends TaskAttachment>(
  attachments: T[]
): Promise<T[]> {
  const previewable = attachments.filter(
    (a) => a.storage_path && isPreviewableImage(a.file_name, a.mime_type)
  );
  if (previewable.length === 0) return attachments;

  const { data, error } = await createAdminClient()
    .storage.from("task-attachments")
    .createSignedUrls(
      previewable.map((a) => a.storage_path as string),
      PREVIEW_TTL_SECONDS
    );

  // A signing failure is not worth failing the read over — the rows still
  // render as download links, just without the inline image.
  if (error || !data) return attachments;

  // createSignedUrls returns one entry per requested path, in order.
  const urlByPath = new Map<string, string>();
  data.forEach((entry, i) => {
    const path = previewable[i]?.storage_path;
    if (path && entry.signedUrl) urlByPath.set(path, entry.signedUrl);
  });

  return attachments.map((a) => {
    const url = a.storage_path ? urlByPath.get(a.storage_path) : undefined;
    return url ? { ...a, preview_url: url } : a;
  });
}
