import type { SubtaskPlanItem } from "@/lib/ai/schemas";

/**
 * Deterministic reconciliation of an AI subtask plan against the task's current
 * subtasks — the safety layer that lets "regenerate this task" rewrite the
 * checklist without destroying work in progress.
 *
 * Pure functions — no "server-only", no env, no network — so the guarantees are
 * unit-testable without an OpenAI call (tests/reconcile-subtask-plan.test.ts),
 * and the module is safe to import from both the server action and the client
 * preview component.
 *
 * The plan references existing subtasks by short labels (S1, S2, …) assigned in
 * position order — the SAME order the prompt shows them (lib/ai/prompts.ts).
 * A referenced label is kept (or renamed); an unreferenced existing subtask is
 * removed — UNLESS it is completed or has logged hours, in which case it is
 * PRESERVED (never deleted) and tacked onto the end, so no finished work or
 * time-tracked effort silently vanishes on a regenerate.
 */

export interface CurrentSubtask {
  id: string;
  title: string;
  completed: boolean;
  /** Hours logged against this subtask; protected from deletion like completed ones. */
  actualHours?: number | null;
}

export type ReconciledSubtask =
  | { op: "keep"; id: string; title: string; completed: boolean }
  | { op: "rename"; id: string; title: string; from: string; completed: boolean }
  | { op: "add"; title: string }
  | {
      op: "preserved";
      id: string;
      title: string;
      completed: boolean;
      reason: "completed" | "logged";
    };

export interface SubtaskReconciliation {
  /** The final ordered subtask list; positions are the array index on apply. */
  final: ReconciledSubtask[];
  /** Existing subtasks to delete — never a completed / hour-logged one. */
  remove: { id: string; title: string }[];
}

/** Position-order label for an existing subtask ("S1", "S2", …). */
export function subtaskLabel(index: number): string {
  return `S${index + 1}`;
}

function isProtected(s: CurrentSubtask): boolean {
  return s.completed || (s.actualHours != null && s.actualHours > 0);
}

export function reconcileSubtaskPlan(
  current: CurrentSubtask[],
  plan: SubtaskPlanItem[]
): SubtaskReconciliation {
  const byLabel = new Map<string, CurrentSubtask>();
  current.forEach((s, i) => byLabel.set(subtaskLabel(i), s));

  const consumed = new Set<string>(); // existing ids already placed
  const final: ReconciledSubtask[] = [];

  for (const item of plan) {
    const title = item.title.trim();
    if (!title) continue;
    const ref = item.ref?.trim();
    const existing = ref ? byLabel.get(ref) : undefined;
    if (existing && !consumed.has(existing.id)) {
      consumed.add(existing.id);
      if (existing.title === title) {
        final.push({ op: "keep", id: existing.id, title: existing.title, completed: existing.completed });
      } else {
        final.push({
          op: "rename",
          id: existing.id,
          title,
          from: existing.title,
          completed: existing.completed,
        });
      }
    } else {
      // null/absent ref, an unknown label, or a label already consumed → treat
      // as a brand-new subtask (its title is all we can trust).
      final.push({ op: "add", title });
    }
  }

  const remove: { id: string; title: string }[] = [];
  for (const s of current) {
    if (consumed.has(s.id)) continue;
    if (isProtected(s)) {
      final.push({
        op: "preserved",
        id: s.id,
        title: s.title,
        completed: s.completed,
        reason: s.completed ? "completed" : "logged",
      });
    } else {
      remove.push({ id: s.id, title: s.title });
    }
  }

  return { final, remove };
}
