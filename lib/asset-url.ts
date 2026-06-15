/**
 * Resolve a `public/` asset path against the portal's own origin.
 *
 * In production the portal is path-proxied behind krowehub.com (a separate
 * landing-site project). A root-relative asset URL like `/KroweIcon.png`
 * resolves against the *page* origin — krowehub.com — and 404s there because
 * the file lives in the portal's `public/`, not the landing site's. The same
 * applies to next/image, whose `/_next/image` optimizer endpoint is requested
 * from krowehub.com and can't find the source file either.
 *
 * `assetPrefix` in next.config only redirects `/_next/static/*` chunks — it
 * does NOT cover `/_next/image` or files under `public/`. So we prefix those
 * asset URLs ourselves with NEXT_PUBLIC_ASSET_PREFIX (the portal's own Vercel
 * origin) to load them from the same origin that serves them.
 *
 * No prefix set (local dev) or an already-absolute URL (http(s):// , //, data:,
 * blob:) → returned unchanged, so third-party logo URLs and signed Supabase
 * Storage URLs pass through untouched.
 */
const PREFIX = (process.env.NEXT_PUBLIC_ASSET_PREFIX ?? "").trim().replace(/\/+$/, "");

export function assetUrl(path: string): string {
  if (!PREFIX) return path;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path) || /^(?:data|blob):/i.test(path)) {
    return path;
  }
  return `${PREFIX}${path.startsWith("/") ? "" : "/"}${path}`;
}
