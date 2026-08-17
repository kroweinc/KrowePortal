export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".pdf",
  ".txt", ".csv", ".md", ".json",
  ".html", ".htm",
  ".zip",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls",
]);

// The subset of the allowlist a browser paints natively, so the attachment can
// render inline instead of sitting behind a download button. SVG is included:
// inside an <img> it can't run script, which is the only reason to hold it back.
export const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
]);

/** True when this attachment is an image we can show inline. */
export function isPreviewableImage(
  fileName: string,
  mimeType?: string | null
): boolean {
  if (mimeType?.startsWith("image/")) return true;
  const ext = "." + (fileName.split(".").pop()?.toLowerCase() ?? "");
  return PREVIEWABLE_IMAGE_EXTENSIONS.has(ext);
}

export const ATTACHMENT_ACCEPT = [
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml",
  "application/pdf",
  "text/plain,text/csv,text/html",
  "application/json",
  "application/zip",
  ".md,.html,.htm,.docx,.xlsx,.pptx,.doc,.xls",
].join(",");

// SOP / discovery-call transcripts. Narrower than materials: only formats we
// can extract readable text from (plain text variants + .pdf via unpdf +
// .docx via mammoth). Legacy binary .doc is excluded — mammoth reads .docx only.
export const SOP_ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".vtt", ".srt", ".csv",
  ".pdf",
  ".docx",
]);

export const SOP_ACCEPT = [
  "text/plain,text/csv",
  "application/pdf",
  ".md,.vtt,.srt,.docx",
].join(",");

// Upper bound on a single stored transcript. Generous (a 60-min call runs long)
// but bounded so one paste can't blow up the row or the generation prompt. The
// composer applies its own tighter per-transcript / aggregate caps at prompt time.
export const MAX_SOP_CHARS = 100_000;
