-- Coach needs read access to client's profile (name)
create policy "coach can read client profile"
  on zane_profiles for select
  using (zane_is_coach_of(id));
