create table zane_coaching_macros (
  id text primary key,
  coaching_id text not null references zane_coaching(id) on delete cascade,
  set_by uuid not null,
  set_at timestamptz not null default now(),
  calories_training int,
  protein_training int,
  carbs_training int,
  fat_training int,
  calories_rest int,
  protein_rest int,
  carbs_rest int,
  fat_rest int
);

alter table zane_coaching_macros enable row level security;

create policy "Coach can manage macros"
  on zane_coaching_macros for all
  using (
    exists (
      select 1 from zane_coaching
      where id = coaching_id and coach_id = auth.uid()
    )
  );

create policy "Client can read macros"
  on zane_coaching_macros for select
  using (
    exists (
      select 1 from zane_coaching
      where id = coaching_id and client_id = auth.uid()
    )
  );
