-- 0126 — RLS/index performance (app audit, advisors 0003 & 0001)
--
-- 1) Wrap bare auth.uid() as (select auth.uid()) in every public-schema RLS
-- policy so Postgres evaluates it once per query instead of once per row
-- (auth_rls_initplan). Semantics are identical. ALTER POLICY is atomic — no
-- window where the policy is absent — and re-parses the expression, so a bad
-- rewrite fails the whole (transactional) migration rather than leaving a
-- broken policy.
do $$
declare r record; nq text; nc text; stmt text;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual like '%auth.uid()%' and qual not like '%select auth.uid()%')
        or (with_check is not null and with_check like '%auth.uid()%' and with_check not like '%select auth.uid()%')
      )
  loop
    nq := regexp_replace(coalesce(r.qual, ''), 'auth\.uid\(\)', '(select auth.uid())', 'g');
    nc := regexp_replace(coalesce(r.with_check, ''), 'auth\.uid\(\)', '(select auth.uid())', 'g');
    stmt := format('alter policy %I on public.%I', r.policyname, r.tablename);
    if r.qual is not null then stmt := stmt || format(' using (%s)', nq); end if;
    if r.with_check is not null then stmt := stmt || format(' with check (%s)', nc); end if;
    execute stmt;
  end loop;
end $$;

-- 2) Cover the foreign keys that had no index (unindexed_foreign_keys). Speeds
-- per-user boot queries and FK cascade checks on delete.
create index if not exists idx_zane_cardio_logs_user_id        on public.zane_cardio_logs(user_id);
create index if not exists idx_zane_cardio_plans_user_id       on public.zane_cardio_plans(user_id);
create index if not exists idx_zane_checkins_client_id         on public.zane_checkins(client_id);
create index if not exists idx_zane_coaching_coach_id          on public.zane_coaching(coach_id);
create index if not exists idx_zane_coaching_macros_coaching_id on public.zane_coaching_macros(coaching_id);
create index if not exists idx_zane_coaching_notes_author_id   on public.zane_coaching_notes(author_id);
create index if not exists idx_zane_coaching_threads_created_by on public.zane_coaching_threads(created_by);
create index if not exists idx_zane_exercises_user_id          on public.zane_exercises(user_id);
create index if not exists idx_zane_meso_states_user_id        on public.zane_meso_states(user_id);
create index if not exists idx_zane_push_subscriptions_user_id on public.zane_push_subscriptions(user_id);
create index if not exists idx_zane_schedule_backups_user_id   on public.zane_schedule_backups(user_id);
create index if not exists idx_zane_schedules_user_id          on public.zane_schedules(user_id);
create index if not exists idx_zane_session_entries_user_id    on public.zane_session_entries(user_id);
create index if not exists idx_zane_sessions_user_id           on public.zane_sessions(user_id);
create index if not exists idx_zane_sets_user_id               on public.zane_sets(user_id);
create index if not exists idx_zane_skips_user_id              on public.zane_skips(user_id);
create index if not exists idx_zane_status_periods_user_id     on public.zane_status_periods(user_id);
create index if not exists idx_zane_workout_templates_user_id  on public.zane_workout_templates(user_id);
