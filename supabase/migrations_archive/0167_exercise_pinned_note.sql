-- Pinned exercise note: when set, the exercise's setup note pops up and must be
-- acknowledged the first time the exercise becomes active in a session, every
-- workout (a "did you read your own note" reminder for setup-heavy lifts). A
-- per-exercise toggle next to the note in the exercise editor drives it. Off by
-- default so existing exercises keep their quiet notes.
alter table public.zane_exercises
  add column if not exists note_pinned boolean not null default false;
