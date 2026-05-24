alter table tasks add column pushed_to_main boolean not null default false;
alter table tasks add column completion_note text;
alter table tasks add column completed_at timestamptz;
