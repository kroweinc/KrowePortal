import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { homePath } from "@/lib/home-path";
import { getPublicAppOrigin } from "@/lib/app-origin";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const publicOrigin = getPublicAppOrigin(origin);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/portal";

  // Tracks whether this request actually established a session, so we can route
  // straight to the user's home instead of bouncing through the /portal router.
  let authed = false;

  if (code) {
    // PKCE / OAuth code exchange (Google sign-in, password recovery via ?code).
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${publicOrigin}/login?error=auth_failed`);
    }
    authed = true;
  } else if (tokenHash && type) {
    // Email-link confirmations (email change, magic link, recovery, signup)
    // arrive as token_hash + type and must be verified with verifyOtp — this is
    // what completes an in-app email change (type=email_change).
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      return NextResponse.redirect(`${publicOrigin}/login?error=auth_failed`);
    }
    authed = true;
  }

  // Only allow relative paths to prevent open redirect
  let safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/portal";

  // Fast path: when we just signed the user in and they're headed to the default
  // /portal, resolve their real home here (/b, /o, or /onboarding) so the browser
  // skips the extra /portal → / → role redirect hop. Any explicit `next` (e.g. a
  // doc-acceptance deep link) is honored untouched.
  if (authed && safePath === "/portal") {
    const profile = await getCurrentProfile();
    safePath = homePath(profile, true);
  }

  return NextResponse.redirect(`${publicOrigin}${safePath}`);
}
