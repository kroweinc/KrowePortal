import { redirect } from "next/navigation"

// GitHub settings moved into the consolidated Settings area. Preserve the OAuth
// callback's query params (?github=connected / ?error=…) so the success/error
// banners still render on the new page, and keep old deep links alive.
export default async function LegacyGitHubSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; error?: string }>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.github) qs.set("github", params.github)
  if (params.error) qs.set("error", params.error)
  const query = qs.toString()
  redirect(`/b/settings/github${query ? `?${query}` : ""}`)
}
