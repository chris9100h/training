-- Keep the personal progress-photo metadata read-only for authenticated users.
-- RLS and owner-scoped RPCs remain the only client write/delete paths.

REVOKE ALL ON TABLE public.zane_drive_progress_photos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.zane_drive_progress_photos FROM authenticated;
GRANT SELECT ON TABLE public.zane_drive_progress_photos TO authenticated;
