import type { Profile } from "@/lib/types";

/**
 * Canonical landing path for a visitor, given their resolved profile and whether
 * an auth session exists. Single source of truth shared by the root router
 * (app/page.tsx) and the OAuth callback (app/auth/callback/route.ts) so the
 * post-sign-in destination can't drift between them.
 *
 * - No session       → /login
 * - Session, no row  → /onboarding (brand-new sign-in mid-setup)
 * - Operator         → /o
 * - Builder mid-wizard → /onboarding (resume where they left off)
 * - Builder          → /b
 */
export function homePath(profile: Profile | null, hasSession: boolean): string {
  if (!profile) return hasSession ? "/onboarding" : "/login";
  if (profile.role === "operator") return "/o";
  if (profile.onboarding_status === "in_progress") return "/onboarding";
  return "/b";
}
