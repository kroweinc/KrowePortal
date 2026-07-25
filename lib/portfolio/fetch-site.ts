import { fetchHtmlPage, decodeEntities, ERR_UNREACHABLE } from "@/lib/fetch-html";

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

export interface FetchedSite {
  content: string;
  pagesFetched: number;
}

/** Portfolio-flavored wrapper around the shared guarded fetcher. */
function fetchPage(rawUrl: string) {
  return fetchHtmlPage(rawUrl, {
    userAgent: "KrowePortal-ProfileImport/1.0",
    notHtmlError: "That URL isn't a web page. Link your portfolio site's homepage.",
  });
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
