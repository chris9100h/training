-- A missed plan day is one logical row even when two devices boot together.
-- Keep the earliest recorded archive and let the unique key arbitrate future
-- upserts independently of each device's random row id.

-- Hold concurrent client inserts out between the one-time dedupe and unique
-- index creation. SHARE ROW EXCLUSIVE still permits reads and is retained for
-- the remainder of this migration transaction.
LOCK TABLE public.zane_skips IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT skip.id,
         row_number() OVER (
           PARTITION BY skip.user_id, skip.date, skip.day_id
           ORDER BY skip.skipped_at ASC NULLS LAST, skip.id
         ) AS ordinal
  FROM public.zane_skips AS skip
  WHERE skip.user_id IS NOT NULL
    AND skip.day_id IS NOT NULL
)
DELETE FROM public.zane_skips AS skip
USING ranked
WHERE skip.id = ranked.id
  AND ranked.ordinal > 1;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.zane_skips'::regclass
      AND conname = 'zane_skips_user_date_day_key'
      AND contype = 'u'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS zane_skips_user_date_day_unique
      ON public.zane_skips (user_id, date, day_id);

    ALTER TABLE public.zane_skips
      ADD CONSTRAINT zane_skips_user_date_day_key
      UNIQUE USING INDEX zane_skips_user_date_day_unique;
  END IF;
END
$migration$;
