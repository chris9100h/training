-- Migration 0130 was applied manually.  Keep this after the recorded
-- zane_meso_states/sync migrations so the replacement RPC has its full shape.
ALTER TABLE public.zane_meso_states
  ADD COLUMN IF NOT EXISTS growth_counts jsonb NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.sync_meso_states_batch(p_states jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path TO public
AS $function$
  INSERT INTO public.zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index,
    deltas, joint_flags, pump_low_counts, weight_boosts, growth_counts,
    completions, pending_meso2, updated_at
  )
  SELECT m->>'id', auth.uid(), m->>'schedule_id', (m->>'weeks')::int,
         m->>'start_date', COALESCE((m->>'start_cycle_index')::int, 0),
         COALESCE(m->'deltas', '{}'::jsonb), COALESCE(m->'joint_flags', '{}'::jsonb),
         COALESCE(m->'pump_low_counts', '{}'::jsonb), COALESCE(m->'weight_boosts', '{}'::jsonb),
         COALESCE(m->'growth_counts', '{}'::jsonb), COALESCE((m->>'completions')::int, 0),
         COALESCE((m->>'pending_meso2')::boolean, false), COALESCE((m->>'updated_at')::timestamptz, now())
  FROM jsonb_array_elements(p_states) AS m
  ON CONFLICT (id) DO UPDATE SET
    weeks = EXCLUDED.weeks, start_date = EXCLUDED.start_date,
    start_cycle_index = EXCLUDED.start_cycle_index, deltas = EXCLUDED.deltas,
    joint_flags = EXCLUDED.joint_flags, pump_low_counts = EXCLUDED.pump_low_counts,
    weight_boosts = EXCLUDED.weight_boosts, growth_counts = EXCLUDED.growth_counts,
    completions = EXCLUDED.completions, pending_meso2 = EXCLUDED.pending_meso2,
    updated_at = EXCLUDED.updated_at
  WHERE public.zane_meso_states.updated_at < EXCLUDED.updated_at;
$function$;
