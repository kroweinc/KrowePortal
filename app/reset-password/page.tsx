import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/app/login/portal-preview";
import { ResetPasswordForm } from "./reset-password-form";

// Reached via the password-reset email link, which routes through
// /auth/callback first to exchange the recovery code for a session. If that
// session is present, the user can set a new password; otherwise the link is
// stale and we send them back to request a fresh one.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>

        {user ? (
          <ResetPasswordForm />
        ) : (
          <div className="text-center">
            <h1
              className="text-[clamp(1.6rem,4vw,1.85rem)] font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-serif)", color: "var(--foreground)" }}
            >
              Link expired
            </h1>
            <p className="mb-7 mt-2 text-[0.95rem]" style={{ color: "var(--muted-foreground)" }}>
              This password reset link is invalid or has expired. Request a new one from the sign-in
              page.
            </p>
            <Link
              href="/login"
              className="font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
            >
              ← Back to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
