-- 0128 — Fix the ineffective anon EXECUTE revoke from migration 0125
--
-- 0125's `REVOKE EXECUTE ... FROM anon` on every SECURITY DEFINER function
-- did NOT work: PostgreSQL grants EXECUTE to the PUBLIC pseudo-role by
-- default on function creation, and every role (including anon) inherits
-- through PUBLIC regardless of a role-specific revoke. Verified empirically
-- after this migration was found ineffective: `has_function_privilege('anon',
-- 'find_user_by_email(text)', 'execute')` still returned true.
--
-- The real fix is to revoke from PUBLIC (removing the inherited grant
-- entirely) and re-grant explicitly to `authenticated` for every function
-- client code actually calls — except find_user_by_email, which must stay
-- unreachable by any client role (only invoked internally from within
-- invite_client).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', r.sig);
    if r.sig::text not like 'find_user_by_email(%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
