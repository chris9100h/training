-- Food Tracker log entries remember which unit (e.g. "Pc") they were actually
-- logged in, not just the resolved gram amount. Previously the split-into-
-- multiple-meals feature (and anything else wanting a "count" view of an
-- entry) had to guess by falling back to the first unit defined on a
-- matching favorite, which is wrong once a favorite has more than one unit or
-- no favorite exists at all. Nullable and legacy-safe: absent on any entry
-- logged before this column existed, or logged in plain grams.
alter table zane_food_logs
  add column logged_unit jsonb;

comment on column zane_food_logs.logged_unit is
  'Unit the entry was logged in, {label, grams}, or null when logged in grams/kcal directly.';
