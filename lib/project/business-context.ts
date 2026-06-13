import type { Project, ProjectMaterial } from "@/lib/types";

const HTTP_SCHEME = /^https?:\/\//i;

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
 * Fold a project's structured context (notes, LinkedIn, website) and its
 * supporting materials into the single `businessContext` string the AI draft
 * functions expect. Returns undefined when there's nothing to say, so callers
 * can pass it straight through as `businessContext`.
 *
 * Files can't be read by the text model, so only their names are surfaced as
 * "available material" signposts; link materials contribute their URL + label.
 */
export function composeBusinessContext(
  project: Pick<Project, "context" | "linkedin_url" | "website_url">,
  materials: ProjectMaterial[] = []
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

  const out = lines.join("\n\n").trim();
  return out.length ? out : undefined;
}
