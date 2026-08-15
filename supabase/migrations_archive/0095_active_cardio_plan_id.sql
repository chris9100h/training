alter table zane_user_settings
  add column if not exists active_cardio_plan_id text default null;
