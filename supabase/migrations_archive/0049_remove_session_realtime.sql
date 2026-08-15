-- Cross-device live workout sync was removed. The local store is the single
-- source of truth for an in-progress session, and a coach watches a client's
-- live session via polling (get_active_session_detail), not realtime — so
-- nothing subscribes to zane_sessions changes anymore. Drop it from the
-- realtime publication to stop the unused replication traffic.
--
-- zane_coaching stays in the publication (live coaching invites).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'zane_sessions'
  ) then
    alter publication supabase_realtime drop table zane_sessions;
  end if;
end $$;
