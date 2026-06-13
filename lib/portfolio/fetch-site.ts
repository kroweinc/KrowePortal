import { lookup } from "node:dns/promises";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 500_000;
const MAX_EXTRA_PAGES = 4;
const MAX_PAGE_CHARS = 15_000;
const MAX_TOTAL_CHARS = 40_000;
// Below this the site almost certainly renders client-side and we'd be
// feeding the AI an empty shell.
const MIN_CONTENT_CHARS = 200;

const SUBPAGE_KEYWORDS = /(project|work|about|experience|resume|cv|portfolio)/i;
const SKIP_EXTENSIONS =
  /\.(pdf|png|jpe?g|gif|webp|avif|svg|ico|zip|tar|gz|mp4|mov|webm|mp3|css|js|mjs|json|xml|txt|woff2?)$/i;
const SKIP_HREF = /^(#|mailto:|javascript:|tel:|data:)/i;

const ERR_UNFETCHABLE = "That URL can't be fetched.";
const ERR_UNREACHABLE = "Couldn't reach that site. Check the URL and try again.";

export interface FetchedSite {
  content: string;
  pagesFetched: number;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return isPrivateIpv4(address);
  const addr = address.toLowerCase();
  if (addr === "::" || addr === "::1") return true;
  const mappedV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mappedV4) return isPrivateIpv4(mappedV4[1]);
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  return false;
}

/**
 * SSRF guard: only public http(s) hosts may be fetched. Resolves the hostname
 * and rejects if ANY address is private/reserved. DNS rebinding between this
 * lookup and the actual fetch is a residual risk we accept for v1 (fetch()
 * can't pin a resolved IP).
 *
 * Returns a user-facing error string, or null when the URL is safe.
 */
async function checkUrlSafe(u: URL): Promise<string | null> {
  if (u.protocol !== "http:" && u.protocol !== "https:") return ERR_UNFETCHABLE;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return ERR_UNFETCHABLE;
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return ERR_UNREACHABLE;
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address, a.family))) {
    return ERR_UNFETCHABLE;
  }
  return null;
}

/**
 * Fetch one page with manual redirect handling so every hop is re-validated
 * against the SSRF guard (a public site could otherwise redirect us to an
 * internal address).
 */
async function fetchPage(
  rawUrl: string
): Promise<{ html?: string; finalUrl?: string; error?: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: ERR_UNFETCHABLE };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const unsafe = await checkUrlSafe(url);
    if (unsafe) return { error: unsafe };

    let res: Response;
    try {
      res = await fetch(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "KrowePortal-ProfileImport/1.0",
          Accept: "text/html",
        },
      });
    } catch {
      return { error: ERR_UNREACHABLE };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { error: ERR_UNREACHABLE };
      try {
        url = new URL(location, url);
      } catch {
        return { error: ERR_UNFETCHABLE };
      }
      continue;
    }

    if (!res.ok) return { error: ERR_UNREACHABLE };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return { error: "That URL isn't a web page. Link your portfolio site's homepage." };
    }
    const body = await res.text();
    return { html: body.slice(0, MAX_PAGE_BYTES), finalUrl: url.href };
  }

  return { error: ERR_UNREACHABLE };
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * HTML → plain text. Anchors are rewritten to "text (absolute-url)" so the AI
 * can attach links to the projects it extracts; relative hrefs are resolved
 * against the page URL here, at the source.
 */
function extractText(html: string, baseUrl: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1]?.trim() ?? "";
  const metaDescription =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(s)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(s)?.[1] ??
    "";

  s = s.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const target = decodeEntities(href.trim());
      if (SKIP_HREF.test(target)) return ` ${text} `;
      try {
        return ` ${text} (${new URL(target, baseUrl).href}) `;
      } catch {
        return ` ${text} `;
      }
    }
  );

  s = s
    .replace(/<\/(p|li|h[1-6]|div|section|article|header|footer|tr|ul|ol|blockquote)\s*>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const head = [title, metaDescription].filter(Boolean).join("\n");
  return [head, lines.join("\n")].filter(Boolean).join("\n").trim();
}

/**
 * Same-origin subpage links worth crawling: hrefs or anchor texts that look
 * like project/about/experience pages, deduped by pathname.
 */
function collectSubpageLinks(html: string, base: URL): string[] {
  const links: string[] = [];
  const seen = new Set<string>([base.pathname.replace(/\/$/, "") || "/"]);
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) && links.length < MAX_EXTRA_PAGES) {
    const href = decodeEntities(match[1].trim());
    if (SKIP_HREF.test(href)) continue;
    const text = match[2].replace(/<[^>]+>/g, " ");
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin) continue;
    if (SKIP_EXTENSIONS.test(resolved.pathname)) continue;
    if (!SUBPAGE_KEYWORDS.test(resolved.pathname) && !SUBPAGE_KEYWORDS.test(text)) continue;
    const key = resolved.pathname.replace(/\/$/, "") || "/";
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(resolved.origin + resolved.pathname);
  }
  return links;
}

/**
 * Fetch a portfolio site as AI-readable text: the homepage plus up to
 * MAX_EXTRA_PAGES same-origin pages that look like project/about/experience
 * pages (most portfolios split those onto subpages). Static HTML only —
 * client-rendered SPAs surface as "not enough content".
 */
export async function fetchPortfolioSite(
  url: string
): Promise<{ site?: FetchedSite; error?: string }> {
  const home = await fetchPage(url);
  if (!home.html || !home.finalUrl) return { error: home.error ?? ERR_UNREACHABLE };
  const base = new URL(home.finalUrl);

  const pages: { url: string; text: string }[] = [
    { url: base.href, text: extractText(home.html, base.href).slice(0, MAX_PAGE_CHARS) },
  ];

  const subpageUrls = collectSubpageLinks(home.html, base);
  const results = await Promise.allSettled(subpageUrls.map((u) => fetchPage(u)));
  results.forEach((result, i) => {
    // Subpage failures are non-fatal — the homepage alone may be enough.
    if (result.status !== "fulfilled" || !result.value.html) return;
    const pageUrl = result.value.finalUrl ?? subpageUrls[i];
    const text = extractText(result.value.html, pageUrl).slice(0, MAX_PAGE_CHARS);
    if (text) pages.push({ url: pageUrl, text });
  });

  const content = pages
    .filter((p) => p.text)
    .map((p) => `=== PAGE: ${p.url} ===\n${p.text}`)
    .join("\n\n")
    .slice(0, MAX_TOTAL_CHARS);

  if (content.length < MIN_CONTENT_CHARS) {
    return {
      error:
        "Couldn't read enough content from that site — it may require JavaScript to render.",
    };
  }

  return { site: { content, pagesFetched: pages.filter((p) => p.text).length } };
}
