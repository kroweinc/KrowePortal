import "server-only";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type OpenAI from "openai";

import { openai, AI_MODEL, friendlyAiError } from "@/lib/ai/client";
import { recordAiUsage } from "@/lib/ai/usage";
import { AGENT_SYSTEM_PROMPT } from "./system-prompt";
import { toolSpecs, getTool, isWriteTool } from "./tools";
import { resolveViewedDocRef } from "./doc-tools";
import { refinableSection } from "@/lib/prd/section-fields";
import { DOC_KIND_LABEL } from "@/lib/context/serialize-documents";
import type { Profile } from "@/lib/types";
import type { AgentEvent, AgentSource, AgentToolCall, AgentWidget } from "./types";

// ============================================================================
// The context agent's turn engine. Consumes the RAW OpenAI stream directly
// (runChatStream discards tool_call deltas, which we need), so it can both
// stream text AND accumulate tool calls.
//
// The mandatory grounding retrieval (buildClientContext → serializeForPrompt)
// runs in the SSE route BEFORE streaming — its getCurrentProfile()/cookies()
// call must happen in request scope, not mid-stream — so the caller passes in
// the pre-built `serialized` context and `baseSources`. The optional
// search_context tool runs inside the loop and degrades gracefully if it can't.
//
// It yields AgentEvents; the SSE route forwards them to the browser and
// persists the terminal `final` / `proposal`. Read tools auto-run inside the
// loop; write tools stop the turn with a `proposal` for the builder to confirm.
// ============================================================================

const MAX_COMPLETION_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 4; // hard stop on read-tool ping-pong

// Doc tools that address a document by title. When the builder is viewing a
// specific document and the model calls one of these WITHOUT a title, we bake the
// viewed document's title in — so "change the document" (with no name) acts on the
// one on screen instead of the agent asking which.
const DOC_TITLE_TOOLS = new Set([
  "edit_document",
  "read_document",
  "refine_document_section",
  "swap_prd_tech",
]);

type ChatMessage = { role: "user" | "assistant"; content: string };

/** Accumulator for streamed tool-call deltas (arguments arrive in fragments). */
interface AccToolCall {
  id: string;
  name: string;
  args: string;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Dedupe sources by title+kind, keeping the highest similarity. */
function mergeSources(into: AgentSource[], add: AgentSource[]): AgentSource[] {
  const byKey = new Map(into.map((s) => [`${s.title}|${s.kind}`, s]));
  for (const s of add) {
    const key = `${s.title}|${s.kind}`;
    const existing = byKey.get(key);
    if (!existing || s.similarity > existing.similarity) byKey.set(key, s);
  }
  return [...byKey.values()].sort((a, b) => b.similarity - a.similarity);
}

export async function* runContextAgent(input: {
  engagementId: string;
  builderId: string;
  // Pre-authorized builder profile — passed to read tools so they don't touch
  // cookies (the turn runs in a background task where they're unavailable).
  profile: Profile;
  serialized: string;
  baseSources: AgentSource[];
  history: ChatMessage[];
  // A human label for the page the builder fired the turn from ("the Tasks
  // board"), used to bias ambiguous requests. Undefined on neutral surfaces.
  page?: string;
  // The project the builder is viewing (a document/project page), passed to the
  // document tools so they scope to it — reaching orphan-project drafts.
  projectId?: string;
  // The specific document the builder is viewing, so an untitled doc tool-call
  // (edit/read/refine "the document") is pinned to it rather than asking which.
  viewedDoc?: { kind: "prd" | "quote" | "contract"; id: string };
  // The PRD section the builder is scrolled to (e.g. "techStack"), so an untitled
  // refine — or an ambiguous "change the tech stack" — targets that section.
  viewedSection?: string;
}): AsyncGenerator<AgentEvent, void, unknown> {
  const {
    engagementId,
    builderId,
    profile,
    serialized,
    baseSources,
    history,
    page,
    projectId,
    viewedDoc,
    viewedSection,
  } = input;

  // Resolve the viewed document's title once per turn (lazily — only if the model
  // actually calls a doc tool without a title), then reuse it across rounds.
  let viewedRef: { kind: string; title: string } | null | undefined;
  const resolveViewed = async (): Promise<{ kind: string; title: string } | null> => {
    if (viewedRef === undefined) {
      viewedRef = viewedDoc ? await resolveViewedDocRef(viewedDoc, builderId) : null;
    }
    return viewedRef;
  };
  // Bake the viewed document into any doc tool-call that arrived without a title.
  // A model-supplied title always wins (an explicit "edit the Acme quote").
  const pinViewedDoc = async (list: AccToolCall[]): Promise<void> => {
    if (!viewedDoc) return;
    for (const c of list) {
      if (!DOC_TITLE_TOOLS.has(c.name)) continue;
      const a = parseArgs(c.args);
      // A model-supplied title always wins ("edit the Acme quote").
      if (typeof a.title === "string" && a.title.trim()) continue;
      // A model-supplied kind that differs from the viewed doc means it's after a
      // DIFFERENT document by kind ("read the quote" while viewing the PRD) — don't
      // force the viewed doc's title onto it; let resolveDoc pick that kind.
      if (typeof a.kind === "string" && a.kind && a.kind !== viewedDoc.kind) continue;
      const ref = await resolveViewed();
      if (!ref) return; // viewed doc is gone — let resolveDoc fall back
      a.title = ref.title;
      if (!a.kind) a.kind = ref.kind;
      c.args = JSON.stringify(a);
    }
  };
  // Bake the viewed section into an untitled refine_document_section, so "refine
  // this" / "change the tech stack" targets the section the builder is scrolled to
  // (§9 for tech) instead of the model guessing or asking which. A model-supplied
  // section always wins; skip when it's addressing a non-PRD doc by kind.
  const pinViewedSection = (list: AccToolCall[]): void => {
    if (!viewedSection) return;
    for (const c of list) {
      if (c.name !== "refine_document_section") continue;
      const a = parseArgs(c.args);
      if (typeof a.section === "string" && a.section.trim()) continue;
      if (typeof a.kind === "string" && a.kind && a.kind !== "prd") continue;
      a.section = viewedSection;
      c.args = JSON.stringify(a);
    }
  };

  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    yield { type: "error", error: "No question to answer." };
    return;
  }

  try {
    let sources: AgentSource[] = baseSources;
    // Rendered UI accumulated from read tools (e.g. list_tasks' board), attached
    // to the terminal event so it persists and rehydrates on reload.
    const widgets: AgentWidget[] = [];
    if (sources.length) yield { type: "sources", sources };

    // The page hint biases ambiguous requests. When the builder is on a document,
    // name the document — and the section they're scrolled to — so "change the tech
    // stack" / "refine this" / "swap X for Y" resolves to the right target without
    // them naming it. Off a document, fall back to the top-level area label (page).
    let pageHint: string | undefined;
    if (viewedDoc) {
      const ref = await resolveViewed();
      if (ref) {
        const docLabel = `${DOC_KIND_LABEL[viewedDoc.kind]} "${ref.title}"`;
        const sectionTitle =
          viewedSection && viewedDoc.kind === "prd" ? refinableSection(viewedSection)?.title : undefined;
        pageHint = sectionTitle
          ? `The builder is viewing the "${sectionTitle}" section of the ${docLabel}. When a request is ambiguous about which document or section it targets — "change the tech stack", "refine this", "swap X for Y" — assume that section of that ${DOC_KIND_LABEL[viewedDoc.kind]}. Always follow an explicit target.`
          : `The builder is viewing the ${docLabel}. When a request is ambiguous about which document it targets ("edit it", "change this"), assume that ${DOC_KIND_LABEL[viewedDoc.kind]}. Always follow an explicit target.`;
      }
    }
    if (!pageHint && page) {
      pageHint = `The builder is viewing ${page}. When their request is ambiguous, favor ${page}-related help — but always follow an explicit ask.`;
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      { role: "system", content: `CLIENT CONTEXT (use ONLY this to answer):\n\n${serialized}` },
      // The page hint rides AFTER the two prompt-cached system messages so the
      // static prefix (prompt_cache_key below) still hits — a per-turn steer, not
      // part of the cached prefix.
      ...(pageHint ? [{ role: "system" as const, content: pageHint }] : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const meta = { userId: builderId, operation: "context_agent", engagementId };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      yield { type: "status", status: "thinking" };

      const stream = await openai.chat.completions.create({
        model: AI_MODEL,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // gpt-5.x rejects function tools alongside a reasoning pass on
        // /v1/chat/completions — reasoning_effort MUST be "none" when tools are
        // sent. That also makes the agent snappy (no reasoning latency), which
        // is the right tradeoff for a grounded, tool-using advisor.
        reasoning_effort: "none",
        // Steer prefix-cache routing. The message array is static-prefix-first
        // (AGENT_SYSTEM_PROMPT, then the per-turn CLIENT CONTEXT), so a stable
        // per-flow key lets the shared system-prompt prefix hit cache across
        // every turn/client — a free TTFT win, no effect on output.
        prompt_cache_key: "context-agent-v1",
        tools: toolSpecs(),
        tool_choice: "auto",
        messages,
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = "";
      const acc: Record<number, AccToolCall> = {};
      let usage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          yield { type: "delta", text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const slot = (acc[idx] ??= { id: "", name: "", args: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }
      if (usage) void recordAiUsage(meta, AI_MODEL, usage);

      const calls = Object.values(acc).filter((c) => c.name);

      // Pin the viewed document into any untitled doc tool-call before it's
      // proposed or run, so the persisted proposal is self-contained and the
      // deferred confirm step resolves the right document with no extra context.
      await pinViewedDoc(calls);
      pinViewedSection(calls);

      // No tool calls → this is the answer.
      if (calls.length === 0) {
        yield { type: "final", content, sources, widgets: widgets.length ? widgets : undefined };
        return;
      }

      // Split proposals (write) from auto-run (read) tools.
      const writeCalls = calls.filter((c) => isWriteTool(c.name));
      if (writeCalls.length > 0) {
        const proposal: AgentToolCall[] = writeCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: parseArgs(c.args),
        }));
        yield {
          type: "proposal",
          content,
          toolCalls: proposal,
          sources,
          widgets: widgets.length ? widgets : undefined,
        };
        return;
      }

      // Read tools: record the assistant's tool-call turn, execute each, feed
      // results back, and loop for the model's next move.
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      });

      yield { type: "status", status: "running_tool" };
      for (const c of calls) {
        const tool = getTool(c.name);
        yield { type: "tool", phase: "start", name: c.name };
        let resultText: string;
        if (!tool) {
          resultText = `Unknown tool: ${c.name}`;
        } else {
          const result = await tool.execute(parseArgs(c.args), { engagementId, builderId, profile, projectId });
          resultText = result.content;
          if (result.sources?.length) {
            sources = mergeSources(sources, result.sources);
            yield { type: "sources", sources };
          }
          if (result.widget) {
            widgets.push(result.widget);
            yield { type: "widget", widget: result.widget };
          }
        }
        messages.push({ role: "tool", tool_call_id: c.id, content: resultText });
        yield { type: "tool", phase: "done", name: c.name };
      }
    }

    // Exhausted the tool budget without a final answer — give the model one last
    // chance to summarize from what it has rather than looping forever.
    yield {
      type: "final",
      content:
        "I gathered context but couldn't converge on an answer. Try narrowing the question or asking again.",
      sources,
      widgets: widgets.length ? widgets : undefined,
    };
  } catch (err) {
    yield { type: "error", error: friendlyAiError(err) };
  }
}
