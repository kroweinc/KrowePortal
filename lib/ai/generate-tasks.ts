import type { z } from "zod";
import { openai, runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { taskOnlyResult, type TaskOnlyResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { buildTaskSystemPrompt, buildTaskUserPrompt } from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import { FALLBACK_AREA_VOCABULARY, type AreaVocabulary } from "@/lib/types";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type OpenAI from "openai";

type ResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]
>;

interface GenerateInput {
  rawDescription: string;
  repoContext: RepoContext | null;
  toolContext?: RepoToolContext;
  // Q&A from prior "strengthen" rounds, woven into the user prompt so the
  // regenerated draft reflects the user's answers.
  clarifications?: { question: string; answer: string }[];
  /** The label set the draft's area is picked from — the engagement's repo
      areas, or the generic fallback. */
  areas?: AreaVocabulary;
}

async function callOpenAIOneShot(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  responseFormat: ResponseFormat,
  meta?: AiCallMeta
): Promise<string> {
  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: maxTokens,
    response_format: responseFormat,
    // Drafting one task is a lightweight structured generation — "none" drops the
    // reasoning pass for a snappier draft (verified quality parity vs "low" on
    // classification, assumptions, and follow-up), the single biggest latency
    // lever on this common no-repo path. The stable cache key lets the large
    // static system prefix be reused across regenerate/strengthen rounds and
    // concurrent builders instead of relying on prefix-hash luck.
    reasoning_effort: "none",
    prompt_cache_key: "task-draft-v1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, meta);
  return response.choices[0]?.message?.content ?? "";
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  responseFormat: ResponseFormat,
  toolContext: RepoToolContext | undefined,
  meta?: AiCallMeta
): Promise<string> {
  if (!toolContext) {
    return callOpenAIOneShot(systemPrompt, userPrompt, maxTokens, responseFormat, meta);
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // The GitHub tool loop only supports json_object (not json_schema), so the
  // repo-aware path keeps the lenient format and relies on safeParse downstream.
  const result = await runWithTools(openai, messages, toolContext, {
    model: AI_MODEL,
    maxTokens,
    responseFormat: { type: "json_object" },
    // The large repo-context system prefix is re-sent every tool round; a stable
    // key keeps it cached across rounds (and across regenerate/strengthen) so
    // each round's TTFT drops. Drafting a task never needs 30 file-reading rounds
    // — cap the loop so a pathological exploration can't stall the "+" flow.
    promptCacheKey: "task-draft-repo-v1",
    maxRounds: 12,
  });

  console.log("[generateTask] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    ...result.telemetry,
  });

  return result.content;
}

/**
 * Reshape a tool-loop draft that came back outside the schema. The repo research
 * already happened and is carried in the invalid response — only the JSON shape
 * is wrong — so one tool-free call under strict json_schema recovers it. This
 * replaces a second full tool loop, which re-read every file and re-sent a
 * message array that grows each round: the largest burst the "+" flow can emit,
 * and the one most likely to trip an OpenAI rate limit.
 */
async function repairTaskDraft(
  systemPrompt: string,
  userPrompt: string,
  invalid: string,
  // The SAME schema the failed attempt was aimed at — repairing against a
  // different vocabulary would "fix" the shape by rewriting a valid repo area
  // into a fallback tag.
  schema: z.ZodType,
  meta?: AiCallMeta
): Promise<string> {
  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: 1500,
    response_format: jsonResponseFormat(schema, "task_draft"),
    reasoning_effort: "none",
    prompt_cache_key: "task-draft-repair-v1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      {
        role: "user",
        content:
          `An earlier attempt produced this response, which did not match the required schema:\n\n${invalid}\n\n` +
          "Return that same task as valid JSON matching the schema exactly. Keep the findings from the repo " +
          "that attempt already read — do not re-research or change the substance of the task.",
      },
    ],
  }, meta);
  return response.choices[0]?.message?.content ?? "";
}

export async function generateTask(input: GenerateInput, meta?: AiCallMeta): Promise<TaskOnlyResult> {
  const { rawDescription, repoContext, toolContext, clarifications } = input;
  const areas = input.areas ?? FALLBACK_AREA_VOCABULARY;
  const schema = taskOnlyResult(areas.values.map((a) => a.slug));
  // Strict json_schema on the one-shot path; the tool loop can't carry
  // json_schema, so it stays lenient json_object and relies on safeParse.
  const responseFormat: ResponseFormat = toolContext
    ? { type: "json_object" }
    : jsonResponseFormat(schema, "task_draft");
  const systemPrompt = buildTaskSystemPrompt(repoContext, areas);
  const userPrompt = buildTaskUserPrompt(rawDescription, clarifications);

  const callOnce = () => callOpenAI(systemPrompt, userPrompt, 1500, responseFormat, toolContext, meta);

  // Non-throwing parse: null on a non-JSON or schema-invalid response. safeParse
  // still enforces refinements and catches a truncated response even when strict
  // mode guarantees the top-level shape.
  const tryParse = (raw: string): TaskOnlyResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = schema.safeParse(stripNullsDeep(parsed));
    return result.success ? (result.data as TaskOnlyResult) : null;
  };

  // The lenient tool-loop path occasionally drifts outside the schema on the
  // first sample. Repair the shape in a single strict-schema call rather than
  // replaying the tool loop — the research is already in `raw`, so re-running it
  // only doubled the request burst. The strict one-shot draft is structurally
  // constrained, so it skips the repair.
  const raw = await callOnce();
  let result = tryParse(raw);
  if (!result && toolContext) {
    console.warn("[generateTask] draft missed the schema — repairing shape in one call");
    result = tryParse(await repairTaskDraft(systemPrompt, userPrompt, raw, schema, meta));
  }
  if (result) return result;

  // Persistent failure: surface a clear error (the caller degrades).
  throw new Error("AI response validation failed");
}
