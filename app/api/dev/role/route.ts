import { cookies } from "next/headers";
import { ROLE_SWITCHER_ENABLED, DEV_ROLE_COOKIE } from "@/lib/auth-shared";

export async function POST(request: Request) {
  if (!ROLE_SWITCHER_ENABLED) {
    return new Response(null, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const role = body.role === "builder" ? "builder" : "operator";

  const cookieStore = await cookies();
  cookieStore.set(DEV_ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return Response.json({ ok: true });
}
