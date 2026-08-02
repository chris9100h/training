-- Per-medication opt-out from the Running Low warning, while keeping stock
-- tracking itself fully on (unlike clearStockSheet's "Stop tracking",
-- which drops the tracked count entirely): a compound being run for one
-- cycle with no intent to reorder still benefits from seeing exactly how
-- much is left, it just doesn't need the reorder nag. Surfaced in the UI
-- as "Cycle only" (medSheet), the column itself stays named after the
-- mechanism, same style as exclude_from_pillbox (migration 0223). Default
-- false so existing tracked medications keep warning exactly as before.
ALTER TABLE public.zane_medications
  ADD COLUMN exclude_from_low_stock boolean NOT NULL DEFAULT false;
