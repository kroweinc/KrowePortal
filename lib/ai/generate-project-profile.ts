import { openai, AI_MODEL } from "./client";
import { ProjectProfileResult } from "./schemas";
import {
  buildProjectProfileSystemPrompt,
  buildProjectProfileUserPrompt,
} from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import { runWithTools, type RepoToolContext, type ToolLoopTelemetry } from "@/lib/github/ai-tools";
import { discoverIntegrationSignals, type IntegrationSignals } from "@/lib/github/integration-signals";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type ProjectProfile = ReturnType<typeof ProjectProfileResult.parse>;

export type GenerateProjectProfileResult = {
  profile: ProjectProfile;
  telemetry: ToolLoopTelemetry;
  signals: IntegrationSignals;
  model: string;
};

const MAX_ROUNDS = 25;

export async function generateProjectProfile(
  ctx: RepoContext,
  toolContext: RepoToolContext
): Promise<GenerateProjectProfileResult> {
  const signals = await discoverIntegrationSignals(ctx, toolContext);
  console.log("[generateProjectProfile] integration signals", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    envVars: signals.envVars.map((e) => e.name),
    hostnames: signals.hostnames.map((h) => h.host),
    filesRead: signals.filesRead,
    searchesRun: signals.searchesRun,
    searchErrors: signals.searchErrors,
  });

  const systemPrompt = buildProjectProfileSystemPrompt();
  const userPrompt = buildProjectProfileUserPrompt(ctx, signals);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const result = await runWithTools(openai, messages, toolContext, {
    model: AI_MODEL,
    maxTokens: 900,
    responseFormat: { type: "json_object" },
    maxRounds: MAX_ROUNDS,
  });

  console.log("[generateProjectProfile] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    ...result.telemetry,
  });

  const parsed = JSON.parse(result.content);
  const profile = ProjectProfileResult.parse(parsed);
  return { profile, telemetry: result.telemetry, signals, model: AI_MODEL };
}
