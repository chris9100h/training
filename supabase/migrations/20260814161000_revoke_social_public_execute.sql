-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Keep every guarded
-- Social mutation authenticated-only; the app_private implementations are
-- internal trigger/RPC helpers and are already revoked separately.

REVOKE EXECUTE ON FUNCTION public.social_add_workout_comment(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_block_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_create_group(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_create_group_plan_share(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_create_plan_share(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_delete_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_delete_plan_share(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_join_group(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_leave_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_mark_plan_imported(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_remove_friend(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_report(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_respond_friend_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_send_friend_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_update_metric_preferences(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean, jsonb, jsonb) FROM PUBLIC, anon;
