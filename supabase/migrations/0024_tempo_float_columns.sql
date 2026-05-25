alter table zane_user_settings
  alter column tempo_eccentric type numeric using tempo_eccentric::numeric,
  alter column tempo_concentric type numeric using tempo_concentric::numeric;
