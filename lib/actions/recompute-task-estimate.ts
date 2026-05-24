import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export async function recomputeTaskEstimate(taskId: string): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { data: rows, error: fetchError } = await supabase
      .from("task_subtasks")
      .select("ai_est_low_min, ai_est_high_min")
      .eq("task_id", taskId);

    if (fetchError) {
      console.error("[recomputeTaskEstimate] fetch failed", { taskId, error: fetchError.message });
      return;
    }

    const estimated = (rows ?? []).filter(
      (r) => r.ai_est_low_min != null && r.ai_est_high_min != null
    );

    if (estimated.length === 0) return;

    const lowHoursSum = estimated.reduce(
      (sum, r) => sum + (r.ai_est_low_min as number) / 60,
      0
    );
    const highHoursSum = estimated.reduce(
      (sum, r) => sum + (r.ai_est_high_min as number) / 60,
      0
    );

    const roundQuarter = (n: number) => Math.round(n * 4) / 4;
    const low = roundQuarter(lowHoursSum);
    const high = roundQuarter(highHoursSum);
    const midpoint = roundQuarter((lowHoursSum + highHoursSum) / 2);
    if (midpoint <= 0) return;

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        builder_estimate_hours: midpoint,
        builder_estimate_low_hours: low,
        builder_estimate_high_hours: high,
      })
      .eq("id", taskId);

    if (updateError) {
      console.error("[recomputeTaskEstimate] update failed", { taskId, error: updateError.message });
    }
  } catch (err) {
    console.error("[recomputeTaskEstimate] threw", { taskId, error: err instanceof Error ? err.message : err });
  }
}
