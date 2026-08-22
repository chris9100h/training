-- Serialize stale-session reconciliation at the database boundary. The Edge
-- sweeper gets a complete action result from one transaction, while boot can
-- only delete a caller-owned orphan after the database proves it is empty.

CREATE OR REPLACE FUNCTION public.sweep_stale_session(
  p_session_id text,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.zane_sessions%ROWTYPE;
  v_settings public.zane_user_settings%ROWTYPE;
  v_has_settings boolean := false;
  v_last_set_at timestamptz;
  v_has_sets boolean := false;
  v_last_activity timestamptz;
  v_timeout_minutes integer := 90;
  v_is_tracked boolean := false;
  v_duration_minutes integer;
  v_is_cleanup boolean := false;
BEGIN
  IF p_session_id IS NULL OR p_now IS NULL THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  SELECT s.*
  INTO v_session
  FROM public.zane_sessions AS s
  WHERE s.id = p_session_id
    AND s.ended IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  SELECT settings.*
  INTO v_settings
  FROM public.zane_user_settings AS settings
  WHERE settings.user_id = v_session.user_id
  FOR UPDATE;
  v_has_settings := FOUND;

  IF v_has_settings THEN
    v_timeout_minutes := greatest(1, coalesce(v_settings.session_timeout_minutes, 90));
    v_is_tracked := v_settings.in_progress_session_id = v_session.id;
  END IF;

  SELECT max(sets.updated_at), count(*) > 0
  INTO v_last_set_at, v_has_sets
  FROM public.zane_sets AS sets
  WHERE sets.session_id = v_session.id;

  v_last_activity := coalesce(v_last_set_at, v_session.started_at);
  IF v_last_activity IS NULL
     OR v_last_activity > p_now
     OR v_last_activity > p_now - make_interval(mins => v_timeout_minutes)
  THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  IF NOT v_has_sets THEN
    DELETE FROM public.zane_sessions
    WHERE id = v_session.id
      AND ended IS NULL;

    IF v_has_settings AND v_is_tracked THEN
      UPDATE public.zane_user_settings
      SET in_progress_session_id = NULL
      WHERE user_id = v_session.user_id
        AND in_progress_session_id = v_session.id;
    END IF;

    RETURN jsonb_build_object(
      'action', 'deleted',
      'session_id', v_session.id,
      'user_id', v_session.user_id,
      'is_tracked', v_is_tracked
    );
  END IF;

  IF v_session.started_at IS NOT NULL THEN
    v_duration_minutes := greatest(
      0,
      round(extract(epoch FROM (v_last_activity - v_session.started_at)) / 60.0)::integer
    );
  END IF;
  v_is_cleanup := v_has_settings
    AND v_settings.status_mode = 'cleanup'
    AND v_settings.status_mode_since IS NOT NULL
    AND v_settings.status_mode_since <= p_now
    AND v_session.started_at IS NOT NULL
    AND v_session.started_at >= v_settings.status_mode_since;

  UPDATE public.zane_sessions
  SET ended = v_last_activity,
      duration_minutes = coalesce(v_duration_minutes, duration_minutes),
      is_cleanup = CASE WHEN v_is_cleanup THEN true ELSE is_cleanup END
  WHERE id = v_session.id
    AND ended IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  IF v_has_settings AND v_is_tracked THEN
    UPDATE public.zane_user_settings
    SET in_progress_session_id = NULL,
        auto_close_notify = jsonb_build_object(
          'dayName', coalesce(nullif(v_session.day_name, ''), 'Session'),
          'date', left(coalesce(v_session.date::text, ''), 10),
          'durationMinutes', to_jsonb(v_duration_minutes)
        )
    WHERE user_id = v_session.user_id
      AND in_progress_session_id = v_session.id;
  END IF;

  RETURN jsonb_build_object(
    'action', 'closed',
    'session_id', v_session.id,
    'user_id', v_session.user_id,
    'is_tracked', v_is_tracked,
    'duration_minutes', v_duration_minutes,
    'timeout_minutes', v_timeout_minutes,
    'push_enabled', coalesce(v_settings.push_enabled, false),
    'use_pushover', coalesce(v_settings.use_pushover, false),
    'pushover_user_key', v_settings.pushover_user_key
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_empty_orphan_session(p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id text;
BEGIN
  IF v_uid IS NULL OR p_session_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT session.id
  INTO v_session_id
  FROM public.zane_sessions AS session
  WHERE session.id = p_session_id
    AND session.user_id = v_uid
    AND session.ended IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.zane_user_settings AS settings
  WHERE settings.user_id = v_uid
  FOR UPDATE;

  DELETE FROM public.zane_sessions AS session
  WHERE session.id = v_session_id
    AND session.user_id = v_uid
    AND session.ended IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_user_settings AS settings
      WHERE settings.user_id = v_uid
        AND settings.in_progress_session_id = session.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_session_entries AS entry
      WHERE entry.session_id = session.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_sets AS sets
      WHERE sets.session_id = session.id
    );
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_session(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_session(text, timestamptz)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_empty_orphan_session(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_empty_orphan_session(text)
  TO authenticated;
