-- Let an active coach preview a still-staged check-in photo in the dashboard.
-- Once the Drive worker succeeds it removes the private staging object and the
-- dashboard uses the durable Drive link stored on the photo metadata row.

DROP POLICY IF EXISTS coaching_drive_stage_read ON storage.objects;
CREATE POLICY coaching_drive_stage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'coaching-drive-staging'
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR EXISTS (
        SELECT 1
        FROM public.zane_coaching_drive_photos p
        JOIN public.zane_coaching c ON c.id = p.coaching_id
        WHERE p.staging_path = name
          AND p.status IN ('staged', 'uploaded')
          AND c.coach_id = (select auth.uid())
          AND c.status = 'active'
          AND c.id NOT LIKE 'support_%'
      )
    )
  );
