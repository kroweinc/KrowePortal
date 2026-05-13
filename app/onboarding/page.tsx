import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();

  // Already onboarded
  if (profile?.role) {
    redirect(profile.role === "operator" ? "/o" : "/b");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Welcome to Krowe Portal
          </h1>
          <p className="mt-1 text-sm text-neutral-500">Tell us who you are to get started.</p>
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
