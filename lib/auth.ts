import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import {
  ROLE_SWITCHER_ENABLED,
  DEV_ROLE_COOKIE,
  DEV_PROFILE_IDS,
  DEV_PROFILES,
  resolveDevRole,
} from "@/lib/auth-shared";

export { ROLE_SWITCHER_ENABLED, DEV_ROLE_COOKIE, DEV_PROFILE_IDS, DEV_PROFILES };

export async function getCurrentProfile(): Promise<Profile | null> {
  const cookieStore = await cookies();
  const devRole = resolveDevRole((n) => cookieStore.get(n)?.value);
  if (devRole) return DEV_PROFILES[devRole];

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
