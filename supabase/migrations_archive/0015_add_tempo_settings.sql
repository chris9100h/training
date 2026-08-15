ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS tempo_enabled   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tempo_eccentric int     DEFAULT 4,
  ADD COLUMN IF NOT EXISTS tempo_concentric int    DEFAULT 1;
