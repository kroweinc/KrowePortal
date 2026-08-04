// Splits a stored profile link into the fixed prefix the editor renders as an
// input addon and the part the builder actually types. The DB still stores full
// URLs — this is presentation only, so server validation (normalizeUrl +
// the linkedin.com / github.com guards in updateProfileBasics) is untouched.
//
// Every function here is total: an unexpected URL round-trips unchanged rather
// than being silently mangled. A builder whose LinkedIn is a company page or
// whose portfolio sits behind a custom scheme still sees their real value.

export type ProfileLinkKind = "linkedin" | "github" | "portfolio";

export const LINK_PREFIXES: Record<ProfileLinkKind, string> = {
  linkedin: "https://linkedin.com/in/",
  github: "https://github.com/",
  portfolio: "https://",
};

export const LINK_PLACEHOLDERS: Record<ProfileLinkKind, string> = {
  linkedin: "username",
  github: "username",
  portfolio: "yourportfolio.com",
};

// Accepted spellings of each prefix. Order matters: longest first, so
// "linkedin.com/in/" wins over the bare host.
const PREFIX_PATTERNS: Record<ProfileLinkKind, RegExp[]> = {
  linkedin: [/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\//i],
  github: [/^(?:https?:\/\/)?(?:www\.)?github\.com\//i],
  portfolio: [/^https?:\/\//i],
};

/** The typed portion of a stored URL, or the whole URL when it doesn't sit
    under the expected prefix (a LinkedIn company page, say). */
export function splitProfileUrl(kind: ProfileLinkKind, url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  for (const re of PREFIX_PATTERNS[kind]) {
    if (re.test(trimmed)) return trimmed.replace(re, "").replace(/\/+$/, "");
  }
  return trimmed;
}

/** Rebuilds the full URL the server stores. A handle that already carries its
    own scheme or host passes through, so re-editing a value that
    `splitProfileUrl` surfaced verbatim can't produce a double prefix. */
export function joinProfileUrl(kind: ProfileLinkKind, handle: string): string {
  const trimmed = (handle ?? "").trim().replace(/^\/+/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  for (const re of PREFIX_PATTERNS[kind]) {
    if (re.test(trimmed)) return `https://${trimmed.replace(/^\/\//, "")}`;
  }
  // A bare host typed into LinkedIn/GitHub ("example.com/me") is a link to
  // somewhere else entirely — keep it whole rather than nesting it under our
  // prefix, and let the server's domain check reject it with a real message.
  if (kind !== "portfolio" && /^[^/\s]+\.[a-z]{2,}(?:\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return LINK_PREFIXES[kind] + trimmed;
}
