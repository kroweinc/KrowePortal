import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PENDING_INVITE_COOKIE } from "@/lib/auth-shared";
import { validatePendingInvite } from "@/lib/invitations";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();

  // Already onboarded
  if (profile?.role) {
    redirect(profile.role === "operator" ? "/o" : "/b");
  }

  // If the visitor has a pending invite cookie, send them to the invite page
  // instead of writing role="builder". This covers the case where they
  // drifted to /onboarding after the OAuth round-trip dropped next=/join/<token>.
  const cookieStore = await cookies();
  const inviteToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
  const validToken = await validatePendingInvite(inviteToken);
  if (validToken) {
    redirect(`/join/${validToken}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const fullName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Welcome to Krowe Portal
          </h1>
          <p className="mt-1 text-sm text-neutral-500">Tell us who you are to get started.</p>
        </div>
        <OnboardingForm defaultName={fullName} />
      </div>
    </main>
  );
}
