import { z } from "zod";

const Question = z.object({
  id: z.string(),
  text: z.string().min(3).max(300),
  options: z.array(z.string().min(1).max(80)).min(3).max(5),
});

export const SubtaskDraft = z
  .object({
    title: z.string().min(3).max(200),
    rationale: z.string().max(300).optional(),
    estLowMin: z.number().int().min(5).max(2400),
    estHighMin: z.number().int().min(5).max(2400),
  })
  .refine((d) => d.estHighMin >= d.estLowMin, {
    message: "estHighMin must be >= estLowMin",
    path: ["estHighMin"],
  });

export const GenerationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(2).max(4) }),
  z.object({ kind: z.literal("subtasks"), items: z.array(SubtaskDraft).min(3).max(8) }),
]);

export const SubtasksOnlyResult = z.object({
  kind: z.literal("subtasks"),
  items: z.array(SubtaskDraft).min(3).max(8),
});

export const TaskDraft = z.object({
  title: z.string().min(3).max(300),
  description: z.string().min(20).max(2000),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  subtasks: z.array(SubtaskDraft).max(8).default([]),
});

export const TaskGenerationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(2).max(4) }),
  z.object({ kind: z.literal("task"), item: TaskDraft }),
]);

export const TaskOnlyResult = z.object({
  kind: z.literal("task"),
  item: TaskDraft,
});

export const TaskEstimateResult = z
  .object({
    hoursLow: z.number().min(0.25).max(2000),
    hoursHigh: z.number().min(0.25).max(2000),
  })
  .refine((d) => d.hoursHigh >= d.hoursLow, {
    message: "hoursHigh must be >= hoursLow",
    path: ["hoursHigh"],
  });

export const SimplifiedSubtask = z.object({
  id: z.string(),
  simpleTitle: z.string().min(1).max(300),
});

export const SimplifiedTask = z.object({
  id: z.string(),
  simpleTitle: z.string().min(1).max(300),
  simpleDescription: z.string().max(2000).nullable(),
  simpleSubtasks: z.array(SimplifiedSubtask).default([]),
});

export const SimplifyTasksResult = z.object({
  items: z.array(SimplifiedTask),
});

export type GenerationResult = z.infer<typeof GenerationResult>;
export type SubtasksOnlyResult = z.infer<typeof SubtasksOnlyResult>;
export type Question = z.infer<typeof Question>;
export type SubtaskDraft = z.infer<typeof SubtaskDraft>;
export type TaskDraft = z.infer<typeof TaskDraft>;
export type TaskGenerationResult = z.infer<typeof TaskGenerationResult>;
export type TaskOnlyResult = z.infer<typeof TaskOnlyResult>;
export type TaskEstimateResult = z.infer<typeof TaskEstimateResult>;
export type SimplifiedSubtask = z.infer<typeof SimplifiedSubtask>;
export type SimplifiedTask = z.infer<typeof SimplifiedTask>;
export type SimplifyTasksResult = z.infer<typeof SimplifyTasksResult>;
