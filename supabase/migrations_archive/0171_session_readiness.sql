-- Autoregulation v2 Phase P0: Readiness + Signal-Hygiene.
-- readiness: the session-start one-tap self-report of how the lifter feels.
--   Values: 'fresh' | 'normal' | 'rough' (null = not answered, treated as normal).
-- signal_weight: how much this session counts toward autoregulation learning.
--   Values: 'full' | 'discounted' | 'none' (null = full).
--   'none' is a deload (no earn, no cut, as today), 'discounted' is a rough day
--   or re-entry ramp (still may earn a weight boost, but never advances the
--   rep-miss cut and never pulls MRV down), 'full' is the normal case.
-- Both are nullable text, no default. zane_sessions is written by a direct
-- upsert (store.js sessionToRow), not a batch RPC, so no function re-create.
alter table public.zane_sessions
  add column if not exists readiness text,
  add column if not exists signal_weight text;
