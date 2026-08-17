import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { classifyTask } from "@/lib/ai/classify-task";
import { resolveAreaVocabulary } from "@/lib/tasks/area-vocabulary";
import { FALLBACK_AREA_VOCABULARY } from "@/lib/types";

interface ClassifyTaskInput {
  taskId: string;
  title: string;
  description: string | null;
  userId?: string | null;
  /** Scopes the area vocabulary to the engagement's repo. Absent on personal
      tasks, which resolve against the builder's selected repo instead. */
  engagementId?: string | null;
}

export async function classifyAndSaveTask(input: ClassifyTaskInput): Promise<void> {
  try {
    // A task with no known author can't be scoped to a repo — classify it
    // against the generic list rather than guessing whose vocabulary applies.
    const areas = input.userId
      ? await resolveAreaVocabulary({
          profileId: input.userId,
          engagementId: input.engagementId ?? null,
        })
      : FALLBACK_AREA_VOCABULARY;

    const { type, tags } = await classifyTask(
      {
        title: input.title,
        description: input.description,
        areas,
      },
      { userId: input.userId ?? null, operation: "classify_task" }
    );

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("tasks")
      .update({ type, tags })
      .eq("id", input.taskId);

    if (error) {
      console.error("[classifyAndSaveTask] update failed", {
        taskId: input.taskId,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("[classifyAndSaveTask] threw", {
      taskId: input.taskId,
      error: err instanceof Error ? err.message : err,
    });
  }
}
