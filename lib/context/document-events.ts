import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

// ============================================================
// Record one immutable lifecycle event for an outbound document into
// document_events (0061). This is the write seam the per-document timeline
// reads back. Lives outside "use server" so non-action callers (lifecycle
// helpers, sync paths) can reuse it.
//
// Everything here is BEST-EFFORT — mirroring syncDocumentContext: an audit
// write must never break document creation/editing, so failures are logged and
// swallowed. Writes go through the service-role admin client (bypasses RLS);
// the calling action is responsible for authorization.
//
// Engagement scope: project-scoped docs (prd/quote/contract) resolve their
// engagement from projectId; engagement-scoped docs (brief/change_order) pass
// engagementId directly. If neither resolves an engagement (orphan project),
// we no-op — there is nowhere to attach the event.
// ============================================================

export type DocEventKind = "prd" | "quote" | "contract" | "brief" | "change_order";

export type DocEventType =
  | "created"
  | "sent"
  | "viewed"
  | "changes_requested"
  | "re_sent"
  | "accepted"
  | "signed"
  | "rejected"
  | "deleted";

export type DocActorRole = "builder" | "operator" | "client" | "system";

export interface RecordDocumentEventInput {
  docKind: DocEventKind;
  docId: string;
  eventType: DocEventType;
  /** Provide ONE of engagementId / projectId. engagementId wins if both given. */
  engagementId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  actorRole?: DocActorRole;
  payload?: Record<string, unknown>;
}

async function resolveEngagementId(
  admin: ReturnType<typeof createAdminClient>,
  input: RecordDocumentEventInput
): Promise<string | null> {
  if (input.engagementId) return input.engagementId;
  if (!input.projectId) return null;
  const { data } = await admin
    .from("engagements")
    .select("id")
    .eq("project_id", input.projectId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function recordDocumentEvent(input: RecordDocumentEventInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const engagementId = await resolveEngagementId(admin, input);
    if (!engagementId) return; // orphan project — nowhere to attach the event

    await admin.from("document_events").insert({
      engagement_id: engagementId,
      doc_kind: input.docKind,
      doc_id: input.docId,
      event_type: input.eventType,
      actor_id: input.actorId ?? null,
      actor_role: input.actorRole ?? null,
      payload: input.payload ?? {},
    });
  } catch (err) {
    console.error("[recordDocumentEvent]", err);
  }
}
