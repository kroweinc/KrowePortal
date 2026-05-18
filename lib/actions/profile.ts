"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const onboardingSchema = z.object({
  display_name: z.string().min(1).max(80),
  role: z.enum(["operator", "builder"]),
});

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const parsed = onboardingSchema.safeParse({
    display_name: formData.get("display_name"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    display_name: parsed.data.display_name,
    role: parsed.data.role,
  });

  if (error) return { error: error.message };

  redirect(parsed.data.role === "operator" ? "/o" : "/b");
}
