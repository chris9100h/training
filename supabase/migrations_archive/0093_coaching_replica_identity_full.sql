-- Enable REPLICA IDENTITY FULL on zane_coaching so that Realtime DELETE
-- events include all old column values. Without this, the client_id /
-- coach_id filter on the Realtime subscription can't match DELETE events
-- (Postgres only includes the primary key in the old record by default),
-- meaning users never receive real-time notification when a ticket is deleted.
ALTER TABLE zane_coaching REPLICA IDENTITY FULL;
