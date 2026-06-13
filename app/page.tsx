import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    redirect(user ? "/onboarding" : "/login");
  }

  if (profile.role === "operator") {
    redirect("/o");
  }

  // Builders mid-wizard resume where they left off. Only this root router
  // nudges them back — /b itself stays reachable so nobody gets trapped.
  if (profile.onboarding_status === "in_progress") {
    redirect("/onboarding");
  }

  redirect("/b");
}
