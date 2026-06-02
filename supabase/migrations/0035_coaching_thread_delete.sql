-- Allow participants to delete threads (coach or client can close a topic)
create policy "participants can delete threads"
  on zane_coaching_threads for delete
  using (exists (
    select 1 from zane_coaching c
    where c.id = coaching_id
      and (c.coach_id = auth.uid() or c.client_id = auth.uid())
  ));
