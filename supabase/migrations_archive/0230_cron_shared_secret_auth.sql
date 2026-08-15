-- ============================================================================
-- Migration 0230: cron-only shared secret for the reminder/auto-close cron
-- functions
-- ============================================================================
--
-- THE BUG:
-- `reminder`, `water-reminder`, `meal-reminder`, `medication-reminder` and
-- `auto-close-sessions` are meant to be triggered ONLY by pg_cron / the
-- Supabase Dashboard schedule. Before this migration they had no caller
-- authentication of their own, and the cron jobs below called them with the
-- ANON key, the exact same key that ships inside the client app bundle and
-- is trivially extractable by anyone. That made these five functions an
-- open door: any outside party who pulled the anon key out of the app could
-- hit these URLs directly and repeatedly, causing push spam to real users,
-- forcing session-close/session-delete runs, or running up API costs, with
-- no rate limit beyond what pg_cron itself would have applied.
--
-- THE FIX (see the edge function code changes in the same change set as this
-- migration): each of the five functions now requires
-- `Authorization: Bearer <CRON_SECRET>` as the very first check in its
-- handler (after CORS preflight, before any of its normal work), where
-- CRON_SECRET is an edge-function secret. This fails CLOSED: an
-- unset/empty CRON_SECRET rejects every request rather than accidentally
-- allowing it through (see each function's `if (!cronSecret || authHeader
-- !== 'Bearer ' + cronSecret)` check). This mirrors the existing, already-
-- correct pattern in supabase/functions/pushover/index.ts (its
-- `resolveCaller`), simplified: these five functions only ever need to
-- trust a cron-only shared secret, never a human user's session, so there
-- is no user-JWT branch to resolve.
--
-- WHY SUPABASE VAULT, NOT A LITERAL SECRET IN THIS FILE:
-- The migrations this one supersedes (0028/0182/0201/0219) hardcoded the
-- anon key as a literal JWT string directly inside the cron job body. That
-- was fine: anon keys are DESIGNED to be public, shipping inside the client
-- app itself. It would be a much worse security bug to "fix" this by
-- hardcoding the real service-role key, or even the new CRON_SECRET, as a
-- literal string in a migration file instead: migration files live in git
-- history forever, readable by anyone with repo access, and are effectively
-- unredactable after the fact. That would permanently leak a real admin-
-- grade credential into git.
--
-- Instead, this migration uses Supabase Vault. The plaintext secret is
-- never written into any file in this repo. The cron job body references
-- the secret BY NAME and resolves it to plaintext only at execution time,
-- inside the database, via the `vault.decrypted_secrets` view. Only the
-- vault secret NAME ('cron_shared_secret', chosen below) appears in this
-- file, never the value.
--
-- MANUAL STEPS A HUMAN MUST PERFORM (numbered, some before/around this
-- migration, some after):
--
--   1. Generate a long random secret, e.g. from a shell:
--        openssl rand -hex 32
--      Do not paste this value into any file that gets committed. Keep it
--      somewhere safe (password manager / secrets vault of your choice).
--
--   2. Store it ONCE in Supabase Vault, from the SQL editor or psql,
--      BEFORE running this migration (the guard below makes this migration
--      ABORT if the named secret does not exist yet):
--        SELECT vault.create_secret(
--          '<paste the random value from step 1 here, run this yourself, never commit it>',
--          'cron_shared_secret',
--          'Bearer secret used by pg_cron to call reminder / water-reminder / meal-reminder / medication-reminder / auto-close-sessions'
--        );
--
--   3. Set the SAME random string as the CRON_SECRET edge-function secret,
--      on ALL FIVE functions, before or around deploying the Part-1 code
--      changes that check for it:
--        supabase secrets set CRON_SECRET=<the same random value from step 1> --project-ref <ref>
--      (edge function secrets are shared across all functions in a project,
--      so this is one command, but it takes effect for reminder,
--      water-reminder, meal-reminder, medication-reminder AND
--      auto-close-sessions simultaneously.)
--
--   4. auto-close-sessions is NOT scheduled via any in-repo migration (see
--      docs/database.md): per that doc it is configured manually through
--      the Supabase Dashboard's Edge Functions -> Schedule UI. This
--      migration runs inside Postgres and CANNOT reach a Dashboard-managed
--      schedule. A human must manually edit that schedule's HTTP call to
--      add the header `Authorization: Bearer <the same random value from
--      step 1>`. Until that manual edit happens, auto-close-sessions will
--      reject every cron tick with 401 (safe, fails closed, but the
--      feature is effectively paused until this manual step is done).
--
-- JOB NAMES AND SCHEDULES ARE REUSED VERBATIM from the migrations that
-- originally created them (grepped for `cron.schedule` across
-- supabase/migrations/, confirmed no later migration re-scheduled or
-- unscheduled them since); only the Authorization header value changes,
-- from the literal anon-key JWT to the Vault-backed lookup. url and body
-- are unchanged too.
--   'training-reminder'    '* * * * *'     (originally 0028_reminder_cron.sql)
--   'water-reminder'       '*/15 * * * *'  (originally 0182_water_reminder.sql)
--   'meal-reminder'        '0 * * * *'     (originally 0201_meal_reminder.sql)
--   'medication-reminder'  '0 * * * *'     (originally 0219_medication_reminder_cron.sql)
--
-- (0183_water_log_collapse.sql also calls cron.schedule, for a job named
-- 'water-log-collapse' that calls collapse_water_logs() directly via SQL,
-- not net.http_post / an edge function at all. It is unrelated to this bug
-- and intentionally left untouched.)
--
-- FAIL-CLOSED GUARD AT MIGRATION TIME:
-- The DO block immediately below checks that the named vault secret already
-- exists before touching any cron job. If manual step 2 above was skipped,
-- this migration ABORTS LOUDLY (RAISE EXCEPTION) instead of silently
-- installing cron jobs whose Authorization header would resolve to a
-- literal "Bearer " (secret missing -> NULL -> string concatenation with
-- NULL yields NULL -> jsonb_build_object stores a JSON null for that key)
-- at every future run. Even in that failure mode the edge-function side
-- (`authHeader !== 'Bearer ' + cronSecret`) can never treat a NULL/garbaled
-- header as a match, so a missing secret can NEVER accidentally open
-- access, only leave the cron silently non-functional. This guard turns
-- that into a loud failure at apply time instead of a silent runtime one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'
  ) THEN
    RAISE EXCEPTION
      'Vault secret "cron_shared_secret" is missing. Run vault.create_secret(...) with a fresh random value BEFORE applying this migration -- see the numbered manual steps at the top of 0230_cron_shared_secret_auth.sql.';
  END IF;
END $$;

-- training-reminder (originally 0028_reminder_cron.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'training-reminder') THEN
    PERFORM cron.unschedule('training-reminder');
  END IF;
END $$;

SELECT cron.schedule(
  'training-reminder',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- water-reminder (originally 0182_water_reminder.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-reminder') THEN
    PERFORM cron.unschedule('water-reminder');
  END IF;
END $$;

SELECT cron.schedule(
  'water-reminder',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/water-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- meal-reminder (originally 0201_meal_reminder.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meal-reminder') THEN
    PERFORM cron.unschedule('meal-reminder');
  END IF;
END $$;

SELECT cron.schedule(
  'meal-reminder',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/meal-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- medication-reminder (originally 0219_medication_reminder_cron.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'medication-reminder') THEN
    PERFORM cron.unschedule('medication-reminder');
  END IF;
END $$;

SELECT cron.schedule(
  'medication-reminder',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/medication-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- auto-close-sessions: NOT scheduled here. Per docs/database.md it is
-- configured manually via the Supabase Dashboard's Edge Functions -> Schedule
-- UI, so this migration cannot reach or rewrite its header. See manual step 4
-- at the top of this file: a human must add the same
-- `Authorization: Bearer <cron_shared_secret value>` header there by hand.
