alter table github_connections
  add column if not exists selected_repo_full_name      text,
  add column if not exists selected_repo_id             bigint,
  add column if not exists selected_repo_name           text,
  add column if not exists selected_repo_owner          text,
  add column if not exists selected_repo_default_branch text;
