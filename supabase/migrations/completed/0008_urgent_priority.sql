alter table tasks drop constraint tasks_priority_check;
alter table tasks add constraint tasks_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));
