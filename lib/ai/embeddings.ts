import "server-only";
import { openai } from "./client";
import { recordAiUsage, type AiCallMeta } from "./usage";

// OpenAI text-embedding-3-small — 1536 dims, the vector size the context_chunks
// table (0060) and match_context_chunks RPC are built for. Cheap (~$0.02/M
// tokens) and unit-normalized, so cosine distance in pgvector is correct.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

// Stay well under OpenAI's per-request input cap; one request covers the ~30
// chunks a 100k-char (MAX_SOP_CHARS) document produces.
const MAX_BATCH = 96;

/**
 * Embed an array of strings, batched, preserving input order. Token usage is
 * recorded to the ai_usage ledger when `meta` is provided (best-effort, like
 * runChat). Embeddings responses carry prompt_tokens/total_tokens only, so
 * completion_tokens is logged as 0.
 */
export async function embedTexts(
  inputs: string[],
  meta?: AiCallMeta
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += MAX_BATCH) {
    const batch = inputs.slice(i, i + MAX_BATCH);
    const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    for (const d of res.data) out.push(d.embedding as number[]);
    if (meta) {
      void recordAiUsage(meta, EMBEDDING_MODEL, {
        prompt_tokens: res.usage?.prompt_tokens ?? 0,
        completion_tokens: 0,
        total_tokens: res.usage?.total_tokens ?? 0,
      });
    }
  }
  return out;
}

/** Embed a single query string. Convenience wrapper over embedTexts. */
export async function embedQuery(query: string, meta?: AiCallMeta): Promise<number[]> {
  const [vector] = await embedTexts([query], meta);
  return vector;
}
