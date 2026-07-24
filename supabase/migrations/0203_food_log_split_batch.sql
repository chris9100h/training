-- Persists the "split into multiple meals" undo across sessions/devices,
-- not just the 6-second toast right after applying it. Every entry a split
-- creates carries the same split_batch: {id, removedEntries}, removedEntries
-- being the exact pre-split entries (same shape restored verbatim, not
-- recomputed). Redundant on every sibling entry on purpose: as long as any
-- one entry from the batch still exists, the split can still be undone even
-- if the others were edited/moved/deleted individually since. Nullable and
-- legacy-safe: absent on any entry logged directly (not from a split) or
-- logged before this column existed.
alter table zane_food_logs
  add column split_batch jsonb;

comment on column zane_food_logs.split_batch is
  '{id, removedEntries} for an entry created by "split into multiple meals"; removedEntries is the exact pre-split entries to restore on undo. Null for entries not from a split.';
