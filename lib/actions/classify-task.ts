import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { classifyTask } from "@/lib/ai/classify-task";

interface ClassifyTaskInput {
  taskId: string;
  title: string;
  description: string | null;
  userId?: string | null;
}

export async function classifyAndSaveTask(input: ClassifyTaskInput): Promise<void> {
  try {
    const { type, tags } = await classifyTask(
      {
        title: input.title,
        description: input.description,
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
