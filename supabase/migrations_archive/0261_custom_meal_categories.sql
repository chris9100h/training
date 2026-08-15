-- User-defined Food Tracker meal categories (migration 0261).
--
-- The legacy meal_windows column remains for older clients and carries only
-- six start hours. New clients use this richer nullable JSONB shape instead:
-- [{"id":"breakfast","label":"Breakfast","startHour":0}, ...]
--
-- The application validates unique ids, non-empty labels, ascending hours and
-- a first start hour of 0 before it uses the value. Null keeps the built-in
-- categories and also preserves the legacy meal_windows fallback.

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS meal_categories jsonb;

COMMENT ON COLUMN public.zane_user_settings.meal_categories IS
  'User-defined Food Tracker categories as [{id, label, startHour}], first startHour always 0 and later startHours strictly ascending; null = built-in categories or legacy meal_windows fallback.';
