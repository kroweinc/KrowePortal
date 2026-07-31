import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { embedAndStoreChunks } from "@/lib/context/embed-store";
import { fetchLinkText } from "@/lib/context/fetch-link";

// ============================================================
// Turn a saved link into searchable knowledge: fetch the page, extract text,
// and embed it. Links start life as bare references (embedding_status:'skipped'
// — see addContextLink); this fetches their content so RAG can actually use
// them. A bounded retry counter in source_meta.fetch_attempts stops us hammering
// dead/auth-walled URLs on every panel load. Best-effort throughout.
// ============================================================

const MAX_FETCH_ATTEMPTS = 3;

/**
 * Fetch + embed one link's content. Updates the item to `pending` then lets
 * embedAndStoreChunks finalize status; on fetch failure records the error and
 * bumps the attempt counter, leaving the link as a usable reference.
 */
export async function syncLinkContent(
  itemId: string,
  engagementId: string,
  url: string,
  builderId: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: item } = await admin
      .from("context_items")
      .select("source_meta")
      .eq("id", itemId)
      .maybeSingle();
    const meta = ((item?.source_meta as Record<string, unknown>) ?? { source: "link" }) as Record<
      string,
      unknown
    >;
    const attempts = (meta.fetch_attempts as number) ?? 0;

    const result = await fetchLinkText(url);
    if ("error" in result) {
      await admin
        .from("context_items")
        .update({
          embedding_status: "failed",
          source_meta: { ...meta, fetch_attempts: attempts + 1, fetch_error: result.error },
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      return;
    }

    const text = result.text;
    await admin
      .from("context_items")
      .update({
        content: text,
        char_count: text.length,
        embedding_status: "pending",
        source_meta: { ...meta, fetch_attempts: attempts + 1, fetch_error: null },
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    // Drop any stale chunks (re-fetch case) before re-embedding.
    await admin.from("context_chunks").delete().eq("context_item_id", itemId);
    await embedAndStoreChunks(itemId, engagementId, text, builderId);
  } catch (err) {
    console.error("[syncLinkContent]", err);
  }
}

/**
 * Retry fetching content for links that aren't indexed yet (still `skipped` —
 * e.g. added before link-fetch existed — or `failed`), capped by attempt count.
 * Best-effort; safe to call on every panel load.
 */
export async function backfillLinkContents(engagementId: string, builderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: links } = await admin
      .from("context_items")
      .select("id, url, source_meta")
      .eq("engagement_id", engagementId)
      .eq("kind", "link")
      .in("embedding_status", ["skipped", "failed"]);

    const jobs: Promise<void>[] = [];
    for (const l of links ?? []) {
      const url = l.url as string | null;
      if (!url) continue;
      const meta = (l.source_meta as Record<string, unknown>) ?? {};
      if (((meta.fetch_attempts as number) ?? 0) >= MAX_FETCH_ATTEMPTS) continue;
      jobs.push(syncLinkContent(l.id as string, engagementId, url, builderId));
    }
    await Promise.all(jobs);
  } catch (err) {
    console.error("[backfillLinkContents]", err);
  }
}
