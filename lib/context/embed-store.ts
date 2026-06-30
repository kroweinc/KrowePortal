import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { chunkText } from "@/lib/context/chunk";
import { embedTexts } from "@/lib/ai/embeddings";
import { assertAiBudget } from "@/lib/ai/usage";
import { friendlyAiError } from "@/lib/ai/client";

// ============================================================
// Shared embedding pipeline for the Client Context Layer. Lives outside the
// "use server" action file so non-action callers (e.g. the document-sync seam)
// can reuse it without exposing it as a public server action. Ownership is
// always proven by the caller, so every write here uses the admin client.
// ============================================================

export async function markItemStatus(
  itemId: string,
  status: "ready" | "failed" | "skipped",
  chunkCount = 0
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("context_items")
    .update({ embedding_status: status, chunk_count: chunkCount, updated_at: new Date().toISOString() })
    .eq("id", itemId);
}

/**
 * Chunk → embed → store. Runs after an item row exists; updates the item's
 * embedding_status so a budget block or embedding failure leaves the item in
 * place (just unindexed) rather than losing the upload. Chunk inserts use the
 * admin client because ownership was already proven by the caller.
 */
export async function embedAndStoreChunks(
  itemId: string,
  engagementId: string,
  text: string,
  userId: string
): Promise<void> {
  const budget = await assertAiBudget(userId);
  if (!budget.ok) {
    await markItemStatus(itemId, "failed");
    return;
  }

  const chunks = chunkText(text);
  if (!chunks.length) {
    await markItemStatus(itemId, "skipped");
    return;
  }

  try {
    const vectors = await embedTexts(
      chunks.map((c) => c.content),
      { userId, operation: "context_embed", engagementId }
    );

    const admin = createAdminClient();
    const { error } = await admin.from("context_chunks").insert(
      chunks.map((c, i) => ({
        context_item_id: itemId,
        engagement_id: engagementId,
        chunk_index: c.index,
        content: c.content,
        token_estimate: c.tokenEstimate,
        embedding: vectors[i],
      }))
    );
    if (error) {
      console.error("[embedAndStoreChunks] insert failed", error.message);
      await markItemStatus(itemId, "failed");
      return;
    }

    await markItemStatus(itemId, "ready", chunks.length);
  } catch (err) {
    console.error("[embedAndStoreChunks]", friendlyAiError(err));
    await markItemStatus(itemId, "failed");
  }
}
