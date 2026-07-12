import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

// Resolves the small submitter avatars shown on the task cards. Per profile id:
// the uploaded builder-profile photo (signed URL, 24h — same TTL as the
// builder-identity badge) wins, else the Google account photo that OAuth leaves
// in auth metadata. Ids with neither are omitted so the UI renders initials.

export async function getSubmitterAvatarMap(
  profileIds: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const ids = [...new Set(profileIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return {};

  const admin = createAdminClient();
  const map: Record<string, string> = {};

  const { data: rows } = await admin
    .from("builder_profiles")
    .select("user_id, avatar_storage_path")
    .in("user_id", ids)
    .not("avatar_storage_path", "is", null);

  await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data: signed } = await admin.storage
        .from("avatars")
        .createSignedUrl(row.avatar_storage_path as string, 60 * 60 * 24);
      if (signed?.signedUrl) map[row.user_id as string] = signed.signedUrl;
    })
  );

  // Google sign-in stores the account photo as `avatar_url` (or `picture` on
  // older records). Dev/synthetic profile ids have no auth user — skip on error.
  await Promise.all(
    ids
      .filter((id) => !map[id])
      .map(async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error) return;
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const url = meta.avatar_url ?? meta.picture;
        if (typeof url === "string" && /^https?:\/\//.test(url)) map[id] = url;
      })
  );

  return map;
}

/** Merges a resolved avatar map into each task's joined `creator`. */
export function attachCreatorAvatars<
  T extends { created_by: string; creator?: { avatar_url?: string | null } | null }
>(tasks: T[], avatars: Record<string, string>): T[] {
  return tasks.map((task) =>
    task.creator
      ? { ...task, creator: { ...task.creator, avatar_url: avatars[task.created_by] ?? null } }
      : task
  );
}
