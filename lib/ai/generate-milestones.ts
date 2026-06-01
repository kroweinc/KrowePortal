import { openai, AI_MODEL } from "./client";
import type { BriefContent } from "@/lib/types";

// A milestone ready to be inserted at sign time, with the task titles
// that hang under it.
export interface GeneratedMilestone {
  title: string;
  description: string | null;
  amount: number;
  tasks: string[];
}

interface FlatItem {
  label: string;
  amount: number;
}

function collectItems(content: BriefContent): FlatItem[] {
  const items: FlatItem[] = [];
  for (const li of content.preWork ?? []) {
    if (li.label?.trim()) items.push({ label: li.label.trim(), amount: li.amount || 0 });
  }
  for (const li of content.projectLineItems ?? []) {
    if (li.label?.trim()) items.push({ label: li.label.trim(), amount: li.amount || 0 });
  }
  return items;
}

// Deterministic fallback: one milestone holding every line item as a task.
function fallback(items: FlatItem[], content: BriefContent): GeneratedMilestone[] {
  if (items.length === 0) {
    const tasks = (content.deliverables ?? [])
      .map((d) => d.title?.trim())
      .filter((t): t is string => !!t);
    return [
      {
        title: "Engagement kickoff",
        description: "Initial scope for the signed engagement.",
        amount: content.totals?.grand ?? 0,
        tasks: tasks.length > 0 ? tasks : ["Kickoff & scope confirmation"],
      },
    ];
  }
  return [
    {
      title: "Build",
      description: "All scoped work from the signed quote.",
      amount: items.reduce((s, it) => s + it.amount, 0),
      tasks: items.map((it) => it.label),
    },
  ];
}

const SYSTEM_PROMPT = `You group a software project's quoted line items into 3–6 logical milestones a client can track.

You receive a numbered list of line items (each with an index and a dollar amount). Cluster them into milestones that represent meaningful, sequential phases of delivery (e.g. "Foundation & setup", "Core build", "Integrations", "Launch & handoff"). Every line item index must appear in exactly one milestone. Do not invent line items.

Output ONLY valid JSON in this exact shape:

{
  "milestones": [
    { "title": "Short milestone name", "description": "One sentence on what completing it means.", "itemIndexes": [0, 1] }
  ]
}

Rules:
- 3–6 milestones. Fewer if there are very few line items.
- Order milestones in the sequence they'd realistically be delivered.
- itemIndexes must reference the provided indexes; cover ALL of them, no duplicates.`;

export async function groupQuoteIntoMilestones(content: BriefContent): Promise<GeneratedMilestone[]> {
  const items = collectItems(content);
  if (items.length <= 1) return fallback(items, content);

  let parsed: { milestones?: { title?: string; description?: string; itemIndexes?: number[] }[] } = {};
  try {
    const userPrompt = [
      "Line items to group:",
      ...items.map((it, i) => `${i}: ${it.label} — $${it.amount}`),
    ].join("\n");

    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  } catch (err) {
    console.error("[groupQuoteIntoMilestones] AI call failed", err);
    return fallback(items, content);
  }

  const raw = Array.isArray(parsed.milestones) ? parsed.milestones : [];
  const used = new Set<number>();
  const milestones: GeneratedMilestone[] = [];

  for (const m of raw) {
    const idxs = Array.isArray(m.itemIndexes)
      ? m.itemIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < items.length && !used.has(i))
      : [];
    if (idxs.length === 0) continue;
    idxs.forEach((i) => used.add(i));
    milestones.push({
      title: (m.title || "Milestone").trim(),
      description: m.description?.trim() || null,
      amount: idxs.reduce((s, i) => s + items[i].amount, 0),
      tasks: idxs.map((i) => items[i].label),
    });
  }

  // Any line items the AI dropped get appended to a final catch-all milestone.
  const leftover = items.map((_, i) => i).filter((i) => !used.has(i));
  if (leftover.length > 0) {
    milestones.push({
      title: milestones.length === 0 ? "Build" : "Remaining work",
      description: null,
      amount: leftover.reduce((s, i) => s + items[i].amount, 0),
      tasks: leftover.map((i) => items[i].label),
    });
  }

  return milestones.length > 0 ? milestones : fallback(items, content);
}
