-- Autoregulate-only plans: run the mesocycle feedback engine (volume/load
-- auto-tuning from in-session soreness/joint/pump answers) indefinitely, with
-- no fixed week count and no RIR taper. mesocycle_rir_enabled already proved
-- the engine's two concerns (RIR taper vs. volume/load autoregulation) are
-- separable; this goes one step further and drops the bounded-block
-- requirement entirely. A bare null on mesocycle_weeks can't mean "on but
-- unbounded" since that field's truthiness is read elsewhere as "this is a
-- bounded block" — same reasoning as migration 0140, this needs its own
-- column rather than an overloaded sentinel.
alter table zane_schedules
  add column if not exists mesocycle_autoregulate boolean not null default false;

-- zane_meso_states.weeks models a mesocycle's fixed length. An autoregulate-only
-- plan's mesoState has no such bound, so weeks must be able to be absent rather
-- than a fabricated number. Existing rows keep their current value untouched.
alter table zane_meso_states
  alter column weeks drop not null;
