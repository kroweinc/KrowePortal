import { describe, expect, it } from "vitest";
import {
  reconcileSubtaskPlan,
  subtaskLabel,
  type CurrentSubtask,
} from "@/lib/tasks/reconcile-subtask-plan";
import type { SubtaskPlanItem } from "@/lib/ai/schemas";

function sub(id: string, title: string, extra?: Partial<CurrentSubtask>): CurrentSubtask {
  return { id, title, completed: false, actualHours: null, ...extra };
}

describe("reconcileSubtaskPlan", () => {
  it("keeps an existing subtask referenced with its exact title", () => {
    const current = [sub("a", "Build screen A")];
    const plan: SubtaskPlanItem[] = [{ ref: "S1", title: "Build screen A" }];
    const { final, remove } = reconcileSubtaskPlan(current, plan);
    expect(remove).toHaveLength(0);
    expect(final).toEqual([{ op: "keep", id: "a", title: "Build screen A", completed: false }]);
  });

  it("renames an existing subtask referenced with a new title", () => {
    const current = [sub("a", "Build screen A")];
    const plan: SubtaskPlanItem[] = [{ ref: "S1", title: "Build the revised screen A" }];
    const { final } = reconcileSubtaskPlan(current, plan);
    expect(final[0]).toEqual({
      op: "rename",
      id: "a",
      title: "Build the revised screen A",
      from: "Build screen A",
      completed: false,
    });
  });

  it("adds a new subtask when ref is null", () => {
    const { final } = reconcileSubtaskPlan([], [{ ref: null, title: "Brand new step" }]);
    expect(final).toEqual([{ op: "add", title: "Brand new step" }]);
  });

  it("treats an absent ref (undefined) as a new subtask", () => {
    const { final } = reconcileSubtaskPlan([], [{ title: "New step" } as SubtaskPlanItem]);
    expect(final).toEqual([{ op: "add", title: "New step" }]);
  });

  it("removes an existing subtask the plan omits", () => {
    const current = [sub("a", "Screen A"), sub("b", "Screen B")];
    const plan: SubtaskPlanItem[] = [{ ref: "S1", title: "Screen A" }];
    const { final, remove } = reconcileSubtaskPlan(current, plan);
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ op: "keep", id: "a" });
    expect(remove).toEqual([{ id: "b", title: "Screen B" }]);
  });

  it("PRESERVES a completed subtask the plan drops instead of deleting it", () => {
    const current = [
      sub("a", "Screen A"),
      sub("b", "Screen B", { completed: true }),
    ];
    const plan: SubtaskPlanItem[] = [{ ref: "S1", title: "Screen A" }];
    const { final, remove } = reconcileSubtaskPlan(current, plan);
    // The completed one is never removed…
    expect(remove).toEqual([]);
    // …it's appended at the end as preserved.
    expect(final).toEqual([
      { op: "keep", id: "a", title: "Screen A", completed: false },
      { op: "preserved", id: "b", title: "Screen B", completed: true, reason: "completed" },
    ]);
  });

  it("preserves an hour-logged subtask (not completed) the plan drops", () => {
    const current = [sub("a", "Screen A"), sub("b", "Screen B", { actualHours: 1.5 })];
    const { final, remove } = reconcileSubtaskPlan(current, [{ ref: "S1", title: "Screen A" }]);
    expect(remove).toEqual([]);
    expect(final[1]).toEqual({
      op: "preserved",
      id: "b",
      title: "Screen B",
      completed: false,
      reason: "logged",
    });
  });

  it("honors the plan's order across kept + added subtasks", () => {
    const current = [sub("a", "First"), sub("b", "Second")];
    const plan: SubtaskPlanItem[] = [
      { ref: null, title: "New first" },
      { ref: "S2", title: "Second" },
      { ref: "S1", title: "First" },
    ];
    const { final } = reconcileSubtaskPlan(current, plan);
    expect(final.map((f) => f.title)).toEqual(["New first", "Second", "First"]);
  });

  it("treats an unknown label as a new subtask", () => {
    const current = [sub("a", "Only one")];
    const { final } = reconcileSubtaskPlan(current, [{ ref: "S9", title: "Ghost ref" }]);
    expect(final[0]).toEqual({ op: "add", title: "Ghost ref" });
    // The real existing one wasn't referenced, so it's removed.
  });

  it("treats a second reference to the same label as a new subtask", () => {
    const current = [sub("a", "Original")];
    const plan: SubtaskPlanItem[] = [
      { ref: "S1", title: "Original" },
      { ref: "S1", title: "Dup ref" },
    ];
    const { final } = reconcileSubtaskPlan(current, plan);
    expect(final[0]).toMatchObject({ op: "keep", id: "a" });
    expect(final[1]).toEqual({ op: "add", title: "Dup ref" });
  });

  it("drops blank-title plan items", () => {
    const { final } = reconcileSubtaskPlan([], [{ ref: null, title: "   " }]);
    expect(final).toEqual([]);
  });

  it("returns empty for no current subtasks and no plan", () => {
    expect(reconcileSubtaskPlan([], [])).toEqual({ final: [], remove: [] });
  });

  it("labels existing subtasks in position order", () => {
    expect(subtaskLabel(0)).toBe("S1");
    expect(subtaskLabel(4)).toBe("S5");
  });
});
