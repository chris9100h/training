-- Inputs of the "Estimate targets" wizard (MacroTargetSheet, screens-health.jsx),
-- so reopening it starts from what the user last answered instead of an empty
-- form every time. The wizard writes its RESULT into the existing
-- zane_user_settings.macro_targets like any hand-typed target; this column only
-- remembers how that result was arrived at.
--
-- Deliberately one jsonb rather than six columns: it is a single form's state,
-- read and written as a unit, never queried by field, and the set of questions
-- is likely to change (the estimate is a heuristic, not a contract).
--
-- Shape: { birthYear, heightCm, sex, activity, goal, rateKgPerWeek }
--   sex          'male' | 'female' | null   (the Mifflin-St Jeor constants)
--   activity     'sedentary' | 'light' | 'moderate' | 'high' | 'athlete'
--   goal         'cut' | 'maintain' | 'gain'
-- Weight is NOT stored here: it comes from the latest daily log, so the estimate
-- always reflects the current bodyweight rather than whatever it was when the
-- wizard was last opened.

alter table zane_user_settings
  add column macro_calc jsonb;

comment on column zane_user_settings.macro_calc is
  'Last inputs of the macro-target estimator: {birthYear, heightCm, sex, activity, goal, rateKgPerWeek}. Prefill only, the computed result lives in macro_targets.';
