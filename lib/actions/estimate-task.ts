import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { estimateTask } from "@/lib/ai/estimate-task";

interface EstimateTaskInput {
  taskId: string;
  title: string;
  description: string | null;
  priority: string;
}

export async function estimateAndSaveTaskHours(input: EstimateTaskInput): Promise<void> {
  try {
    const { hoursLow, hoursHigh } = await estimateTask({
      title: input.title,
      description: input.description,
      priority: input.priority,
    });

    const roundQuarter = (n: number) => Math.round(n * 4) / 4;
    const low = roundQuarter(hoursLow);
    const high = roundQuarter(hoursHigh);
    const midpoint = roundQuarter((hoursLow + hoursHigh) / 2);
    if (midpoint <= 0) return;

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        builder_estimate_hours: midpoint,
        builder_estimate_low_hours: low,
        builder_estimate_high_hours: high,
      })
      .eq("id", input.taskId);

    if (error) {
      console.error("[estimateAndSaveTaskHours] update failed", {
        taskId: input.taskId,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("[estimateAndSaveTaskHours] threw", {
      taskId: input.taskId,
      error: err instanceof Error ? err.message : err,
    });
  }
}
