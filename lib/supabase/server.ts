import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

// Bypasses RLS — only for dev mode where there is no real auth session.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: {
        // PostgREST reads go out as plain GETs, which Next both memoizes for the
        // duration of a render and can persist in the Data Cache. That makes a
        // read-after-write inside one render silently return the pre-write rows:
        // the layout and the staging page both read repo_branches, so a branch
        // swept from the cache in between still came back on the second read and
        // rendered as a live branch. A database client must never answer from a
        // cached response — opt out of the Data Cache (`no-store`) and of request
        // memoization (an AbortController signal, the documented escape hatch),
        // while preserving any signal the caller set via `.abortSignal()`.
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            signal: init?.signal ?? new AbortController().signal,
          }),
      },
    }
  );
}

// Memoized per-request: a single render touches the cookie-bound client from the
// layout, the page, and several server actions. Without cache() each call rebuilt
// the client and (via getCurrentProfile) re-hit Supabase auth over the network.
// React.cache() collapses them to one instance per request.
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component — cookie mutations ignored
          }
        },
      },
    }
  );
});
