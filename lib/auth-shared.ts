import type { Profile } from "@/lib/types";

export const ROLE_SWITCHER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === "true";
export const DEV_ROLE_COOKIE = "dev_role";
export const PENDING_INVITE_COOKIE = "pending_invite_token";
export const DEV_PROFILE_IDS = new Set([
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
]);

export const DEV_PROFILES: Record<string, Profile> = {
  operator: {
    id: "00000000-0000-0000-0000-000000000001",
    role: "operator",
    display_name: "Dev Operator",
    created_at: new Date().toISOString(),
    onboarding_status: "completed",
    onboarding: {},
  },
  builder: {
    id: "00000000-0000-0000-0000-000000000002",
    role: "builder",
    display_name: "Dev Builder",
    created_at: new Date().toISOString(),
    onboarding_status: "completed",
    onboarding: {},
  },
};

export function resolveDevRole(
  getCookie: (name: string) => string | undefined
): "operator" | "builder" | null {
  if (!ROLE_SWITCHER_ENABLED) return null;
  const cookie = getCookie(DEV_ROLE_COOKIE);
  if (cookie && cookie in DEV_PROFILES) return cookie as "operator" | "builder";
  const envRole = process.env.DEV_AUTH_ROLE;
  if (envRole && envRole in DEV_PROFILES) return envRole as "operator" | "builder";
  return null;
}
