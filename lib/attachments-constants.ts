export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".pdf",
  ".txt", ".csv", ".md", ".json",
  ".html", ".htm",
  ".zip",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls",
]);

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
