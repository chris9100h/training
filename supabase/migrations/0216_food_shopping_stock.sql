-- Inventory tracking for the Shopping List (screens-food.jsx): a user tells
-- the app "I have 10kg of whey at home", and the client derives the current
-- stock at read time as stock_baseline_g minus everything logged since
-- stock_set_at (fdConsumedSince in screens-food.jsx), rather than
-- decrementing a live counter on every log entry. That would need a hook in
-- every one of the many places a food gets logged (search results, custom
-- items, favorites, recipes, template slots, label scans, ...) and would
-- need a matching undo hook wherever a log entry is edited or deleted.
-- Deriving it from the existing zane_food_logs history instead needs no new
-- write path at all and self-corrects automatically if a log entry changes.
--
-- Both columns are null together (tracking off) or set together (a fresh
-- "as of now" baseline every time the user updates their count).

ALTER TABLE public.zane_food_shopping_prefs
  ADD COLUMN stock_baseline_g numeric,
  ADD COLUMN stock_set_at timestamptz;
