alter table zane_schedules add column if not exists versions jsonb not null default '[]'::jsonb;
