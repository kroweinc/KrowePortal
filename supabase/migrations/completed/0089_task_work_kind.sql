-- ============================================================
-- Work kind — what a task actually IS, so approval stops assuming code.
--
-- Every approval surface was written for shipped code: the "Deliverable"
-- framing, the branch chips on the done dialog, the commit list. But a real
-- slice of builder work has no branch at all — ask the client a question,
-- send an email, book a call. Those tasks went through the same "attach the
-- end result" dialog and came out reading half-finished.
--
-- work_kind is chosen by the builder in the Submit-for-Approval dialog and
-- drives that dialog's shape: 'code' keeps the branch picker, every other
-- kind swaps it for a plain "what you did" note.
--
-- NULL is legal and means "never asked" — every task that predates this
-- migration, plus anything sent for approval before the chips existed.
-- Readers lay NULL out like 'code' but must NOT render a kind chip for it,
-- otherwise the whole backlog sprouts a label nobody chose.
--
-- No new RLS: the tasks policies are row-level, so they already cover this
-- column for both the builder write and the operator read.
--
-- Keep the allowed values in sync with WORK_KINDS in lib/types.ts.
-- ============================================================

alter table public.tasks
  add column if not exists work_kind text
    check (work_kind in ('code', 'question', 'email', 'other'));

comment on column public.tasks.work_kind is
  'What kind of work this task is: code | question | email | other. Set in the Submit-for-Approval dialog; NULL = never asked (pre-0089 tasks).';
