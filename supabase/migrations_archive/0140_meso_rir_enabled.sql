-- Mesocycle RIR taper on/off switch.
-- Some lifters don't program by Reps-in-Reserve at all. When false, the meso
-- still runs on volume (delta) auto-regulation + load progression + deload, but
-- the weekly RIR target watermark and the negative-RIR lengthened-partials
-- prescription are suppressed. Default true preserves existing behaviour; a bare
-- null can't mean "off" because the app falls back to 3/0, so this needs its own
-- column.
alter table zane_schedules
  add column if not exists mesocycle_rir_enabled boolean not null default true;
