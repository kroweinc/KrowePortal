"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { simplifyTasks } from "@/lib/ai/simplify-tasks";
import { friendlyAiError } from "@/lib/ai/client";
import type { SimplifyTasksResult } from "@/lib/ai/schemas";

const inputSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(500),
        description: z.string().max(5000).nullable(),
        subtasks: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().min(1).max(500),
            })
          )
          .max(40)
          .default([]),
      })
    )
    .min(1)
    .max(50),
});

export async function simplifyOperatorTasks(input: {
  tasks: {
    id: string;
    title: string;
    description: string | null;
    subtasks: { id: string; title: string }[];
  }[];
}): Promise<SimplifyTasksResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") {
    return { error: "Only operators can simplify tasks." };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  try {
    const result = await simplifyTasks({ tasks: parsed.data.tasks });
    return result;
  } catch (err) {
    return { error: friendlyAiError(err) };
  }
}
