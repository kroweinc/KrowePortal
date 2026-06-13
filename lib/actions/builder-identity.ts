import "server-only";

import type { createAdminClient } from "@/lib/supabase/server";

export interface BuilderIdentity {
  name: string;
  avatarUrl: string | null;
  /** Capability token for the published public profile, or null when unpublished. */
  profileToken: string | null;
}

// Resolves the public-facing identity of a document's builder (project owner).
// The avatar storage path never leaves the server — only a signed URL does —
// and the profile capability token is exposed only when the profile is
// published, so an unpublished token never reaches the client.
export async function getBuilderIdentityForOwner(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string | null | undefined,
  fallbackName: string
): Promise<BuilderIdentity> {
  if (!ownerId) return { name: fallbackName, avatarUrl: null, profileToken: null };

  const { data } = await admin
    .from("builder_profiles")
    .select("display_name, avatar_storage_path, is_published, token")
    .eq("user_id", ownerId)
    .maybeSingle();

  if (!data) return { name: fallbackName, avatarUrl: null, profileToken: null };

  // Profile-level override wins; otherwise fall back to the account name.
  const name = data.display_name || fallbackName;

  // Signed inline (not via an exported helper) so callers can never sign
  // arbitrary storage paths. 24h TTL outlives any cached render.
  let avatarUrl: string | null = null;
  if (data.avatar_storage_path) {
    const { data: signed } = await admin.storage
      .from("avatars")
      .createSignedUrl(data.avatar_storage_path, 60 * 60 * 24);
    avatarUrl = signed?.signedUrl ?? null;
  }

  return {
    name,
    avatarUrl,
    profileToken: data.is_published ? data.token : null,
  };
}
