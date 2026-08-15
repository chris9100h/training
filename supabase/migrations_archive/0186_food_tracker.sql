-- Zane-native macro tracker: a real food database + per-entry logging,
-- replacing/complementing the purely manual daily protein/carbs/fat entry
-- on zane_daily_logs. Two tables:
--
-- zane_foods: a shared/global reference cache, NOT per-user data. Populated
--   only when a user selects a search result to log (never on every search
--   hit, see the search-foods Edge Function), keyed deterministically
--   (source:source_id) so re-selecting the same product upserts instead of
--   duplicating. Sources: Open Food Facts ('off') and USDA FoodData Central
--   ('usda').
-- zane_food_logs: per-user log entries, denormalized at write time (mirrors
--   zane_water_logs). A later refresh of a cached food must never
--   retroactively change a historical entry, same "copy at write time"
--   principle this app already uses elsewhere (e.g. planned_reps on session
--   entries), so every macro value here is the actual logged amount, not a
--   live reference.

CREATE TABLE public.zane_foods (
  id                text PRIMARY KEY,        -- `${source}:${source_id}`, e.g. 'off:3017620422003'
  source            text NOT NULL CHECK (source IN ('off','usda')),
  source_id         text NOT NULL,
  name              text NOT NULL,
  brand             text,
  kcal_per_100g     numeric,
  protein_per_100g  numeric,
  carbs_per_100g    numeric,
  fat_per_100g      numeric,
  fiber_per_100g    numeric,
  serving_size_g    numeric,
  serving_label     text,
  raw               jsonb,                   -- normalized upstream payload snapshot
  cached_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_foods_source_idx ON public.zane_foods (source, source_id);

ALTER TABLE zane_foods ENABLE ROW LEVEL SECURITY;

-- Read-only for every signed-in user (non-sensitive nutrition reference
-- data). Deliberately NO insert/update/delete policy for authenticated or
-- anon: the only writer is the search-foods Edge Function, using the
-- service-role key (bypasses RLS). That function re-fetches the item
-- server-side by id before caching, so a client can never poison the shared
-- cache with fabricated nutrition numbers by calling the table directly.
CREATE POLICY "authenticated read foods"
  ON zane_foods FOR SELECT TO authenticated USING (true);

CREATE TABLE public.zane_food_logs (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         text NOT NULL,           -- YYYY-MM-DD (local day)
  time         text NOT NULL,           -- HH:MM (local time of the entry)
  food_id      text REFERENCES public.zane_foods(id) ON DELETE SET NULL,  -- null for Custom Items
  food_name    text NOT NULL,           -- copied at write time
  brand        text,
  source       text,                    -- 'off' | 'usda' | 'custom' | null
  quantity_g   numeric NOT NULL,
  calories     integer NOT NULL,        -- from the source's own energy value, not derived from macros
  protein      numeric NOT NULL,
  carbs        numeric NOT NULL,
  fat          numeric NOT NULL,
  fiber        numeric,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX zane_food_logs_user_date
  ON zane_food_logs (user_id, date DESC, "time" DESC);

ALTER TABLE zane_food_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own food logs"
  ON zane_food_logs FOR ALL TO public
  USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
CREATE POLICY "coaches read client food logs"
  ON zane_food_logs FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_food_logs.user_id
      AND zc.coach_id = (select auth.uid()) AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));
