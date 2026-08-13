-- Migration 0281: the RLS policy helper must be executable by authenticated
-- requests because PostgreSQL checks function privileges while evaluating it.

GRANT EXECUTE ON FUNCTION public.social_group_visible(uuid, uuid) TO authenticated;
