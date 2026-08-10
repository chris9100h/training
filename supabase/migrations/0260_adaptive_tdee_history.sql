-- Adaptive TDEE history (migration 0260).
-- The estimate itself is reproducible from zane_daily_logs, but the decision
-- made for that estimate must survive the next weekly check-in. This table
-- stores one calculation endpoint per user and keeps the accepted target
-- snapshot next to it.

CREATE TABLE public.zane_adaptive_tdee_history (
  id                  text PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  as_of_date          date NOT NULL,
  window_start        date NOT NULL,
  window_end          date NOT NULL,
  tdee_kcal           integer NOT NULL,
  avg_calories_kcal   integer NOT NULL,
  weight_start_kg     numeric NOT NULL,
  weight_end_kg       numeric NOT NULL,
  weight_change_kg    numeric NOT NULL,
  weight_rate_kg_week numeric NOT NULL,
  day_span            integer NOT NULL CHECK (day_span > 0),
  calorie_days        integer NOT NULL CHECK (calorie_days > 0),
  weigh_ins           integer NOT NULL CHECK (weigh_ins > 1),
  decision            text NOT NULL DEFAULT 'reconstructed'
    CHECK (decision IN ('applied', 'skipped', 'reconstructed')),
  source              text NOT NULL DEFAULT 'reconstructed'
    CHECK (source IN ('live', 'reconstructed')),
  targets_snapshot    jsonb,
  calculated_at       timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, as_of_date)
);

CREATE INDEX zane_adaptive_tdee_history_user_idx
  ON public.zane_adaptive_tdee_history USING btree (user_id, as_of_date DESC);

ALTER TABLE public.zane_adaptive_tdee_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_adaptive_tdee_history_own"
  ON public.zane_adaptive_tdee_history FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- PostgREST does not automatically expose newly created public tables. Keep
-- this table owner-only at the Data API boundary as well as at RLS level.
REVOKE ALL ON public.zane_adaptive_tdee_history FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zane_adaptive_tdee_history TO authenticated;

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_adaptive_tdee_history;
CREATE TRIGGER zane_guard_user_id
  BEFORE UPDATE ON public.zane_adaptive_tdee_history
  FOR EACH ROW EXECUTE FUNCTION public.zane_guard_user_id_immutable();
