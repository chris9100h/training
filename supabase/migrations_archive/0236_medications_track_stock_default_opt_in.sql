-- Correction to migration 0235: track_stock should default to false
-- (opt-in), not true. Most medications (vitamins, anything nobody
-- physically counts) were never meant to clutter the Inventory tab by
-- default, only ones someone actually bothers entering a stock count for
-- should show up there. Idempotent regardless of whether 0235 already ran
-- against this database: keeps/sets true only for rows that already have
-- a stock_baseline (someone was clearly already tracking it on purpose,
-- that must not silently get reverted), false for everything else,
-- converging to the same correct end state either way.
ALTER TABLE public.zane_medications
  ALTER COLUMN track_stock SET DEFAULT false;

UPDATE public.zane_medications SET track_stock = false WHERE stock_baseline IS NULL;
