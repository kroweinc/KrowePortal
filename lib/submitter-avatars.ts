import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";

// Resolves the small submitter avatars shown on the task cards. Per profile id:
// the uploaded builder-profile photo (signed URL, 24h — same TTL as the
// builder-identity badge) wins, else the Google account photo that OAuth leaves
// in auth metadata. Ids with neither are omitted so the UI renders initials.

/** Anything that can change a builder's photo revalidates this. */
export const SUBMITTER_AVATAR_TAG = "submitter-avatars";

// Every board resolves the same handful of creator ids to the same URLs, and
// it does so *after* the task query — so uncached it was pure added latency on
// the critical path of every /b/* render: a profile lookup, then a storage
// round trip, then an auth-admin one. An hour is well inside the 24h signed-URL
// TTL, and the two writers that can invalidate a photo bust the tag by hand.
const AVATAR_TTL_SECONDS = 60 * 60;

/**
 * One profile id → its avatar URL, or null when it has neither kind of photo.
 *
 * Cached per id rather than per id-set: callers ask for whatever mix of
 * submitters their page happens to show, and a set-keyed entry would miss every
 * time that mix changed. The admin client is safe in here — it reads no cookies,
 * and its deliberate `no-store` fetch opts out of the *response* cache, which is
 * a layer below the resolved value being cached here.
 */
const resolveAvatar = unstable_cache(
  async (profileId: string): Promise<string | null> => {
    const admin = createAdminClient();

    const { data: row } = await admin
      .from("builder_profiles")
      .select("avatar_storage_path")
      .eq("user_id", profileId)
      .maybeSingle();

    const path = (row?.avatar_storage_path ?? null) as string | null;
    if (path) {
      const { data: signed } = await admin.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 60 * 24);
      if (signed?.signedUrl) return signed.signedUrl;
      // A photo exists and we failed to sign it — a blip, not an answer.
      // Throwing keeps the failure out of the cache; the caller falls back to
      // initials for this render instead of for the next hour.
      throw new Error(`could not sign avatar for ${profileId}`);
    }

    // Google sign-in stores the account photo as `avatar_url` (or `picture` on
    // older records). Dev/synthetic profile ids have no auth user — skip on error.
    const { data, error } = await admin.auth.admin.getUserById(profileId);
    if (error) return null;
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const url = meta.avatar_url ?? meta.picture;
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  },
  ["submitter-avatar"],
  { revalidate: AVATAR_TTL_SECONDS, tags: [SUBMITTER_AVATAR_TAG] }
);

export async function getSubmitterAvatarMap(
  profileIds: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const ids = [...new Set(profileIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return {};

  // Per id, so one unsignable photo costs that one card its picture rather than
  // the whole board its render.
  const resolved = await Promise.all(
    ids.map(async (id) => [id, await resolveAvatar(id).catch(() => null)] as const)
  );

  const map: Record<string, string> = {};
  for (const [id, url] of resolved) if (url) map[id] = url;
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
