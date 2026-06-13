import type { SupabaseClient } from "@supabase/supabase-js";
import { seedFromQuoteContent } from "@/lib/project/seed-from-quote";
import type { QuoteContent } from "@/lib/types";

/**
 * Seeds an engagement's milestones + tasks from a signed quote's content.
 * Pure DB orchestration over an admin client so it can be reused by both the
 * builder-initiated `beginEngagement` flow and the operator-initiated
 * doc-acceptance flow. Identity/ownership must be verified by the caller.
 */
export async function seedEngagementTasksFromQuote(
  admin: SupabaseClient,
  engagementId: string,
  quote: { id: string; content: QuoteContent | null },
  createdBy: string
): Promise<{ milestones: number; tasks: number }> {
  const milestones = seedFromQuoteContent((quote.content ?? {}) as QuoteContent);
  let seededMilestones = 0;
  let seededTasks = 0;

  for (const m of milestones) {
    const { data: milestone, error: mErr } = await admin
      .from("milestones")
      .insert({
        brief_id: null,
        quote_id: quote.id,
        engagement_id: engagementId,
        title: m.title,
        description: m.description,
        sort_order: m.sort_order,
        source_amount: m.source_amount,
      })
      .select("id")
      .single();
    if (mErr || !milestone) continue;
    seededMilestones += 1;

    const { error: tErr } = await admin.from("tasks").insert(
      m.tasks.map((t) => ({
        engagement_id: engagementId,
        milestone_id: milestone.id,
        title: t.title,
        description: t.description,
        builder_estimate_hours: t.builder_estimate_hours,
        source: "builder_added",
        status: "inbox",
        created_by: createdBy,
        sort_order: t.sort_order,
      }))
    );
    if (!tErr) seededTasks += m.tasks.length;
  }

  return { milestones: seededMilestones, tasks: seededTasks };
}

/**
 * Idempotent variant for the acceptance path: seeds the engagement from the
 * newest signed/accepted quote on the project, but only if the engagement has
 * no milestones yet (so it never double-seeds when the builder already began
 * the engagement).
 */
export async function seedEngagementIfEmpty(
  admin: SupabaseClient,
  engagementId: string,
  projectId: string,
  createdBy: string
): Promise<{ milestones: number; tasks: number }> {
  const { data: existing } = await admin
    .from("milestones")
    .select("id")
    .eq("engagement_id", engagementId)
    .limit(1);
  if ((existing?.length ?? 0) > 0) return { milestones: 0, tasks: 0 };

  const { data: quote } = await admin
    .from("quotes")
    .select("id, content")
    .eq("project_id", projectId)
    .in("status", ["signed", "accepted"])
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!quote) return { milestones: 0, tasks: 0 };

  return seedEngagementTasksFromQuote(
    admin,
    engagementId,
    quote as { id: string; content: QuoteContent | null },
    createdBy
  );
}
