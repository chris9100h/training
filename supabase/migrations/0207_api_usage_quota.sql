-- Per-user daily quota for the food Edge Functions. Until now auth was the only
-- gate on them: search-foods fans out to two third-party APIs per query, and
-- scan-label / scan-label-claude each accept up to 8 MB of base64 and bill a
-- vision model per call. One account, deliberately or through a stuck retry
-- loop, could run up a real bill unnoticed.
--
-- One row per (user, day, kind), counted up by bump_api_usage below. Nothing
-- reads this in the app, and old rows are simply left to accumulate: at a few
-- rows per active user per day this is small, and keeping them makes it
-- possible to see after the fact what a spike actually was.
--
-- The counter is advisory: the Edge Functions fail OPEN when the RPC errors or
-- is unreachable, so a problem with the quota mechanism itself can never stop
-- someone from logging their food.

create table public.zane_api_usage (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null default current_date,
  kind       text        not null,          -- 'search' | 'scan'
  count      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);

-- RLS on with NO policies, same shape as zane_recipe_shares: the table is
-- reachable only through the SECURITY DEFINER function below, which in turn is
-- granted to service_role alone. No client ever reads or writes it directly,
-- so a client cannot inspect or reset its own quota.
alter table public.zane_api_usage enable row level security;

-- Increments the (user, today, kind) counter and answers whether the call that
-- triggered it is still within p_limit. Returns true on the p_limit-th call and
-- false from p_limit + 1 onwards.
create or replace function public.bump_api_usage(p_user_id uuid, p_kind text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.zane_api_usage (user_id, day, kind, count, updated_at)
  values (p_user_id, current_date, p_kind, 1, now())
  on conflict (user_id, day, kind)
    do update set count = public.zane_api_usage.count + 1, updated_at = now()
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on CREATE FUNCTION, which anon inherits, so
-- the revoke is mandatory (see CLAUDE.md). Deliberately NOT granted to
-- authenticated either: only the Edge Functions, on the service-role key, may
-- move this counter.
revoke execute on function public.bump_api_usage(uuid, text, integer) from public;
grant execute on function public.bump_api_usage(uuid, text, integer) to service_role;
