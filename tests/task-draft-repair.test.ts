import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A repo-aware task draft that misses the schema used to be recovered by running
 * the ENTIRE GitHub tool loop a second time — re-reading every file and re-sending
 * a message array that grows each round. One "+" click could therefore emit up to
 * 26 completions, the burst most likely to surface "The AI service is rate-limited
 * right now." These lock in the cheaper recovery: one tool-free strict-schema call.
 */

const runChat = vi.fn();
const runWithTools = vi.fn();

vi.mock("@/lib/ai/client", () => ({
  openai: {},
  AI_MODEL: "gpt-5.4-mini",
  runChat: (...args: unknown[]) => runChat(...args),
}));

vi.mock("@/lib/github/ai-tools", () => ({
  runWithTools: (...args: unknown[]) => runWithTools(...args),
}));

const { generateTask } = await import("@/lib/ai/generate-tasks");

const VALID_DRAFT = {
  kind: "task",
  item: {
    title: "Attribute AI rate limits to their generation path",
    description:
      "Log the raw OpenAI error next to the flow name so a 429 can be traced to the generation path that emitted it.",
    priority: "medium",
    type: "change",
    tags: ["backend"],
    assumptions: [],
  },
};

const TELEMETRY = { rounds: 4, toolCalls: 9, filesRead: 3, totalBytes: 4857, hitMaxRounds: false };
const TOOL_CONTEXT = { owner: "Jynx-hub", repo: "KroweInternal" } as never;

const INPUT = {
  rawDescription: "Add a way to see which flow caused a rate limit",
  repoContext: null,
};

function loopReturns(content: string) {
  runWithTools.mockResolvedValue({ content, telemetry: TELEMETRY });
}

function repairReturns(content: string) {
  runChat.mockResolvedValue({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  runChat.mockReset();
  runWithTools.mockReset();
});

describe("generateTask schema recovery", () => {
  it("repairs a malformed tool-loop draft without replaying the tool loop", async () => {
    loopReturns("{ this is not valid json");
    repairReturns(JSON.stringify(VALID_DRAFT));

    const result = await generateTask({ ...INPUT, toolContext: TOOL_CONTEXT });

    // The regression this guards: the loop used to run a second time.
    expect(runWithTools).toHaveBeenCalledTimes(1);
    expect(runChat).toHaveBeenCalledTimes(1);
    expect(result.item.title).toBe(VALID_DRAFT.item.title);
  });

  it("sends the repair with no tools, under strict json_schema, carrying the bad output", async () => {
    loopReturns('{"kind":"task","item":{"title":"x"}}'); // parses, but fails the schema
    repairReturns(JSON.stringify(VALID_DRAFT));

    await generateTask({ ...INPUT, toolContext: TOOL_CONTEXT });

    const params = runChat.mock.calls[0][0] as {
      tools?: unknown;
      response_format: { type: string };
      reasoning_effort: string;
      messages: { content: string }[];
    };
    expect(params.tools).toBeUndefined();
    expect(params.response_format.type).toBe("json_schema");
    // Tools are absent, so the reasoning pass is safe to skip for a reshape.
    expect(params.reasoning_effort).toBe("none");
    // The invalid draft is fed back so the repair reshapes it instead of re-researching.
    expect(params.messages.at(-1)?.content).toContain('"title":"x"');
  });

  it("never fires a repair when the first draft already parses", async () => {
    loopReturns(JSON.stringify(VALID_DRAFT));

    const result = await generateTask({ ...INPUT, toolContext: TOOL_CONTEXT });

    expect(runWithTools).toHaveBeenCalledTimes(1);
    expect(runChat).not.toHaveBeenCalled();
    expect(result.item.priority).toBe("medium");
  });

  it("still throws when the repair also misses the schema, without a third call", async () => {
    loopReturns("{ not json");
    repairReturns("still not json");

    await expect(generateTask({ ...INPUT, toolContext: TOOL_CONTEXT })).rejects.toThrow(
      "AI response validation failed"
    );
    expect(runWithTools).toHaveBeenCalledTimes(1);
    expect(runChat).toHaveBeenCalledTimes(1);
  });

  it("leaves the one-shot path on a single call — strict mode needs no repair", async () => {
    repairReturns("{ not json");

    await expect(generateTask({ ...INPUT, toolContext: undefined })).rejects.toThrow(
      "AI response validation failed"
    );
    expect(runChat).toHaveBeenCalledTimes(1);
    expect(runWithTools).not.toHaveBeenCalled();
  });
});
