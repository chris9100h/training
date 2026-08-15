# Archived Supabase migrations

These files are historical migrations that were applied to the production
database before the project had a complete, tracked migration history. They are
kept for auditability, but they must not be placed back in `supabase/migrations`.

The active migration directory contains one complete production snapshot:

`../migrations/20260528000000_legacy_schema_baseline.sql`

That snapshot is the bootstrap for Supabase Preview Branches. New schema changes
must be added as new timestamped migrations after it. The archive is not read by
the Supabase GitHub integration or by the repository migration checks.
