import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const publicOrigin = getPublicAppOrigin(origin);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/portal";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${publicOrigin}/login?error=auth_failed`
      );
    }
  }

  // Only allow relative paths to prevent open redirect
  const safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/portal";
  return NextResponse.redirect(`${publicOrigin}${safePath}`);
}
