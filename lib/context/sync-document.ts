import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { embedAndStoreChunks } from "@/lib/context/embed-store";
import {
  serializeDocumentForContext,
  DOC_KIND_LABEL,
  type SyncDocKind,
} from "@/lib/context/serialize-documents";
import type { PrdContent, QuoteContent, ContractContent } from "@/lib/types";

// ============================================================
// Keep the Client Context Layer in lockstep with a builder's outbound
// documents. Whenever a PRD / quote / contract is created, regenerated,
// edited, or sent, its rendered text is upserted as a context_item on the
// project's engagement so it flows into RAG (semantic search + buildClientContext).
//
// Project ↔ engagement: PRDs/quotes/contracts hang off a PROJECT, but context
// lives on the ENGAGEMENT (engagements.project_id, unique per project). Until a
// project is linked to an engagement (see connectProjectToClientOnSend), there
// is nowhere to attach context, so these helpers simply no-op.
//
// Linkage: the synced item is identified by source_meta = { source: "auto-doc",
// docKind, docId } — one context_item per source document. Everything here is
// BEST-EFFORT: a failure must never break document creation/editing, so the
// callers fire-and-forget and we swallow errors after logging.
// ============================================================

interface EngagementRef {
  id: string;
  builderId: string;
}

async function engagementForProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string
): Promise<EngagementRef | null> {
  const { data } = await admin
    .from("engagements")
    .select("id, builder_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, builderId: data.builder_id as string };
}

export interface SyncDocumentInput {
  docKind: SyncDocKind;
  docId: string;
  projectId: string;
  title: string;
  content: PrdContent | QuoteContent | ContractContent;
  /** The acting builder; must own the engagement, else we skip (defensive). */
  builderId: string;
}

/**
 * Create or refresh the context_item mirroring a document. No-ops when the
 * project has no engagement yet. Skips re-embedding when the rendered text is
 * unchanged (cheap title-only edits don't burn embedding budget).
 */
export async function syncDocumentContext(input: SyncDocumentInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const eng = await engagementForProject(admin, input.projectId);
    if (!eng) return; // orphan project — no engagement to attach context to
    if (eng.builderId !== input.builderId) return; // not this builder's client

    const text = serializeDocumentForContext(input.docKind, input.title, input.content);
    if (!text.trim()) return;
    const itemTitle = `${DOC_KIND_LABEL[input.docKind]} — ${input.title}`;

    const { data: existing } = await admin
      .from("context_items")
      .select("id, title, content")
      .eq("engagement_id", eng.id)
      .eq("source_meta->>docKind", input.docKind)
      .eq("source_meta->>docId", input.docId)
      .maybeSingle();

    if (existing) {
      const titleChanged = existing.title !== itemTitle;
      const contentChanged = existing.content !== text;
      if (!titleChanged && !contentChanged) return; // nothing to do

      if (!contentChanged) {
        // Title-only change — update the label without re-embedding.
        await admin
          .from("context_items")
          .update({ title: itemTitle, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        revalidatePath(`/b/engagements/${eng.id}`);
        return;
      }

      await admin
        .from("context_items")
        .update({
          title: itemTitle,
          content: text,
          char_count: text.length,
          embedding_status: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id as string);
      // Replace stale chunks, then re-embed the new text.
      await admin.from("context_chunks").delete().eq("context_item_id", existing.id as string);
      await embedAndStoreChunks(existing.id as string, eng.id, text, eng.builderId);
      revalidatePath(`/b/engagements/${eng.id}`);
      return;
    }

    const { data: created, error } = await admin
      .from("context_items")
      .insert({
        engagement_id: eng.id,
        created_by: eng.builderId,
        kind: "document",
        title: itemTitle,
        content: text,
        char_count: text.length,
        source_meta: { source: "auto-doc", docKind: input.docKind, docId: input.docId },
      })
      .select("id")
      .single();
    if (error || !created) return;

    await embedAndStoreChunks(created.id as string, eng.id, text, eng.builderId);
    revalidatePath(`/b/engagements/${eng.id}`);
  } catch (err) {
    console.error("[syncDocumentContext]", err);
  }
}

/**
 * Mirror any of a project's existing PRDs/quotes/contracts that aren't in the
 * context layer yet. Covers documents authored before this sync existed, and
 * drafts created while the project was still an orphan (no engagement to attach
 * to). Gap-fill only — documents already mirrored are left untouched, so edits
 * (handled by syncDocumentContext on save) aren't clobbered and nothing is
 * re-embedded on a repeat call. Best-effort; safe to call on every panel load.
 */
export async function backfillProjectDocuments(
  engagementId: string,
  projectId: string,
  builderId: string
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("context_items")
      .select("source_meta")
      .eq("engagement_id", engagementId)
      .eq("source_meta->>source", "auto-doc");
    const synced = new Set(
      (existing ?? [])
        .map((r) => (r.source_meta as { docId?: string } | null)?.docId)
        .filter(Boolean) as string[]
    );

    // Owner-scoped reads (created_by == builder) mirror the getXByProject helpers.
    const cols = "id, title, content";
    const [prds, quotes, contracts] = await Promise.all([
      admin.from("prds").select(cols).eq("project_id", projectId).eq("created_by", builderId),
      admin.from("quotes").select(cols).eq("project_id", projectId).eq("created_by", builderId),
      admin.from("contracts").select(cols).eq("project_id", projectId).eq("created_by", builderId),
    ]);

    const rows: { kind: SyncDocKind; rows: { id: string; title: string; content: unknown }[] }[] = [
      { kind: "prd", rows: (prds.data ?? []) as never },
      { kind: "quote", rows: (quotes.data ?? []) as never },
      { kind: "contract", rows: (contracts.data ?? []) as never },
    ];

    const jobs: Promise<void>[] = [];
    for (const group of rows) {
      for (const row of group.rows) {
        if (synced.has(row.id)) continue;
        jobs.push(
          syncDocumentContext({
            docKind: group.kind,
            docId: row.id,
            projectId,
            title: row.title,
            content: row.content as PrdContent | QuoteContent | ContractContent,
            builderId,
          })
        );
      }
    }
    await Promise.all(jobs);
  } catch (err) {
    console.error("[backfillProjectDocuments]", err);
  }
}

/**
 * Remove the context_item mirroring a deleted document (chunks cascade). Keeps
 * the context layer from citing a document that no longer exists. Best-effort.
 */
export async function removeDocumentContext(
  docKind: SyncDocKind,
  docId: string,
  projectId: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const eng = await engagementForProject(admin, projectId);
    if (!eng) return;

    await admin
      .from("context_items")
      .delete()
      .eq("engagement_id", eng.id)
      .eq("source_meta->>docKind", docKind)
      .eq("source_meta->>docId", docId);
    revalidatePath(`/b/engagements/${eng.id}`);
  } catch (err) {
    console.error("[removeDocumentContext]", err);
  }
}
