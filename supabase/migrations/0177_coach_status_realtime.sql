-- 0177_coach_status_realtime.sql
-- app.jsx's isCoachActive effect polls get_coach_clients_status/
-- get_coach_checkin_status every 5s to keep a coach's "client is training now" /
-- "check-in pending" badges live. Add the two underlying tables to the
-- realtime publication so the client can react to pushed changes instead,
-- with the 5s poll kept only as an infrequent fallback (client-side change).
--
-- RLS coach-read policies already exist on both tables — zane_user_settings:
-- "coach can read client settings" (zane_is_coach_of(user_id)); zane_checkins:
-- "checkins_coach_read" — so Realtime's RLS-scoped delivery already restricts
-- a coach to their own active clients' rows, no new policy needed here.
ALTER PUBLICATION supabase_realtime ADD TABLE zane_user_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE zane_checkins;
