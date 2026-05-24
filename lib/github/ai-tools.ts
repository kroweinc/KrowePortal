import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { listDirectoryContents, readFileContent, searchCode } from "./file-content";
import { GitHubError, RateLimitError } from "./types";

export type RepoToolContext = {
  token: string;
  owner: string;
  repo: string;
  ref: string;
};

export const REPO_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List the contents of a directory in the linked repo. Returns files and subdirectories with their type and size. Use the empty string for the repo root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Path relative to repo root. Use "" for root. No leading slash. Examples: "", "lib", "lib/github", "components/ui".',
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a text file in the linked repo. Returns the file contents (truncated at 50KB if larger). Refuses binary files. Use this to inspect implementation details, configs, schemas, etc.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Path relative to repo root. No leading slash. Example: "lib/ai/schemas.ts".',
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search the linked repo for code matching a query (GitHub Code Search syntax). Returns up to 10 path+snippet matches. Useful when you don't know which file to read.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'Search query. Examples: "useState", "function generateTask", "TODO".',
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: RepoToolContext
): Promise<ToolResult> {
  try {
    if (name === "list_directory") {
      const path = typeof args.path === "string" ? args.path : "";
      const entries = await listDirectoryContents(ctx.token, ctx.owner, ctx.repo, ctx.ref, path);
      return { ok: true, data: { path, entries } };
    }
    if (name === "read_file") {
      const path = typeof args.path === "string" ? args.path : "";
      if (!path) return { ok: false, error: "Missing required argument: path" };
      const result = await readFileContent(ctx.token, ctx.owner, ctx.repo, ctx.ref, path);
      if (!result.ok) return { ok: false, error: result.reason };
      return {
        ok: true,
        data: {
          path,
          size: result.size,
          truncated: result.truncated,
          content: result.content,
        },
      };
    }
    if (name === "search_code") {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return { ok: false, error: "Missing required argument: query" };
      const result = await searchCode(ctx.token, ctx.owner, ctx.repo, query);
      return { ok: true, data: { query, ...result } };
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { ok: false, error: "GitHub rate limit exceeded. Stop calling tools and produce your final answer with the context you have." };
    }
    if (err instanceof GitHubError) {
      return { ok: false, error: `GitHub error (${err.status}): ${err.message}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function formatToolResult(result: ToolResult): string {
  if (result.ok) return JSON.stringify(result.data);
  return JSON.stringify({ error: result.error });
}

export type ToolLoopTelemetry = {
  rounds: number;
  toolCalls: number;
  filesRead: number;
  totalBytes: number;
  hitMaxRounds: boolean;
};

export type ToolLoopOptions = {
  model: string;
  maxTokens?: number;
  responseFormat?: { type: "json_object" } | { type: "text" };
  maxRounds?: number;
};

export type ToolLoopResult = {
  content: string;
  telemetry: ToolLoopTelemetry;
};

export async function runWithTools(
  client: OpenAI,
  initialMessages: ChatCompletionMessageParam[],
  ctx: RepoToolContext,
  opts: ToolLoopOptions
): Promise<ToolLoopResult> {
  const maxRounds = opts.maxRounds ?? 30;
  const messages: ChatCompletionMessageParam[] = [...initialMessages];

  const telemetry: ToolLoopTelemetry = {
    rounds: 0,
    toolCalls: 0,
    filesRead: 0,
    totalBytes: 0,
    hitMaxRounds: false,
  };

  for (let round = 0; round < maxRounds; round++) {
    telemetry.rounds = round + 1;

    const response = await client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1500,
      response_format: opts.responseFormat,
      tools: REPO_TOOLS,
      tool_choice: "auto",
      messages,
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("OpenAI returned no message");
    }

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return { content: message.content ?? "", telemetry };
    }

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (call.type !== "function") {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: `Unsupported tool call type: ${call.type}` }),
        });
        continue;
      }

      telemetry.toolCalls += 1;

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "Could not parse tool arguments as JSON" }),
        });
        continue;
      }

      const result = await dispatchTool(call.function.name, parsedArgs, ctx);

      if (
        call.function.name === "read_file" &&
        result.ok &&
        typeof result.data === "object" &&
        result.data !== null
      ) {
        const data = result.data as { size?: number };
        telemetry.filesRead += 1;
        telemetry.totalBytes += typeof data.size === "number" ? data.size : 0;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: formatToolResult(result),
      });
    }
  }

  telemetry.hitMaxRounds = true;

  messages.push({
    role: "user",
    content:
      "You have reached the maximum number of tool-call rounds. Stop calling tools and respond NOW with your final JSON answer based on what you have already learned.",
  });

  const finalResponse = await client.chat.completions.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1500,
    response_format: opts.responseFormat,
    messages,
  });

  return {
    content: finalResponse.choices[0]?.message?.content ?? "",
    telemetry,
  };
}
