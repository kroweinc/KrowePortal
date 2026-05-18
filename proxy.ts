import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PENDING_INVITE_COOKIE, resolveDevRole } from "@/lib/auth-shared";

function redirectWithCookies(url: URL, base: NextResponse): NextResponse {
  const res = NextResponse.redirect(url);
  base.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Stamp invite token into a cookie so it survives the OAuth round-trip.
  const joinMatch = pathname.match(/^\/join\/([a-f0-9]{64})$/);
  if (joinMatch) {
    const response = NextResponse.next();
    response.cookies.set(PENDING_INVITE_COOKIE, joinMatch[1], {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15,
    });
    return response;
  }

  // Public routes — skip auth and role checks
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/onboarding")
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — must not be removed per Supabase SSR docs
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithCookies(new URL("/login", request.url), supabaseResponse);
  }

  // Dev bypass: if dev_role cookie or DEV_AUTH_ROLE env is set, skip the DB query
  // so proxy and page always agree on onboarding state.
  const devRole = resolveDevRole((n) => request.cookies.get(n)?.value);
  const role = devRole ?? (await (async () => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    return profile?.role as string | undefined;
  })());

  if (!role) {
    // Never redirect /onboarding to itself — belt-and-suspenders against future allowlist edits
    if (pathname.startsWith("/onboarding")) return supabaseResponse;
    return redirectWithCookies(new URL("/onboarding", request.url), supabaseResponse);
  }

  if (pathname.startsWith("/b") && role !== "builder") {
    return redirectWithCookies(new URL("/o", request.url), supabaseResponse);
  }
  if (pathname.startsWith("/o") && role !== "operator") {
    return redirectWithCookies(new URL("/b", request.url), supabaseResponse);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
