import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_TOGGLE_ENABLED, DEV_ROLE_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  if (!DEV_TOGGLE_ENABLED) {
    return new Response(null, { status: 404 });
  }

  const form = await request.formData();
  const next = form.get("role");
  const role = next === "builder" ? "builder" : "operator";

  const cookieStore = await cookies();
  cookieStore.set(DEV_ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/");
}
