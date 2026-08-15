-- Lets a coach split their own training plans ("My Plans") from plans built
-- to push out to clients ("Client Templates") in the Plan tab. Pure UI bucket
-- flag flipped by a toggle in the plan viewer, no data migration involved.
alter table public.zane_schedules
  add column is_template boolean not null default false;
