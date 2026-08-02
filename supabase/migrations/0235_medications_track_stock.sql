-- Master on/off for a medication's whole stock-tracking surface: when off,
-- medSheet hides package size's siblings (low_stock_threshold's/
-- exclude_from_low_stock's UI, "Warn when below"/"Cycle only"), and the
-- medication drops out of the Inventory tab's Stock sub-view entirely
-- (not even shown as "Not tracked"), decluttering both for a medication
-- nobody ever intends to count. Package size itself is unaffected, that's
-- still just a container-size fact independent of tracking. Default true:
-- every existing medication keeps behaving exactly as it does today,
-- this is purely an opt-out for the ones nobody wants cluttering the list.
-- The underlying stock_baseline/stock_set_at are untouched by this toggle
-- either way (non-destructive, reversible), unlike clearStockSheet's "Stop
-- tracking" which actually nulls them out.
ALTER TABLE public.zane_medications
  ADD COLUMN track_stock boolean NOT NULL DEFAULT true;
