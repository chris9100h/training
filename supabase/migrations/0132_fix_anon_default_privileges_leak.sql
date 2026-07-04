-- Fixes a project-level default-privileges rule discovered while shipping
-- Migration 0131: `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO
-- anon` grants anon direct EXECUTE on every NEWLY created function in
-- `public`, regardless of `REVOKE EXECUTE ... FROM PUBLIC` (that revoke only
-- removes PUBLIC-inherited access, not an explicit direct grant to anon from
-- a default-privileges rule). Verified empirically: 0131's two new
-- functions (get_force_update_nonce, admin_force_update), despite an
-- explicit REVOKE FROM PUBLIC, still had has_function_privilege('anon', ...)
-- = true, while every pre-existing SECURITY DEFINER function correctly
-- showed false — the "Grant-Falle" note in CLAUDE.md (Migration 0125/0128)
-- only covers the PUBLIC-inheritance path, not this one.
--
-- 1. Immediate fix: explicitly revoke anon's leaked access on 0131's functions.
-- 2. Root-cause fix: remove the default-privileges rule for anon so this
--    can't silently reopen for any future new function. authenticated/
--    service_role keep their default grant — harmless, since the existing
--    convention already explicitly (re-)grants authenticated per function.
--
-- NOTE: the `supabase_admin` role has the same default-ACL entry, but
-- altering its default privileges requires a permission this project's
-- migration role doesn't have ("permission denied to change default
-- privileges"). The project's actual migration path is confirmed to run as
-- `postgres` (fixing that role's default ACL closed the leak), so this is
-- left as a known, currently-unreachable gap rather than something to chase
-- further.

REVOKE EXECUTE ON FUNCTION public.get_force_update_nonce() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_force_update() FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
