-- Global "pin all exercise notes" toggle. When on, every exercise with a
-- non-empty note behaves as pinned (the note pops up in a must-acknowledge
-- sheet the first time the exercise becomes active in a session), without
-- having to flip note_pinned on each exercise. The per-exercise note_pinned
-- flag still applies when this is off. Off by default so nothing changes for
-- existing users.
alter table public.zane_user_settings
  add column if not exists pin_all_notes boolean not null default false;
