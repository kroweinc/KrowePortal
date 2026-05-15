alter table tasks
  add column priority text not null default 'medium'
  check (priority in ('low', 'medium', 'high'));

create index if not exists tasks_priority_idx on tasks(priority);
