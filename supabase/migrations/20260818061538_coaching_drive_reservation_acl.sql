-- The Storage RLS expression calls this boolean helper as the authenticated
-- client. Keep the reservation table itself service-only.
REVOKE ALL ON FUNCTION public.coaching_drive_photo_reservation_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_drive_photo_reservation_allowed(text, uuid) TO authenticated;
