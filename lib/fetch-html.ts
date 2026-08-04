import { lookup } from "node:dns/promises";

/* One guarded way to pull a web page into the server. Every caller that fetches
   a URL a USER typed goes through here: the SSRF guard, the redirect re-check,
   the timeout, and the size cap are the parts that must not be re-implemented
   per feature. Callers own what they do with the HTML (portfolio crawl, brand
   lookup). */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 500_000;

export const ERR_UNFETCHABLE = "That URL can't be fetched.";
export const ERR_UNREACHABLE = "Couldn't reach that site. Check the URL and try again.";
const ERR_NOT_HTML = "That URL isn't a web page.";

export interface FetchedPage {
  html?: string;
  finalUrl?: string;
  /** The response's content type, for callers that accept more than HTML. */
  contentType?: string;
  error?: string;
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

/** Decode the named entities above plus numeric ones (`&#x27;`, `&#8217;`),
    which show up constantly in og: descriptions. Anything unparseable is left
    verbatim rather than dropped. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code: string) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    });
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
export async function fetchHtmlPage(
  rawUrl: string,
  opts: {
    userAgent: string;
    notHtmlError?: string;
    /** Content types the caller can parse. Defaults to HTML only. */
    allowContentTypes?: string[];
  } = { userAgent: "KrowePortal/1.0" }
): Promise<FetchedPage> {
  const allowed = opts.allowContentTypes ?? ["text/html"];
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
          "User-Agent": opts.userAgent,
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
    if (!allowed.some((type) => contentType.includes(type))) {
      return { error: opts.notHtmlError ?? ERR_NOT_HTML };
    }
    const body = await res.text();
    return { html: body.slice(0, MAX_PAGE_BYTES), finalUrl: url.href, contentType };
  }

  return { error: ERR_UNREACHABLE };
}
