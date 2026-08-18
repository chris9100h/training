-- The explicit post-trigger revoke is also kept as a standalone repair so a
-- branch that already applied 090000/090500 gets the same fail-closed ACL.
REVOKE ALL ON FUNCTION public.claim_coaching_drive_exports(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_export() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_guard() FROM PUBLIC, anon, authenticated;
