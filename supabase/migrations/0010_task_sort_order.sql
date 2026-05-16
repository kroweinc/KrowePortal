alter table tasks add column if not exists sort_order float8 default 0;

update tasks set sort_order = extract(epoch from created_at) where sort_order = 0 or sort_order is null;
