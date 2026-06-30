import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { homePath } from "@/lib/home-path";

export default async function RootPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    // Distinguish "logged in but no profile yet" (→ onboarding) from "logged
    // out" (→ login). createClient is request-cached, so this reuses the client
    // getCurrentProfile already built.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    redirect(homePath(null, Boolean(user)));
  }

  // Builders mid-wizard resume where they left off. Only this root router
  // nudges them back — /b itself stays reachable so nobody gets trapped.
  redirect(homePath(profile, true));
}
