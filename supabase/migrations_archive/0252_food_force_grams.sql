-- Per-user opt-out: keep the food tracker in grams even when settings.unit
-- is 'lbs'. The global unit picker drives bodyweight/water/food masses
-- together; some imperial users still want the food tracker specifically in
-- grams (US nutrition labels are printed in grams too). Default false so
-- every existing imperial user keeps today's behavior (oz/lb) unless they
-- explicitly opt out.
alter table zane_user_settings
  add column food_force_grams boolean not null default false;
