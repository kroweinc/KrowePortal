"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Sign-in failed. Please try again.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [isPending, startTransition] = useTransition();

  const displayError = urlError
    ? (ERROR_MESSAGES[urlError] ?? "Something went wrong. Please try again.")
    : null;

  function handleGoogleSignIn() {
    startTransition(async () => {
      const supabase = createClient();
      const next = searchParams.get("next") ?? "/";
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
      {displayError && <p className="text-xs text-red-600">{displayError}</p>}
      <Button
        onClick={handleGoogleSignIn}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? "Redirecting…" : "Continue with Google"}
      </Button>
    </div>
  );
}
