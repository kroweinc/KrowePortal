const CALLBACK_PATH = "/api/github/callback"

function originFromHost(host: string): string {
  const normalized = host.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return `https://${normalized}`
}

/**
 * Resolve the GitHub OAuth redirect URI.
 *
 * Priority:
 * 1. GITHUB_REDIRECT_URI — explicit override (separate dev/prod OAuth apps)
 * 2. APP_ORIGIN / NEXT_PUBLIC_APP_ORIGIN — public host when proxied
 * 3. Vercel production host — when VERCEL_ENV=production and unset above
 * 4. Request origin in non-production — local dev on port 3030, etc.
 */
export function resolveGithubRedirectUri(requestOrigin?: string): string | undefined {
  const explicit = process.env.GITHUB_REDIRECT_URI?.trim()
  if (explicit) return explicit

  const appOrigin =
    process.env.APP_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim()
  if (appOrigin) {
    return `${appOrigin.replace(/\/+$/, "")}${CALLBACK_PATH}`
  }

  if (process.env.VERCEL_ENV === "production") {
    const host =
      process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
      process.env.VERCEL_URL?.trim()
    if (host) {
      return `${originFromHost(host)}${CALLBACK_PATH}`
    }
  }

  if (process.env.NODE_ENV !== "production" && requestOrigin) {
    const origin = requestOrigin.replace(/\/+$/, "")
    return `${origin}${CALLBACK_PATH}`
  }

  return undefined
}

export function getGithubOAuthConfig(requestOrigin?: string) {
  return {
    clientId: process.env.GITHUB_CLIENT_ID?.trim(),
    clientSecret: process.env.GITHUB_CLIENT_SECRET?.trim(),
    redirectUri: resolveGithubRedirectUri(requestOrigin),
  }
}
