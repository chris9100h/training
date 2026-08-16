-- A weekly TDEE check-in can be accepted as a useful measurement without
-- replacing the user's current macro targets.
ALTER TABLE public.zane_adaptive_tdee_history
  DROP CONSTRAINT IF EXISTS zane_adaptive_tdee_history_decision_check;

ALTER TABLE public.zane_adaptive_tdee_history
  ADD CONSTRAINT zane_adaptive_tdee_history_decision_check
  CHECK (decision = ANY (ARRAY[
    'applied'::text,
    'kept'::text,
    'skipped'::text,
    'reconstructed'::text
  ]));
