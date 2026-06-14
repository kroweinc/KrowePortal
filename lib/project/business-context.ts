import type { Project, ProjectMaterial, ProjectSopTranscript } from "@/lib/types";

const HTTP_SCHEME = /^https?:\/\//i;

// Prompt-budget guards for SOP transcripts. Generous per transcript (a long
// discovery call), but the aggregate is bounded so several transcripts can't
// crowd out the rest of the prompt. ~80k chars ≈ ~20k tokens.
const SOP_PER_TRANSCRIPT_CAP = 40_000;
const SOP_AGGREGATE_CAP = 80_000;

/**
 * Normalize a user-typed URL: trim, and prepend https:// when the user omitted
 * a scheme (e.g. "acme.com" → "https://acme.com"). Returns null for blanks and
 * for any explicit non-http(s) scheme (e.g. "javascript://…", "data:…") so a
 * dangerous URL can never be stored and later rendered into an href.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  return HTTP_SCHEME.test(candidate) ? candidate : null;
}

/**
 * Expand a bare GitHub handle into a full profile URL: "octocat" or "@octocat"
 * → "https://github.com/octocat". Anything that already looks like a URL (has a
 * scheme or a dotted host) passes through untouched for normalizeUrl to finish.
 * Returns "" for blanks so callers can treat it like an empty field.
 */
export function githubProfileUrl(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().replace(/^@/, "");
  if (!v) return "";
  // Already a URL or a dotted host (e.g. "github.com/octocat") — leave as-is.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.includes(".") || v.includes("/")) return v;
  // GitHub handles are alphanumeric with single hyphens, up to 39 chars.
  return /^[a-zA-Z0-9-]{1,39}$/.test(v) ? `https://github.com/${v}` : v;
}

/**
 * Defense-in-depth for render sites: only emit http(s) hrefs. Guards against
 * any row created before scheme validation, or any path that bypasses
 * normalizeUrl. Returns "#" for anything that isn't a plain http(s) URL.
 */
export function safeExternalHref(url: string | null | undefined): string {
  const v = (url ?? "").trim();
  return HTTP_SCHEME.test(v) ? v : "#";
}

/**
 * Render the project's discovery-call transcripts (SOPs) into one labeled,
 * budget-capped block. This is the verbatim discovery SOURCE — generators are
 * told to extract facts from it, not restate it, and not to re-ask what it
 * already answers. Returns "" when there are no transcripts.
 *
 * Exported so the contract generator (which doesn't use composeBusinessContext)
 * can reuse the exact same block.
 */
export function composeSopBlock(
  transcripts: Pick<ProjectSopTranscript, "label" | "content" | "created_at">[] = []
): string {
  const usable = transcripts.filter((t) => t.content?.trim());
  if (!usable.length) return "";

  const parts: string[] = [];
  let budget = SOP_AGGREGATE_CAP;
  for (const t of usable) {
    if (budget <= 0) break;
    const label = t.label?.trim() || "Transcript";
    const date = t.created_at ? t.created_at.slice(0, 10) : "";
    let body = t.content.trim();
    if (body.length > SOP_PER_TRANSCRIPT_CAP) body = `${body.slice(0, SOP_PER_TRANSCRIPT_CAP)}\n…[truncated]`;
    if (body.length > budget) body = `${body.slice(0, budget)}\n…[truncated]`;
    budget -= body.length;
    parts.push(`--- ${label}${date ? ` (${date})` : ""} ---\n${body}`);
  }

  return `SOP / Discovery Call Transcript${usable.length > 1 ? "s" : ""} (verbatim discovery source — extract facts from this; do not restate it verbatim, and do not re-ask what it already answers):\n${parts.join("\n\n")}`;
}

/**
 * Fold a project's structured context (notes, LinkedIn, website), its
 * supporting materials, and any discovery-call transcripts into the single
 * `businessContext` string the AI draft functions expect. Returns undefined
 * when there's nothing to say, so callers can pass it straight through.
 *
 * Files can't be read by the text model, so only their names are surfaced as
 * "available material" signposts; link materials contribute their URL + label.
 * SOP transcripts contribute their extracted text as a distinct final block.
 */
export function composeBusinessContext(
  project: Pick<Project, "context" | "linkedin_url" | "website_url">,
  materials: ProjectMaterial[] = [],
  sopTranscripts: Pick<ProjectSopTranscript, "label" | "content" | "created_at">[] = []
): string | undefined {
  const lines: string[] = [];

  const notes = project.context?.trim();
  if (notes) lines.push(notes);

  const refs: string[] = [];
  if (project.website_url?.trim()) refs.push(`Business website: ${project.website_url.trim()}`);
  if (project.linkedin_url?.trim()) refs.push(`LinkedIn: ${project.linkedin_url.trim()}`);

  const materialLines: string[] = [];
  for (const m of materials) {
    if (m.material_type === "link" && m.url) {
      materialLines.push(`- ${m.label?.trim() ? `${m.label.trim()}: ` : ""}${m.url}`);
    } else if (m.material_type === "file" && m.file_name) {
      materialLines.push(`- ${m.file_name} (uploaded file)`);
    }
  }

  if (refs.length) lines.push(refs.join("\n"));
  if (materialLines.length) lines.push(`Reference materials:\n${materialLines.join("\n")}`);

  const sop = composeSopBlock(sopTranscripts);
  if (sop) lines.push(sop);

  const out = lines.join("\n\n").trim();
  return out.length ? out : undefined;
}
