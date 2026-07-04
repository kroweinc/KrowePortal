"use server";

import { getCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { generateTask } from "@/lib/ai/generate-tasks";
import { friendlyAiError } from "@/lib/ai/client";
import { assertAiBudget } from "@/lib/ai/usage";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import type { TaskOnlyResult } from "@/lib/ai/schemas";

const generateSchema = z.object({
  rawDescription: z.string().trim().min(5).max(5000),
  engagementId: z.string().uuid().optional(),
  // Q&A from the draft form's "strengthen" rounds. Capped at 5 — the UI hides
  // the affordance at the same limit, so hitting the cap here means a bad actor.
  clarifications: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answer: z.string().trim().min(1).max(1000),
      })
    )
    .max(5)
    .optional(),
});

export async function generateTaskDraft(input: {
  rawDescription: string;
  engagementId?: string;
  clarifications?: { question: string; answer: string }[];
}): Promise<TaskOnlyResult | { error: string }> {
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
      toolContext,
      clarifications: parsed.data.clarifications,
    }, { userId: profile.id, operation: "generate_tasks" });
    return result;
  } catch (err) {
    return { error: friendlyAiError(err) };
  }
}
