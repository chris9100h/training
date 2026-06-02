-- Named conversation threads within a coaching relationship

create table zane_coaching_threads (
  id          text primary key,
  coaching_id text not null references zane_coaching(id) on delete cascade,
  name        text not null,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index on zane_coaching_threads (coaching_id, created_at);

alter table zane_coaching_notes
  add column thread_id text references zane_coaching_threads(id) on delete set null;

create index on zane_coaching_notes (thread_id) where thread_id is not null;

alter table zane_coaching_threads enable row level security;

create policy "threads visible to participants"
  on zane_coaching_threads for select
  using (exists (
    select 1 from zane_coaching c
    where c.id = coaching_id
      and (c.coach_id = auth.uid() or c.client_id = auth.uid())
  ));

create policy "participants can create threads"
  on zane_coaching_threads for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from zane_coaching c
      where c.id = coaching_id
        and c.status = 'active'
        and (c.coach_id = auth.uid() or c.client_id = auth.uid())
    )
  );
