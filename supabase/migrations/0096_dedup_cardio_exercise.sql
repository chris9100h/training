-- Remove duplicate CARDIO exercises per user.
-- Keeps the exercise most referenced in session entries (fallback: alphabetically
-- first id). Caused by a cross-tab race condition in the auto-seed logic where two
-- browser tabs both detected "no cardio exercise" before either had synced to DB.

WITH usage AS (
  SELECT ex_id, COUNT(*) AS cnt
  FROM zane_session_entries
  GROUP BY ex_id
),
cardio_ranked AS (
  SELECT
    e.id,
    e.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY e.user_id
      ORDER BY
        COALESCE(u.cnt, 0) DESC,
        e.id ASC
    ) AS rn
  FROM zane_exercises e
  LEFT JOIN usage u ON u.ex_id = e.id
  WHERE e.movement_type = 'cardio'
)
DELETE FROM zane_exercises
WHERE id IN (
  SELECT id FROM cardio_ranked WHERE rn > 1
);
