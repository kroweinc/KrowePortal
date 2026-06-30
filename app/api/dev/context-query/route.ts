// ============================================================================
// ⚠️  TEMPORARY / THROWAWAY — NOT part of any real flow.
//
// A dev-only harness to test "what would an agent answer?" against a client's
// Context Layer, before any real agent feature is built. It reuses the exact
// production seam: buildClientContext() (hybrid retrieval) → serializeForPrompt()
// → one LLM call grounded in that context.
//
//   GET  — single question, pretty text in the browser (params below)
//   POST — multi-turn chat ({ engagementId, messages[], k?, effort?, devmatch? }),
//          used by the basic chat UI at /dev/context-chat
//
// GET usage (dev server running, logged in as the owning builder):
//   /api/dev/context-query?engagementId=<uuid>&q=<your question>
// Optional knobs:
//   &k=12          override retrieval top-k (default: adaptive to corpus size)
//   &effort=low    reasoning effort: minimal|low|medium|high (default: low)
//   &prompt=1      also dump the full serialized context fed to the model
//   &format=json   return structured JSON instead of pretty text
//   &devmatch=1    TEST THE QUERY ASPECT on the dev path: run the same query
//                  embedding + cosine ranking directly via the admin client,
//                  bypassing ONLY the RPC's auth.uid() row guard (which the
//                  synthetic dev-builder identity can't satisfy). Use this to
//                  see real semantic snippets when testing as the dev builder.
//
// Hard-gated by DEV_TOGGLE_ENABLED (NODE_ENV !== "production") → 404 in prod.
// DELETE this file (and its empty parent dir) once the real agent flow lands.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { getCurrentProfile, DEV_TOGGLE_ENABLED } from "@/lib/auth";
import {
  buildClientContext,
  serializeForPrompt,
  type ContextSnippet,
} from "@/lib/context/buildClientContext";
import { runChat, AI_MODEL, friendlyAiError, type ReasoningEffort } from "@/lib/ai/client";
import { embedQuery } from "@/lib/ai/embeddings";
import { createAdminClient } from "@/lib/supabase/server";

const VALID_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

/** Cosine similarity between two equal-length vectors. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Dev-only retrieval that bypasses ONLY the RPC's auth.uid() row guard. Reads the
 * engagement's chunks with the admin client (a plain table select, not the
 * guarded match function), embeds the query, then ranks by cosine in JS. This
 * proves the query→embed→similarity→rank pipeline works when testing as the
 * synthetic dev builder, whose service-role identity can't satisfy the guard.
 */
async function devRetrieve(
  engagementId: string,
  query: string,
  k: number,
  userId: string
): Promise<ContextSnippet[]> {
  const queryVec = await embedQuery(query, {
    userId,
    operation: "context_search_devtest",
    engagementId,
  });

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("context_chunks")
    .select("chunk_index, content, embedding, context_item_id")
    .eq("engagement_id", engagementId);
  if (!rows?.length) return [];

  const itemIds = [...new Set(rows.map((r) => r.context_item_id as string))];
  const { data: items } = await admin
    .from("context_items")
    .select("id, kind, title")
    .in("id", itemIds);
  const byId = new Map((items ?? []).map((i) => [i.id as string, i]));

  const scored = rows.map((r) => {
    // pgvector columns arrive as a JSON-array string over PostgREST.
    const vec = typeof r.embedding === "string" ? (JSON.parse(r.embedding) as number[]) : (r.embedding as number[]);
    const item = byId.get(r.context_item_id as string);
    return {
      itemId: r.context_item_id as string,
      itemTitle: (item?.title as string) ?? "(removed)",
      itemKind: (item?.kind as string) ?? "unknown",
      chunkIndex: r.chunk_index as number,
      similarity: cosine(queryVec, vec),
      content: r.content as string,
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

const AGENT_SYSTEM_PROMPT = `You are an internal assistant for a software studio's builder. You answer the builder's question about ONE specific client using ONLY the "CLIENT CONTEXT" provided below (their documents, tasks, engagement timeline, analytics, and linked codebase).

Rules:
- Ground every claim in the provided context. Do not invent facts, dates, names, or numbers that aren't there.
- If the context doesn't contain the answer, say so plainly and name what's missing — don't guess.
- Be concise and concrete. Prefer specifics (titles, statuses, dates, similarity-ranked snippets) over generalities.
- When you use a piece of context, reference it by its item title so the builder can trace it.`;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface AgentTurnResult {
  answer: string;
  snippets: ContextSnippet[];
  serialized: string;
  engagement: { id: string; title: string };
}

/**
 * One grounded turn: retrieve context for `retrievalQuery`, optionally swap in the
 * dev-path cosine match, serialize, then answer with the full `conversation` so
 * multi-turn chat works. Shared by GET (single question) and POST (chat).
 */
async function runAgentTurn(opts: {
  engagementId: string;
  retrievalQuery: string;
  conversation: ChatMessage[];
  k?: number;
  effort: ReasoningEffort;
  devMatch: boolean;
  userId: string;
}): Promise<AgentTurnResult> {
  const { engagementId, retrievalQuery, conversation, k, effort, devMatch, userId } = opts;

  // Real retrieval seam: hybrid search + bundle assembly (enforces builder ownership).
  const bundle = await buildClientContext(engagementId, {
    query: retrievalQuery,
    k: Number.isFinite(k) ? k : undefined,
  });

  // Dev-path query test: replace the (guard-blocked) snippets with an admin-client
  // cosine match so retrieval is visible — and the agent gets grounded — when
  // testing as the synthetic dev builder. Overwrite BEFORE serializing.
  if (devMatch) {
    bundle.snippets = await devRetrieve(engagementId, retrievalQuery, Number.isFinite(k) ? (k as number) : 8, userId);
  }

  const serialized = serializeForPrompt(bundle);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "system", content: `CLIENT CONTEXT (use ONLY this to answer):\n\n${serialized}` },
    ...conversation.map((m) => ({ role: m.role, content: m.content })),
  ];

  const completion = await runChat(
    { model: AI_MODEL, max_completion_tokens: 1500, reasoning_effort: effort, messages },
    { userId, operation: "context_agent_test", engagementId }
  );

  return {
    answer: completion.choices[0]?.message?.content?.trim() || "(model returned no content)",
    snippets: bundle.snippets ?? [],
    serialized,
    engagement: { id: bundle.engagement.id, title: bundle.engagement.title },
  };
}

/** Map a thrown error to the right status — auth/ownership vs. AI/other. */
function errorResponse(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : "Request failed.";
  if (/unauthor/i.test(msg)) return NextResponse.json({ error: msg }, { status: 401 });
  if (/builder only|not your client/i.test(msg)) return NextResponse.json({ error: msg }, { status: 403 });
  if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
  return NextResponse.json({ error: friendlyAiError(err) }, { status: 502 });
}

function toSources(snippets: ContextSnippet[]) {
  return snippets.map((s) => ({
    title: s.itemTitle,
    kind: s.itemKind,
    similarity: Number(s.similarity.toFixed(3)),
    chunkIndex: s.chunkIndex,
  }));
}

/**
 * The full terminal-style diagnostic block: header meta, answer, ranked sources,
 * and (optionally) the serialized context fed to the model. GET returns it as the
 * response body; POST returns it as `debugText` so the chat UI can showcase the
 * same full output the terminal shows.
 */
function buildDebugText(args: {
  engagement: { id: string; title: string };
  query: string;
  effort: ReasoningEffort;
  devMatch: boolean;
  snippets: ContextSnippet[];
  serialized: string;
  answer: string;
  includeSerialized: boolean;
}): string {
  const { engagement, query, effort, devMatch, snippets, serialized, answer, includeSerialized } = args;
  const sources = toSources(snippets);
  const lines: string[] = [];
  lines.push("══════════════════════════════════════════════");
  lines.push("  AGENT QUERY TEST  (temp harness — not in flow)");
  lines.push("══════════════════════════════════════════════");
  lines.push(`Engagement : ${engagement.title} (${engagement.id})`);
  lines.push(`Query      : "${query}"`);
  lines.push(`Model      : ${AI_MODEL} · effort=${effort} · retrieved ${snippets.length} snippet(s)`);
  lines.push(`Retrieval  : ${devMatch ? "devmatch (admin-client cosine — RPC guard bypassed)" : "real seam (match_context_chunks_hybrid)"}`);
  lines.push("");
  lines.push("── ANSWER ──────────────────────────────────────");
  lines.push(answer);
  lines.push("");
  lines.push("── SOURCES (retrieved context the agent saw) ───");
  if (sources.length) {
    sources.forEach((s, i) => {
      lines.push(`${String(i + 1).padStart(2)}. ${s.title}  [${s.kind}]  sim ${s.similarity}  · chunk ${s.chunkIndex}`);
    });
  } else {
    lines.push("(no snippets retrieved — is the engagement's context embedded?)");
  }
  if (includeSerialized) {
    lines.push("");
    lines.push("── SERIALIZED PROMPT (fed to the model) ────────");
    lines.push(serialized);
  }
  lines.push("");
  return lines.join("\n");
}

/** POST: multi-turn chat. Body: { engagementId, messages:[{role,content}], k?, effort?, devmatch? }. */
export async function POST(request: NextRequest) {
  if (!DEV_TOGGLE_ENABLED) return new Response(null, { status: 404 });

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized — log in as the engagement's builder." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const engagementId = typeof body.engagementId === "string" ? body.engagementId.trim() : "";
  const conversation: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof (m as ChatMessage).content === "string" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant")
    )
    .map((m) => ({ role: m.role, content: m.content }));
  const lastUser = [...conversation].reverse().find((m) => m.role === "user");

  if (!engagementId || !lastUser) {
    return NextResponse.json({ error: "Body requires engagementId and at least one user message." }, { status: 400 });
  }

  const k = typeof body.k === "number" ? body.k : undefined;
  const effort: ReasoningEffort = VALID_EFFORTS.includes(body.effort as ReasoningEffort)
    ? (body.effort as ReasoningEffort)
    : "low";
  const devMatch = body.devmatch !== false; // default ON for the dev chat

  try {
    const { answer, snippets, serialized, engagement } = await runAgentTurn({
      engagementId,
      retrievalQuery: lastUser.content,
      conversation,
      k,
      effort,
      devMatch,
      userId: profile.id,
    });
    return NextResponse.json({
      engagement,
      answer,
      model: AI_MODEL,
      effort,
      retrievalMode: devMatch ? "devmatch-admin-cosine" : "real-seam-hybrid",
      retrievedCount: snippets.length,
      sources: toSources(snippets),
      // The same full terminal block, so the chat can showcase it (incl. the
      // serialized context fed to the model).
      debugText: buildDebugText({
        engagement,
        query: lastUser.content,
        effort,
        devMatch,
        snippets,
        serialized,
        answer,
        includeSerialized: true,
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET: single-question test, pretty text (or ?format=json). */
export async function GET(request: NextRequest) {
  if (!DEV_TOGGLE_ENABLED) return new Response(null, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const engagementId = sp.get("engagementId")?.trim();
  const query = sp.get("q")?.trim();
  const kParam = sp.get("k");
  const effortParam = sp.get("effort") as ReasoningEffort | null;
  const showPrompt = sp.get("prompt") === "1";
  const asJson = sp.get("format") === "json";
  const devMatch = sp.get("devmatch") === "1";

  if (!engagementId || !query) {
    return NextResponse.json(
      { error: "Required query params: engagementId, q. Optional: k, effort, prompt=1, format=json, devmatch=1." },
      { status: 400 }
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized — log in as the engagement's builder." }, { status: 401 });
  }

  const k = kParam ? Number(kParam) : undefined;
  const effort: ReasoningEffort =
    effortParam && VALID_EFFORTS.includes(effortParam) ? effortParam : "low";

  let result: AgentTurnResult;
  try {
    result = await runAgentTurn({
      engagementId,
      retrievalQuery: query,
      conversation: [{ role: "user", content: query }],
      k,
      effort,
      devMatch,
      userId: profile.id,
    });
  } catch (err) {
    return errorResponse(err);
  }

  const { answer, snippets, serialized, engagement } = result;
  const sources = toSources(snippets);

  if (asJson) {
    return NextResponse.json({
      engagement,
      query,
      model: AI_MODEL,
      effort,
      retrievalMode: devMatch ? "devmatch-admin-cosine" : "real-seam-hybrid",
      retrievedCount: snippets.length,
      answer,
      sources,
      ...(showPrompt ? { serializedPrompt: serialized } : {}),
    });
  }

  // Pretty text/plain — readable straight in the browser.
  const text = buildDebugText({
    engagement,
    query,
    effort,
    devMatch,
    snippets,
    serialized,
    answer,
    includeSerialized: showPrompt,
  });

  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
