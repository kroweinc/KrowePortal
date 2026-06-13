// Deterministic mapping from a signed quote's modules to engagement
// milestones + tasks. Pricing artifacts (extraCosts, designSystem,
// paymentMilestones) are deliberately excluded — they aren't work items.

import type { QuoteContent } from "@/lib/types";

export interface SeedMilestone {
  title: string;
  description: string | null;
  sort_order: number;
  source_amount: number | null;
  tasks: SeedTask[];
}

export interface SeedTask {
  title: string;
  description: string | null;
  builder_estimate_hours: number | null;
  sort_order: number;
}

export function seedFromQuoteContent(content: QuoteContent): SeedMilestone[] {
  const modules = content.modules ?? [];
  return modules.map((module, i) => {
    const title = module.title.trim() || `Milestone ${i + 1}`;
    const lineItems = module.lineItems ?? [];
    const tasks: SeedTask[] =
      lineItems.length > 0
        ? lineItems.map((item, j) => ({
            title: item.label.trim() || `Task ${j + 1}`,
            description: item.notes?.trim() || null,
            builder_estimate_hours: item.hours ?? null,
            sort_order: j,
          }))
        : [
            {
              title,
              description: module.description?.trim() || null,
              builder_estimate_hours: null,
              sort_order: 0,
            },
          ];
    return {
      title,
      description: module.purpose?.trim() || module.description?.trim() || null,
      sort_order: i,
      source_amount: typeof module.cost === "number" ? module.cost : null,
      tasks,
    };
  });
}

// Counts shown in the Begin-engagement dialog ("N modules, M tasks").
export function countSeedItems(content: QuoteContent): { milestones: number; tasks: number } {
  const milestones = seedFromQuoteContent(content);
  return {
    milestones: milestones.length,
    tasks: milestones.reduce((sum, m) => sum + m.tasks.length, 0),
  };
}
