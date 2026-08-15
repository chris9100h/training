-- Migration 0031: add zane_session_entries and zane_sets tables
-- Relational replacement for the entries JSONB column on zane_sessions.
-- Dual-write strategy: JSONB is still written for Realtime; new tables are authoritative.

-- ─── zane_session_entries ────────────────────────────────────────────────────

CREATE TABLE zane_session_entries (
  id            text        PRIMARY KEY,
  session_id    text        NOT NULL REFERENCES zane_sessions(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  entry_idx     int         NOT NULL,
  ex_id         text,
  name          text        NOT NULL DEFAULT '',
  planned_sets  int,
  planned_reps  int,
  note          text        NOT NULL DEFAULT '',
  superset_group text,
  UNIQUE (session_id, entry_idx)
);

CREATE INDEX zane_session_entries_session_id_idx ON zane_session_entries (session_id);

ALTER TABLE zane_session_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY zane_session_entries_rls ON zane_session_entries
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── zane_sets ───────────────────────────────────────────────────────────────

CREATE TABLE zane_sets (
  id          text        PRIMARY KEY,
  session_id  text        NOT NULL,
  entry_id    text        NOT NULL REFERENCES zane_session_entries(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_idx     int         NOT NULL,
  kg          numeric,
  reps        int,
  reps_l      int,
  reps_r      int,
  done        boolean     NOT NULL DEFAULT false,
  skipped     boolean     NOT NULL DEFAULT false,
  warmup      boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, set_idx)
);

CREATE INDEX zane_sets_entry_id_idx ON zane_sets (entry_id);

ALTER TABLE zane_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY zane_sets_rls ON zane_sets
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── sync_sets_batch RPC ─────────────────────────────────────────────────────
-- Batch-upsert sets with an updated_at guard: only overwrites a row when the
-- incoming timestamp is strictly newer than what is already stored.

CREATE OR REPLACE FUNCTION sync_sets_batch(p_sets jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r,
    done, skipped, warmup, updated_at
  )
  SELECT
    s->>'id',
    s->>'session_id',
    s->>'entry_id',
    auth.uid(),
    (s->>'set_idx')::int,
    (s->>'kg')::numeric,
    (s->>'reps')::int,
    (s->>'reps_l')::int,
    (s->>'reps_r')::int,
    COALESCE((s->>'done')::boolean,    false),
    COALESCE((s->>'skipped')::boolean, false),
    COALESCE((s->>'warmup')::boolean,  false),
    (s->>'updated_at')::timestamptz
  FROM jsonb_array_elements(p_sets) AS s
  ON CONFLICT (id) DO UPDATE SET
    kg         = EXCLUDED.kg,
    reps       = EXCLUDED.reps,
    reps_l     = EXCLUDED.reps_l,
    reps_r     = EXCLUDED.reps_r,
    done       = EXCLUDED.done,
    skipped    = EXCLUDED.skipped,
    warmup     = EXCLUDED.warmup,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$$;

-- ─── Data migration: populate new tables from existing JSONB ─────────────────

INSERT INTO zane_session_entries (
  id, session_id, user_id,
  entry_idx, ex_id, name,
  planned_sets, planned_reps, note, superset_group
)
SELECT
  s.id || '_e' || (e.ordinality - 1),
  s.id,
  s.user_id,
  (e.ordinality - 1)::int,
  e.val->>'exId',
  COALESCE(e.val->>'name', ''),
  (e.val->>'plannedSets')::int,
  (e.val->>'plannedReps')::int,
  COALESCE(e.val->>'note', ''),
  NULLIF(e.val->>'supersetGroup', '')
FROM zane_sessions s
CROSS JOIN LATERAL jsonb_array_elements(s.entries) WITH ORDINALITY AS e(val, ordinality)
WHERE s.entries IS NOT NULL
  AND jsonb_typeof(s.entries) = 'array'
  AND jsonb_array_length(s.entries) > 0
ON CONFLICT DO NOTHING;

INSERT INTO zane_sets (
  id, session_id, entry_id, user_id,
  set_idx, kg, reps, reps_l, reps_r,
  done, skipped, warmup, updated_at
)
SELECT
  s.id || '_e' || (e.ordinality - 1) || '_s' || (st.ordinality - 1),
  s.id,
  s.id || '_e' || (e.ordinality - 1),
  s.user_id,
  (st.ordinality - 1)::int,
  (st.val->>'kg')::numeric,
  (st.val->>'reps')::int,
  (st.val->>'repsL')::int,
  (st.val->>'repsR')::int,
  COALESCE((st.val->>'done')::boolean,    false),
  COALESCE((st.val->>'skipped')::boolean, false),
  COALESCE((st.val->>'warmup')::boolean,  false),
  COALESCE(s.ended, now())
FROM zane_sessions s
CROSS JOIN LATERAL jsonb_array_elements(s.entries) WITH ORDINALITY AS e(val, ordinality)
CROSS JOIN LATERAL jsonb_array_elements(e.val->'sets') WITH ORDINALITY AS st(val, ordinality)
WHERE s.entries IS NOT NULL
  AND jsonb_typeof(s.entries) = 'array'
  AND jsonb_array_length(s.entries) > 0
  AND e.val->'sets' IS NOT NULL
  AND jsonb_typeof(e.val->'sets') = 'array'
  AND jsonb_array_length(e.val->'sets') > 0
ON CONFLICT DO NOTHING;
