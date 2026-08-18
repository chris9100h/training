-- Cover the foreign keys used by the Drive outbox, photo cleanup and OAuth
-- state rotation.  These are small tables today, but the indexes keep coach
-- disconnects, check-in deletes and the janitor bounded as history grows.

CREATE INDEX IF NOT EXISTS idx_coaching_drive_exports_checkin
  ON public.zane_coaching_drive_exports(checkin_id);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_exports_client
  ON public.zane_coaching_drive_exports(client_id);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_exports_coaching
  ON public.zane_coaching_drive_exports(coaching_id);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_oauth_states_coach
  ON public.zane_coaching_drive_oauth_states(coach_id);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photos_client
  ON public.zane_coaching_drive_photos(client_id);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photos_coaching
  ON public.zane_coaching_drive_photos(coaching_id);
