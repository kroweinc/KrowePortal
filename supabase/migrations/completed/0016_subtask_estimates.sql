-- ============================================================
-- Subtask time estimates — AI-generated range + actual time logged
-- ============================================================

alter table task_subtasks
  add column ai_est_low_min  integer check (ai_est_low_min  is null or ai_est_low_min  between 1 and 4800),
  add column ai_est_high_min integer check (ai_est_high_min is null or ai_est_high_min between 1 and 4800),
  add column actual_hours    numeric(6,2) check (actual_hours is null or actual_hours >= 0),
  add constraint task_subtasks_est_range_chk
    check (ai_est_high_min is null or ai_est_low_min is null or ai_est_high_min >= ai_est_low_min);
