-- ============================================================
-- Rate limit counters — fixed-window request throttling.
--
-- Backs lib/rate-limit.ts. Each (key, window_start) pair is one bucket;
-- check_rate_limit() atomically inserts-or-increments the bucket for the
-- current window and reports whether the caller is still under the limit.
-- Keys are opaque strings the app builds, e.g. "sign:ip:1.2.3.4",
-- "sign:token:<hex>", "ai:user:<uuid>". Writes go through the admin client
-- (service role bypasses RLS) — no insert/update policy by design, same as
-- ai_usage.
--
-- Buckets are self-pruning: each call opportunistically deletes the key's
-- expired rows, so the table stays bounded without a scheduled cleanup job.
-- ============================================================

create table if not exists rate_limits (
  key          text    not null,
  window_start bigint  not null,   -- epoch seconds, truncated to the window
  count        integer not null default 0,
  primary key (key, window_start)
);

-- Backs the inline pruning sweep.
create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;
-- No policies: every read/write is via the service-role admin client, which
-- bypasses RLS. End users never touch this table directly (mirrors ai_usage's
-- "inserts happen through the admin client — no insert policy by design").

-- ------------------------------------------------------------
-- Atomic check-and-increment for a single fixed window.
--   p_key            opaque limiter key
--   p_limit          max requests allowed within the window
--   p_window_seconds window length in seconds
-- Returns: allowed (still under the limit after counting this hit),
-- the current count, and the epoch second the window resets (Retry-After).
--
-- The upsert is one statement under a row lock, so concurrent hits in the
-- same window collide on the PK and increment without a read-modify-write
-- race.
-- ------------------------------------------------------------
create or replace function check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, current_count integer, reset_at bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    bigint := floor(extract(epoch from now()))::bigint;
  v_bucket bigint := v_now - (v_now % p_window_seconds);
  v_count  integer;
begin
  insert into rate_limits (key, window_start, count)
    values (p_key, v_bucket, 1)
  on conflict (key, window_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup: drop this key's stale buckets so the table never
  -- grows unbounded without a cron job.
  delete from rate_limits
   where key = p_key and window_start < v_bucket;

  return query select
    (v_count <= p_limit)          as allowed,
    v_count                       as current_count,
    (v_bucket + p_window_seconds) as reset_at;
end;
$$;
