-- ============================================================
-- Agents Control Center — durable run phase + liveness (parallel agents).
--
-- Parallel agent runs surface as a floating dock of progress rings, one per
-- in-flight run. Each ring fills through the real phases the turn engine emits
-- (reading context → searching → composing → done), so the phase has to be
-- durable — any client (even after a full refresh, or one that never opened the
-- SSE) reads it off the run. `last_event_at` is a liveness heartbeat: deltas
-- aren't persisted until the terminal message, so `updated_at` alone can't tell
-- a still-composing run from a crashed one — the stale sweep needs this.
--
-- Additive + idempotent (every statement `if not exists`), so re-running is
-- safe. New columns inherit agent_runs' existing builder-only RLS (0076).
-- ============================================================

alter table agent_runs
  add column if not exists phase text
    check (phase is null or phase in ('reading','searching','composing','done','error'));

alter table agent_runs
  add column if not exists last_event_at timestamptz;

-- The dock query is builder-scoped (all of a builder's in-flight runs across
-- every client); the existing index is engagement-scoped, so it can't serve it.
create index if not exists agent_runs_builder_active_idx
  on agent_runs (builder_id, updated_at desc);
