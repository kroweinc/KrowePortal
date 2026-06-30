import "server-only";

import { MAX_SOP_CHARS } from "@/lib/attachments-constants";

// ============================================================
// Fetch and extract readable text from a builder-saved link so it becomes
// searchable knowledge (links were previously stored as bare references and
// never embedded). Best-effort: HTML is stripped to text, PDFs are read via
// unpdf, plain text is used directly; anything else (or a failure) yields an
// error the caller records without blocking link creation.
//
// SSRF guard: links are builder-provided, but we still refuse loopback / private
// / link-local hosts so a fetch can't reach internal services or cloud metadata.
// ============================================================

export type FetchLinkResult = { text: string } | { error: string };

const FETCH_TIMEOUT_MS = 6_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap on fetched bodies

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  // IPv4 literal in a private / loopback / link-local range.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/** Strip HTML to readable text: drop script/style/comments, tags → spaces. */
function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

export async function fetchLinkText(url: string): Promise<FetchLinkResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http(s) links can be indexed." };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { error: "That host can't be indexed." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "KrowePortal-ContextBot/1.0",
        accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
      },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { error: aborted ? "Timed out fetching the link." : "Couldn't reach the link." };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) return { error: `Link returned HTTP ${res.status}.` };

  const declaredLen = Number(res.headers.get("content-length") ?? 0);
  if (declaredLen && declaredLen > MAX_BYTES) return { error: "Linked resource is too large." };
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

  try {
    if (contentType.includes("application/pdf")) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) return { error: "Linked file is too large." };
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buf);
      const result = await extractText(pdf, { mergePages: true });
      const text = (Array.isArray(result.text) ? result.text.join("\n\n") : result.text).trim();
      return text ? { text: text.slice(0, MAX_SOP_CHARS) } : { error: "No text in the linked PDF." };
    }

    const textual =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      contentType.includes("text/plain") ||
      contentType === "";
    if (textual) {
      const raw = await res.text();
      if (raw.length > MAX_BYTES) return { error: "Linked page is too large." };
      const text = contentType.includes("text/plain") ? raw.trim() : htmlToText(raw);
      return text ? { text: text.slice(0, MAX_SOP_CHARS) } : { error: "No readable text on the linked page." };
    }

    return { error: `Unsupported link content type (${contentType || "unknown"}).` };
  } catch (err) {
    console.error("[fetchLinkText]", err);
    return { error: "Couldn't extract text from the link." };
  }
}
