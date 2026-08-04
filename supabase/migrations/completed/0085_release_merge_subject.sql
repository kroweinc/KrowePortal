-- 0085 — releases.merge_subject
--
-- What a release *was* is currently unanswerable from the timeline. A release
-- carries branch_name and merge_sha, but Phase 7 (0084 follow-up) re-keyed
-- detection to the default branch's tip sha, and only a merge commit names a
-- branch — a plain push to main leaves branch_name null. Those releases render
-- as a date and a seven-character sha, which says when something shipped but
-- never what it was.
--
-- The merge commit's subject line is exactly that missing sentence
-- ("Merge branch 'AgentPDF' into dev", "fix(email): stop copying the firm
-- inbox"). It is already fetched on every push detection — getDefaultBranchTip
-- returns the full message — and thrown away after parseMergedBranch reads the
-- branch out of it. Storing it costs nothing at write time and is the label the
-- Shipped timeline shows.
--
-- Denormalized on purpose: a release must stay readable long after the commit
-- is unreachable (repo disconnected, token revoked, branch deleted, history
-- rewritten). The sha remains the identity; this is the human-facing name.

alter table releases
  add column if not exists merge_subject text;

-- Subjects are one line. git soft-wraps at 72 and GitHub truncates at 72, but
-- squash merges routinely produce longer ones, so the cap is generous and only
-- exists to keep a whole commit body from being stored as a "subject".
alter table releases
  drop constraint if exists releases_merge_subject_len;
alter table releases
  add constraint releases_merge_subject_len
    check (merge_subject is null or length(btrim(merge_subject)) between 1 and 300);

comment on column releases.merge_subject is
  'First line of the merge/push commit message, captured at detection. Display '
  'label for the push on the Shipped timeline; falls back to branch_name, then '
  'the ship date. Null for manual releases and for rows created before 0085.';
