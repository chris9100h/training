-- Deload week (overlay model). Reuses the existing status_mode mechanism (text
-- column on zane_user_settings + zane_status_periods history) with a new
-- 'deload' value alongside 'sick'/'vacation'. The cycle advances normally during
-- a deload — the overlay only (1) seeds weights at 50%, (2) flags sessions so
-- progression/regression skip them, (3) shows a DELOAD strip, and (4) auto-ends
-- after one week / one cycle / one flex rotation.
--
-- deload_prompt_dismissed_at backs the 8-week "time for a deload?" nudge: it is
-- bumped whenever the user dismisses or acts on the prompt, so it stays quiet
-- for another 8 weeks. Store field: deloadPromptDismissedAt.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS deload_prompt_dismissed_at timestamptz;

-- Marks a session logged during a deload. Excluded from progression seeds and
-- regression detection so a deliberately light week never looks like a decline.
-- Store field: isDeload (stripped from the row when false on sync).
ALTER TABLE zane_sessions
  ADD COLUMN IF NOT EXISTS is_deload boolean NOT NULL DEFAULT false;
