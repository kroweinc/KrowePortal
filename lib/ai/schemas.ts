import { z } from "zod";

const Question = z.object({
  id: z.string(),
  text: z.string().min(3).max(300),
  hint: z.string().max(200).optional(),
});

const SubtaskDraft = z.object({
  title: z.string().min(3).max(200),
  rationale: z.string().max(300).optional(),
});

export const GenerationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(2).max(4) }),
  z.object({ kind: z.literal("subtasks"), items: z.array(SubtaskDraft).min(3).max(8) }),
]);

export type GenerationResult = z.infer<typeof GenerationResult>;
export type Question = z.infer<typeof Question>;
export type SubtaskDraft = z.infer<typeof SubtaskDraft>;
