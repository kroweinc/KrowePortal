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

  redirect("/b");
}
