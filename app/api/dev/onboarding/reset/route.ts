import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_TOGGLE_ENABLED, DEV_ROLE_COOKIE, DEV_ONBOARDING_COOKIE } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { OnboardingStep } from "@/lib/types";

/**
 * Dev-only: put the Dev Builder identity back at the top of the onboarding
 * wizard so the flow can be walked end to end without a real Google account.
 *
 * GET /api/dev/onboarding/reset            → restart at the identity step
 * GET /api/dev/onboarding/reset?step=client → jump straight to one step
 * GET /api/dev/onboarding/reset?off=1       → leave testing mode, back to /b
 *
 * GET (not POST) on purpose: the point is to paste it in the address bar. The
 * route 404s outside dev via DEV_TOGGLE_ENABLED, same guard as /api/dev/role.
 */

const DEV_BUILDER_ID = "00000000-0000-0000-0000-000000000002";
const STEPS: OnboardingStep[] = ["identity", "agency_type", "agency_size", "client", "charging"];
const COOKIE = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 } as const;

export async function GET(request: Request) {
  if (!DEV_TOGGLE_ENABLED) {
    return new Response(null, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const cookieStore = await cookies();
  const admin = createAdminClient();

  if (params.get("off") === "1") {
    await admin
      .from("profiles")
      .update({ onboarding_status: "completed", onboarding: {} })
      .eq("id", DEV_BUILDER_ID);
    cookieStore.delete(DEV_ONBOARDING_COOKIE);
    redirect("/b");
  }

  const requested = params.get("step");
  const step: OnboardingStep = STEPS.includes(requested as OnboardingStep)
    ? (requested as OnboardingStep)
    : "identity";

  // A bare { step } also drops engagement_id/project_id from a prior run, so the
  // client step starts from its empty state rather than resuming the old one.
  await admin
    .from("profiles")
    .update({
      display_name: "Dev Builder",
      onboarding_status: "in_progress",
      onboarding: { step },
    })
    .eq("id", DEV_BUILDER_ID);

  // Clear the answers but keep the row: the identity step's avatar upload needs
  // one to exist, the same reason completeOnboarding bootstraps it at signup.
  await admin.from("builder_profiles").upsert(
    {
      user_id: DEV_BUILDER_ID,
      agency_name: null,
      agency_role: null,
      agency_type: null,
      agency_size: null,
      pricing_model: null,
      default_hourly_rate: null,
      avatar_storage_path: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  cookieStore.set(DEV_ROLE_COOKIE, "builder", COOKIE);
  cookieStore.set(DEV_ONBOARDING_COOKIE, "1", COOKIE);

  redirect("/onboarding");
}
