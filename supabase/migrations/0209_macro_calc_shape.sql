-- Comment-only follow-up to 0205. The macro-target estimator grew three inputs
-- that it now persists alongside the rest of the form, so the column comment
-- (the description a reader gets straight from the database) was out of date:
--
--   weightKg  fallback bodyweight for anyone who has never logged one. A weight
--             from the daily log still wins whenever there is one, so the
--             estimate keeps tracking a changing weight by itself; this is only
--             what the form falls back to.
--   lowFat    whether the low-fat option is on.
--   fatPerKg  its factor, in g of fat per kg of bodyweight (shown converted to
--             g per lb for lbs users, stored per kg either way).
--
-- No schema change: macro_calc is jsonb and was always read and written whole.

comment on column zane_user_settings.macro_calc is
  'Last inputs of the macro-target estimator: {birthYear, heightCm, sex, activity, goal, rateKgPerWeek, trainingDays, weightKg, lowFat, fatPerKg}. Prefill only, the computed result lives in macro_targets. weightKg is a fallback, a logged bodyweight wins over it.';
