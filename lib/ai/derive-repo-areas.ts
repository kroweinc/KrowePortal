import "server-only";

import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { RepoAreasResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  buildRepoAreasSystemPrompt,
  buildRepoAreasUserPrompt,
  type RepoAreasInput,
} from "./prompts";
import { normalizeAreas } from "./repo-areas-postprocess";
import type { AreaDefinition } from "@/lib/types";
import type { RepoContext } from "@/lib/github/types";

export type { RepoAreasInput };

// 12 areas × (slug + label + one-line gloss) is ~700 output tokens; the rest is
// headroom for the reasoning pass at the app-wide effort.
const MAX_TOKENS = 2_000;

/** RepoContext → the subset the derivation reads. Recent commits and the branch
 *  are deliberately left out: they describe what changed lately, and an area
 *  vocabulary has to describe the whole product. */
export function repoAreasInputFrom(ctx: RepoContext): RepoAreasInput {
  return {
    fullName: ctx.fullName,
    description: ctx.description,
    readmeExcerpt: ctx.readmeExcerpt,
    topLevelTree: ctx.topLevelTree,
    fileManifest: ctx.fileManifest,
    manifestTruncated: ctx.manifestTruncated,
    languages: ctx.languages,
  };
}

/**
 * Derive one repo's product areas. Returns [] when the model declines (a repo
 * too thin to name areas for) or when the guard rejects what came back — both
 * mean "fall back to TASK_TAGS", and neither is an error the caller should
 * surface. Throws only when the model returns nothing parseable twice.
 */
export async function deriveRepoAreas(
  input: RepoAreasInput,
  meta?: AiCallMeta
): Promise<AreaDefinition[]> {
  const systemPrompt = buildRepoAreasSystemPrompt();
  const userPrompt = buildRepoAreasUserPrompt(input);

  const callOnce = async (): Promise<string> => {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: MAX_TOKENS,
        response_format: jsonResponseFormat(RepoAreasResult, "repo_areas"),
        // One derivation per repo, cached for a day and never on a user's
        // critical path (resolveAreaVocabulary serves the fallback and derives
        // in the background), so this inherits the app-wide effort rather than
        // dropping to "none" — naming a product's parts from a file listing is
        // the kind of judgment the reasoning pass actually helps.
        prompt_cache_key: "repo-areas-v1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      meta
    );
    return response.choices[0]?.message?.content ?? "";
  };

  // Same defensive shape as classifyTask: "" or truncated content would make a
  // bare JSON.parse throw, and a malformed object fails safeParse. Resample once
  // before giving up — a stray first sample self-corrects.
  const tryParse = (rawText: string): AreaDefinition[] | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return null;
    }
    const result = RepoAreasResult.safeParse(stripNullsDeep(parsed));
    return result.success ? normalizeAreas(result.data.areas) : null;
  };

  const areas = tryParse(await callOnce()) ?? tryParse(await callOnce());
  if (areas === null) {
    throw new Error("Repo area derivation response did not match the expected shape.");
  }
  return areas;
}
