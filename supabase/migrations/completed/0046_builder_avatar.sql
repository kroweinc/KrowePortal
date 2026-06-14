-- ============================================================
-- Profile picture for builder profiles.
--
-- Storage: private 'avatars' bucket, created lazily via the Storage API
-- by the upload action (lib/actions/builder-profile.ts). Uploads and
-- deletes go through the admin client after explicit ownership checks,
-- so no storage.objects policies are needed here. Display uses admin
-- signed URLs (same model as resumes).
-- ============================================================

alter table builder_profiles
  add column if not exists avatar_storage_path text;
