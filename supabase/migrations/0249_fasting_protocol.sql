-- Intermittent fasting protocol (Zero/Fastic style timer).
-- Nullable text on zane_user_settings: one of the client-side preset ids
-- '16:8' | '18:6' | '20:4' | 'omad' (hours mapped in store.js
-- FD_FASTING_PRESETS), null = feature off. Only the PREFERENCE syncs; the
-- running fast itself is device-local (localStorage key
-- logbook-fasting-state, cooking-draft pattern), so no new table and no RPC.
-- Old clients select * and simply ignore the extra column.

ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS fasting_protocol text;
