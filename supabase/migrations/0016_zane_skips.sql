create table if not exists zane_skips (
  id          text        primary key,
  user_id     uuid        references auth.users(id) on delete cascade,
  date        text        not null,
  day_id      text,
  day_name    text,
  skip_reason text,
  skipped_at  timestamptz default now()
);

alter table zane_skips enable row level security;

create policy "own skips"
  on zane_skips
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
