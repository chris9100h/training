-- Enable Realtime on zane_sessions for cross-device live sync
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'zane_sessions'
  ) then
    alter publication supabase_realtime add table zane_sessions;
  end if;
end;
$$;
