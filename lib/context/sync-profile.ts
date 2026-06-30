import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { embedAndStoreChunks } from "@/lib/context/embed-store";
import { diffProfileText, recordProfileEvent } from "@/lib/context/profile-events";
import {
  serializeBuilderProfile,
  serializeOperatorProfile,
} from "@/lib/context/serialize-profile";
import type {
  BuilderProfile,
  BuilderProfileProject,
  BuilderProfileExperience,
  BuilderProfileCodingTool,
  BusinessContextCard,
} from "@/lib/types";

// ============================================================
// Keep the Client Context Layer in lockstep with the two people in an
// engagement: the builder (their profile — experience, projects, stack) and the
// operator (their business — who runs it, website, business context). Each is
// serialized to text and upserted as a context_item so it flows into RAG
// (semantic search + buildClientContext) and previews on its graph node.
//
// Linkage: the synced item is identified by source_meta = { source: "profile",
// role: "builder" | "operator" } — one context_item per role per engagement.
// Everything here is BEST-EFFORT: a failure must never break the context panel
// load, so the caller fires these alongside the document backfill and we swallow
// errors after logging. Mirrors sync-document.ts's upsert-diff-embed flow.
// ============================================================

type Admin = ReturnType<typeof createAdminClient>;
type ProfileRole = "builder" | "operator";

/**
 * Create or refresh the context_item mirroring a profile. Skips re-embedding
 * when the rendered text is unchanged (cheap reloads don't burn embedding
 * budget). No-ops when there's nothing substantive to store (empty text).
 */
async function upsertProfileItem(
  admin: Admin,
  engagementId: string,
  builderId: string,
  role: ProfileRole,
  title: string,
  text: string
): Promise<void> {
  if (!text.trim()) return; // nothing substantive beyond the bare name

  const { data: existing } = await admin
    .from("context_items")
    .select("id, title, content")
    .eq("engagement_id", engagementId)
    .eq("source_meta->>source", "profile")
    .eq("source_meta->>role", role)
    .maybeSingle();

  if (existing) {
    const titleChanged = existing.title !== title;
    const contentChanged = existing.content !== text;
    if (!titleChanged && !contentChanged) return; // nothing to do

    if (!contentChanged) {
      // Title-only change — update the label without re-embedding.
      await admin
        .from("context_items")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", existing.id as string);
      revalidatePath(`/b/engagements/${engagementId}`);
      return;
    }

    // Capture the field-level diff (what changed, and from what) BEFORE the row
    // is overwritten — this is the person node's profile change history.
    const changes = diffProfileText((existing.content as string | null) ?? "", text);

    await admin
      .from("context_items")
      .update({
        title,
        content: text,
        char_count: text.length,
        embedding_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
    // Replace stale chunks, then re-embed the new text.
    await admin.from("context_chunks").delete().eq("context_item_id", existing.id as string);
    await embedAndStoreChunks(existing.id as string, engagementId, text, builderId);
    await recordProfileEvent({ engagementId, role, actorId: builderId, changes });
    revalidatePath(`/b/engagements/${engagementId}`);
    return;
  }

  const { data: created, error } = await admin
    .from("context_items")
    .insert({
      engagement_id: engagementId,
      created_by: builderId,
      kind: "profile",
      title,
      content: text,
      char_count: text.length,
      source_meta: { source: "profile", role },
    })
    .select("id")
    .single();
  if (error || !created) return;

  await embedAndStoreChunks(created.id as string, engagementId, text, builderId);
  revalidatePath(`/b/engagements/${engagementId}`);
}

/** Mirror the engagement builder's profile into the context layer. */
export async function syncBuilderProfileContext(
  engagementId: string,
  builderId: string
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: profile } = await admin
      .from("builder_profiles")
      .select("*")
      .eq("user_id", builderId)
      .maybeSingle();
    if (!profile) return; // no profile authored yet — nothing to serialize

    const profileId = profile.id as string;
    const [projects, experience, codingTools] = await Promise.all([
      admin
        .from("builder_profile_projects")
        .select("*")
        .eq("builder_profile_id", profileId)
        .order("display_order", { ascending: true }),
      admin
        .from("builder_profile_experience")
        .select("*")
        .eq("builder_profile_id", profileId)
        .order("display_order", { ascending: true }),
      admin
        .from("builder_profile_coding_tools")
        .select("*")
        .eq("builder_profile_id", profileId)
        .order("display_order", { ascending: true }),
    ]);

    const text = serializeBuilderProfile({
      profile: profile as BuilderProfile,
      projects: (projects.data ?? []) as BuilderProfileProject[],
      experience: (experience.data ?? []) as BuilderProfileExperience[],
      codingTools: (codingTools.data ?? []) as BuilderProfileCodingTool[],
    });

    const name = ((profile.display_name as string | null) ?? "").trim() || "Builder";
    await upsertProfileItem(
      admin,
      engagementId,
      builderId,
      "builder",
      `Builder profile — ${name}`,
      text
    );
  } catch (err) {
    console.error("[syncBuilderProfileContext]", err);
  }
}

/** Mirror the operator's business profile into the context layer. */
export async function syncOperatorProfileContext(
  engagementId: string,
  builderId: string
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data } = await admin
      .from("engagements")
      .select(
        "title, operator:profiles!operator_id(display_name), project:projects(name, prospect_name, prospect_email, website_url, linkedin_url, context)"
      )
      .eq("id", engagementId)
      .maybeSingle();
    if (!data) return;

    // Supabase infers embedded relations as arrays; these are to-one, so cast.
    const eng = data as unknown as {
      title: string | null;
      operator: { display_name: string | null } | null;
      project: {
        name: string | null;
        prospect_name: string | null;
        prospect_email: string | null;
        website_url: string | null;
        linkedin_url: string | null;
        context: string | null;
      } | null;
    };

    const { data: cards } = await admin
      .from("business_context_cards")
      .select("engagement_id, kind, body, updated_at")
      .eq("engagement_id", engagementId);

    const businessName = (eng.title ?? eng.project?.name ?? "").trim() || "Operator";
    const text = serializeOperatorProfile({
      businessName,
      operatorName: eng.operator?.display_name ?? null,
      prospectName: eng.project?.prospect_name ?? null,
      prospectEmail: eng.project?.prospect_email ?? null,
      websiteUrl: eng.project?.website_url ?? null,
      linkedinUrl: eng.project?.linkedin_url ?? null,
      context: eng.project?.context ?? null,
      businessContext: (cards ?? []) as BusinessContextCard[],
    });

    await upsertProfileItem(
      admin,
      engagementId,
      builderId,
      "operator",
      `Operator profile — ${businessName}`,
      text
    );
  } catch (err) {
    console.error("[syncOperatorProfileContext]", err);
  }
}
