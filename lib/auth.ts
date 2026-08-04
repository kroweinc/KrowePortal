import { cookies } from "next/headers";
import { cache } from "react";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { OnboardingState, OnboardingStatus, Profile } from "@/lib/types";

export const DEV_TOGGLE_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER !== "false";
export const DEV_ROLE_COOKIE = "dev_role";
// Set by /api/dev/onboarding/reset — see withDevOnboarding below.
export const DEV_ONBOARDING_COOKIE = "dev_onboarding";
export const DEV_PROFILE_IDS = new Set([
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
]);

const DEV_PROFILES: Record<string, Profile> = {
  operator: {
    id: "00000000-0000-0000-0000-000000000001",
    role: "operator",
    display_name: "Dev Operator",
    created_at: new Date().toISOString(),
    onboarding_status: "completed",
    onboarding: {},
    tour_status: "completed",
  },
  builder: {
    id: "00000000-0000-0000-0000-000000000002",
    role: "builder",
    display_name: "Dev Builder",
    created_at: new Date().toISOString(),
    onboarding_status: "completed",
    onboarding: {},
    // Flip to "pending" locally to exercise the tour's auto-start.
    tour_status: "completed",
  },
};

/**
 * Dev-only onboarding testing mode.
 *
 * A dev identity is synthetic, but the onboarding wizard's state can't be: every
 * step writes profiles.onboarding and the next render reads it back, so the
 * hardcoded `onboarding: {}` above pins the wizard to step one forever and
 * `onboarding_status: "completed"` bounces /onboarding straight to /b. When the
 * dev_onboarding cookie is set, hydrate the two fields the wizard owns (plus the
 * display name it edits) from the dev profile's real row — writes already land
 * there, since DEV_PROFILE_IDS routes dev actions through the service role.
 *
 * Gated on the cookie rather than always-on so ordinary dev browsing keeps its
 * zero-query identity resolution. tour_status stays hardcoded so the flip noted
 * above is still the way to exercise the tour.
 */
async function withDevOnboarding(base: Profile): Promise<Profile> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("display_name, onboarding_status, onboarding")
    .eq("id", base.id)
    .maybeSingle();
  if (!data) return base;

  return {
    ...base,
    display_name: (data.display_name as string | null) ?? base.display_name,
    onboarding_status: (data.onboarding_status as OnboardingStatus | null) ?? base.onboarding_status,
    onboarding: (data.onboarding as OnboardingState | null) ?? base.onboarding,
  };
}

// Memoized per-request. The layout, the page, and every server action that runs
// during a single render all ask "who is this?" — each call previously made a
// network round-trip to Supabase auth (getUser) plus a profiles query. cache()
// dedupes them to one auth check + one query per request, the single biggest
// lever on page-to-page latency.
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<Profile | null> {
  // All dev bypasses are gated by DEV_TOGGLE_ENABLED (NODE_ENV !== "production"),
  // so neither the cookie nor the env override can grant a synthetic identity in
  // production even if the variables are accidentally set.
  if (DEV_TOGGLE_ENABLED) {
    const cookieStore = await cookies();
    const testingOnboarding = cookieStore.get(DEV_ONBOARDING_COOKIE)?.value === "1";
    const cookieRole = cookieStore.get(DEV_ROLE_COOKIE)?.value;
    if (cookieRole && cookieRole in DEV_PROFILES) {
      const dev = DEV_PROFILES[cookieRole];
      return testingOnboarding ? withDevOnboarding(dev) : dev;
    }

    // Env bypass: set DEV_AUTH_ROLE=operator or DEV_AUTH_ROLE=builder in .env.local
    const devRole = process.env.DEV_AUTH_ROLE;
    if (devRole && devRole in DEV_PROFILES) {
      const dev = DEV_PROFILES[devRole];
      return testingOnboarding ? withDevOnboarding(dev) : dev;
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data ?? null;
});

/**
 * Lightweight viewer resolution for public document pages. Unlike
 * getCurrentProfile, this reports a logged-in *auth session* even when the user
 * has no profile row yet (a brand-new Google sign-in mid-acceptance) so the
 * sign panel can show the accept form rather than the create-account gate.
 */
export async function getAuthViewer(): Promise<{ isAuthenticated: boolean; viewerName: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { isAuthenticated: false, viewerName: "" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const viewerName =
    (profile?.display_name as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    "";

  return { isAuthenticated: true, viewerName };
}
