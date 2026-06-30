"use server";

import { getCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { generateTask } from "@/lib/ai/generate-tasks";
import { assertAiBudget } from "@/lib/ai/usage";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import type { TaskGenerationResult } from "@/lib/ai/schemas";

const generateSchema = z.object({
  rawDescription: z.string().trim().min(5).max(5000),
  engagementId: z.string().uuid().optional(),
  answers: z
    .array(z.object({ questionId: z.string(), answer: z.string() }))
    .optional(),
});

export async function generateTaskDraft(input: {
  rawDescription: string;
  engagementId?: string;
  answers?: { questionId: string; answer: string }[];
}): Promise<TaskGenerationResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "Please provide at least a few words describing what you want." };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const { repoContext, toolContext, source } = await resolveRepoForGeneration({
    profileId: profile.id,
    engagementId: parsed.data.engagementId,
    logPrefix: "[generateTaskDraft]",
  });

  console.log("[generateTaskDraft] mode:", toolContext ? `tool-loop (${source})` : "one-shot");

  try {
    const result = await generateTask({
      rawDescription: parsed.data.rawDescription,
      repoContext,
      answers: parsed.data.answers,
      toolContext,
    }, { userId: profile.id, operation: "generate_tasks" });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { error: msg };
  }
}
