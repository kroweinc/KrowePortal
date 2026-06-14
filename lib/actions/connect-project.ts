import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Option 2 — when a builder sends a project document (quote / PRD / contract),
 * connect that document's project to their client so it appears in the client's
 * portal immediately ("Awaiting your signature"), with no link to share by hand.
 *
 * Fires only in the unambiguous case:
 *   1. the project has no engagement yet (an orphan project), AND
 *   2. the builder has exactly ONE project-less engagement that already has an
 *      accepted operator — their sole unattached client.
 * Then we attach the project to that engagement, so the operator portal (which
 * aggregates documents across all of a client's engagements) surfaces it. With
 * zero or multiple candidates we do nothing and fall back to the share-link
 * handshake, so a document can never be wired to the wrong client.
 *
 * Best-effort: never throws — connection is a convenience, not a precondition
 * for sending. Returns true when it attached the project.
 */
export async function connectProjectToClientOnSend(
  projectId: string,
  builderId: string
): Promise<boolean> {
  try {
    const admin = createAdminClient();

    // Already has an engagement for this project → connected (or it will be once
    // that engagement's operator accepts). Nothing to do.
    const { data: existing } = await admin
      .from("engagements")
      .select("id")
      .eq("project_id", projectId)
      .maybeSingle();
    if (existing) return false;

    // The builder's project-less engagements that already have an accepted
    // operator. Requiring an operator skips the builder's own empty workspace;
    // requiring exactly one keeps the attachment unambiguous.
    const { data: candidates } = await admin
      .from("engagements")
      .select("id")
      .eq("builder_id", builderId)
      .is("project_id", null)
      .not("operator_id", "is", null);
    if (!candidates || candidates.length !== 1) return false;

    // Attach. The engagements_project_unique partial index guards against a
    // concurrent project engagement claiming the same project; the
    // still-project-less filter guards against a concurrent attach. A stray
    // failure on either is ignored — the share-link handshake remains.
    const { error } = await admin
      .from("engagements")
      .update({ project_id: projectId })
      .eq("id", candidates[0].id)
      .is("project_id", null);
    if (error) return false;

    revalidatePath("/o/engagement");
    revalidatePath("/o/project");
    return true;
  } catch {
    return false;
  }
}
