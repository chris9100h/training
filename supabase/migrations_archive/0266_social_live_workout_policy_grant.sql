-- Migration 0266: allow the Realtime SELECT policy to call its scoped helper.
-- The helper returns only whether the current caller may view this session;
-- it does not expose workout data by itself.
GRANT EXECUTE ON FUNCTION public.social_can_view_workout_session(text) TO authenticated;
