create policy "tasks_delete" on tasks
  for delete using (is_engagement_member(engagement_id));
