import "server-only";
import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export interface AccountContext {
  profile: Profile;
  /** The auth user's email. Empty for dev profiles (no real auth user). */
  email: string;
  /** Dev role profiles have no auth user — email/password actions are disabled. */
  isDevProfile: boolean;
  /** True when the account has an email/password identity (vs OAuth-only). */
  isPasswordUser: boolean;
}

/**
 * Resolve the account-level context shared by the Account and Security settings
 * pages for BOTH roles. Redirects to /login if unauthenticated. For dev role
 * profiles there is no Supabase auth user, so email/password controls are off.
 */
export async function getAccountContext(): Promise<AccountContext> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (DEV_PROFILE_IDS.has(profile.id)) {
    return { profile, email: "", isDevProfile: true, isPasswordUser: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const identities = user?.identities ?? [];
  const isPasswordUser =
    identities.some((i) => i.provider === "email") || user?.app_metadata?.provider === "email";

  return {
    profile,
    email: user?.email ?? "",
    isDevProfile: false,
    isPasswordUser,
  };
}
