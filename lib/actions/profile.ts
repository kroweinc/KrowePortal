"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PENDING_INVITE_COOKIE } from "@/lib/auth-shared";
import { validatePendingInvite } from "@/lib/invitations";

const onboardingSchema = z.object({
  display_name: z.string().min(1).max(80),
});

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Defense-in-depth: if there's a valid pending invite cookie the user should
  // go to /join/<token>, not become a builder.
  const cookieStore = await cookies();
  const inviteToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
  const validToken = await validatePendingInvite(inviteToken);
  if (validToken) {
    return { error: "You have a pending invitation. Please accept it to continue." };
  }

  const parsed = onboardingSchema.safeParse({
    display_name: formData.get("display_name"),
  });

  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    display_name: parsed.data.display_name,
    role: "builder",
  });

  if (error) return { error: error.message };

  redirect("/b");
}
