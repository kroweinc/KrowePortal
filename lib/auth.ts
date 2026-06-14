import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const DEV_TOGGLE_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER !== "false";
export const DEV_ROLE_COOKIE = "dev_role";
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

export async function getCurrentProfile(): Promise<Profile | null> {
  // All dev bypasses are gated by DEV_TOGGLE_ENABLED (NODE_ENV !== "production"),
  // so neither the cookie nor the env override can grant a synthetic identity in
  // production even if the variables are accidentally set.
  if (DEV_TOGGLE_ENABLED) {
    const cookieStore = await cookies();
    const cookieRole = cookieStore.get(DEV_ROLE_COOKIE)?.value;
    if (cookieRole && cookieRole in DEV_PROFILES) {
      return DEV_PROFILES[cookieRole];
    }

    // Env bypass: set DEV_AUTH_ROLE=operator or DEV_AUTH_ROLE=builder in .env.local
    const devRole = process.env.DEV_AUTH_ROLE;
    if (devRole && devRole in DEV_PROFILES) {
      return DEV_PROFILES[devRole];
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
}

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
