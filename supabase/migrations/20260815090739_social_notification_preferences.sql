-- Friends push preferences and idempotent delivery state.
-- Existing users keep the agreed defaults: direct messages and friend
-- requests on, finished-workout comments and friend-start alerts off.

BEGIN;

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS social_push_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS social_push_friend_requests boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS social_push_finished_comments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS social_push_friend_started boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.zane_user_settings.social_push_messages IS
  'Friends direct and group message push preference; defaults on for existing and new users.';
COMMENT ON COLUMN public.zane_user_settings.social_push_friend_requests IS
  'Friends incoming request push preference; defaults on for existing and new users.';
COMMENT ON COLUMN public.zane_user_settings.social_push_finished_comments IS
  'Push comments and cheers on ended workouts only; defaults off.';
COMMENT ON COLUMN public.zane_user_settings.social_push_friend_started IS
  'Push when an accepted friend starts a workout; defaults off.';

-- Derived delivery state, never user content. The service role is the only
-- writer so client roles cannot suppress or forge notification history.
CREATE TABLE IF NOT EXISTS public.zane_social_notification_deliveries (
  event_key        text NOT NULL,
  recipient_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_kind       text NOT NULL,
  last_attempt_at  timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, recipient_id),
  CONSTRAINT zane_social_notification_deliveries_kind_check
    CHECK (event_kind IN ('message', 'friend_request', 'finished_workout_comment', 'friend_started'))
);

CREATE INDEX IF NOT EXISTS zane_social_notification_deliveries_recipient_idx
  ON public.zane_social_notification_deliveries (recipient_id, delivered_at);

ALTER TABLE public.zane_social_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zane_social_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zane_social_notification_deliveries TO service_role;

COMMIT;
