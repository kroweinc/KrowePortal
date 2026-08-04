import { fetchHtmlPage, decodeEntities, ERR_UNREACHABLE } from "@/lib/fetch-html";

/* Brand lookup from a website link — the "paste your site, we'll fill the rest"
   move on the onboarding identity step.

   Deliberately NOT an AI call: everything we want is already declared in the
   page head (og:site_name, application-name, <title>, description), so a regex
   pass returns in one round trip instead of several seconds. The LOGO isn't
   parsed here at all — <BrandLogo> already resolves one from a host through
   Brandfetch's CDN and Google's favicon service, so capturing the domain is
   enough to show a real logo everywhere. */

const MAX_NAME_CHARS = 120; // matches builder_profiles.agency_name's field cap
const MAX_DESCRIPTION_CHARS = 200;

// Title separators: "Ember Studio — AI product studio", "Home | Ember Studio",
// "Home \ Anthropic", "Superhuman: Mail that works". A hyphen needs space on
// both sides so "e-commerce" isn't read as a separator; a colon usually has
// none in front of it.
const TITLE_SEPARATORS = /\s*[|·•—–:\\/]\s+|\s+-\s+/;
const GENERIC_SEGMENT = /^(home|homepage|welcome|index|official (site|website)|start)$/i;

export interface FetchedBrand {
  /** The agency/company name as the site declares it; null when unreadable. */
  name: string | null;
  /** One-line description from the page, shown as fetch confirmation. */
  description: string | null;
  /** Final URL after redirects — what we store on the profile. */
  websiteUrl: string;
  /** Bare host for <BrandLogo>, e.g. "emberstudio.com". */
  domain: string;
}

/** First matching meta tag's content, tolerating either attribute order. */
function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match =
      new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, "i").exec(html) ??
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, "i").exec(html);
    const value = clean(match?.[1] ?? "");
    if (value) return value;
  }
  return null;
}

function clean(raw: string): string {
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

/**
 * The brand out of a <title>. Titles pair the brand with a tagline ("Ember
 * Studio — AI product studio for founders") or a page label ("Home | Ember
 * Studio"), so drop the label-ish segments and keep the shortest of what's
 * left — taglines are always the wordier half.
 */
function brandFromTitle(title: string): string | null {
  const segments = title.split(TITLE_SEPARATORS).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const named = segments.filter((s) => !GENERIC_SEGMENT.test(s));
  const pool = named.length > 0 ? named : segments;
  const words = (s: string) => s.split(/\s+/).length;
  return pool.reduce((best, s) => (words(s) < words(best) ? s : best), pool[0]);
}

/**
 * Brand out of a MARKDOWN homepage. A growing set of sites (ramp.com among
 * them) content-negotiate anything that isn't a browser down to a markdown
 * "machine version" of the page — which has no <meta> at all, but does lead
 * with an H1 and a prose line.
 */
function brandFromMarkdown(body: string): { name: string | null; description: string | null } {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1] ?? "";
  const prose = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 20 && !/^([#>|*-]|\d+\.|!\[|\[|---)/.test(line));
  return {
    name: heading ? brandFromTitle(stripMarkdown(heading)) : null,
    description: prose ? stripMarkdown(prose) : null,
  };
}

/** Markdown emphasis and links reduced to their text: "**[Ramp](x)**" → "Ramp". */
function stripMarkdown(s: string): string {
  return clean(
    s
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`#]/g, "")
  );
}

/** Last-resort name from the host itself: "ember-studio.com" → "Ember Studio". */
function brandFromHost(host: string): string | null {
  const label = host.replace(/^www\./, "").split(".")[0];
  if (!label) return null;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Read a company's brand off its homepage. The URL is fetched through the
 * shared SSRF-guarded fetcher, so a builder can't point this at an internal
 * address. Returns a user-facing error string when the site can't be read.
 */
export async function fetchBrand(rawUrl: string): Promise<{ brand?: FetchedBrand; error?: string }> {
  const page = await fetchHtmlPage(rawUrl, {
    userAgent: "KrowePortal-BrandFetch/1.0",
    notHtmlError: "That link isn't a web page. Try your homepage.",
    allowContentTypes: ["text/html", "text/markdown", "text/plain"],
  });
  if (!page.html || !page.finalUrl) return { error: page.error ?? ERR_UNREACHABLE };

  const final = new URL(page.finalUrl);
  const markdown = !page.contentType?.includes("text/html");

  let name: string | null;
  let description: string | null;
  if (markdown) {
    ({ name, description } = brandFromMarkdown(page.html));
  } else {
    // Strip scripts first: inline JSON blobs carry <meta>-looking strings.
    const html = page.html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
    const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
    name =
      metaContent(html, ["og:site_name", "application-name", "apple-mobile-web-app-title"]) ??
      brandFromTitle(metaContent(html, ["og:title", "twitter:title"]) ?? title);
    description = metaContent(html, ["og:description", "description", "twitter:description"]);
  }
  name = name ?? brandFromHost(final.hostname);

  return {
    brand: {
      name: name ? name.slice(0, MAX_NAME_CHARS) : null,
      description: description ? description.slice(0, MAX_DESCRIPTION_CHARS) : null,
      websiteUrl: final.href.replace(/\/$/, ""),
      domain: final.hostname.replace(/^www\./, ""),
    },
  };
}
