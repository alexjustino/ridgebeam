-- Ridgebeam — work migration 009: replanning, and baselines that remember
-- stages and money.
--
-- Slice F8. An approved plan is locked until somebody says why it changes;
-- the "why" is a row, and the next baseline closes it.
--
-- ── Replanning ─────────────────────────────────────────────────────────────
-- After the plan is approved (`work.approved_at`), every command that changes
-- what a baseline records is refused by the host (`plan_approved`) unless a
-- replanning is open. A replanning is opened with a reason (1 to 2000
-- characters, not blank) by the Windows account that opened it, and is closed
-- only by taking the next baseline: that baseline copies the reason and the
-- replanning records the baseline's number, in the same transaction. There is
-- no abandon and no discard — an edit already in the file ends in a baseline.
--
-- At most one replanning is open at a time: a partial UNIQUE index over the
-- open rows. The index is on an expression (`closed_at IS NULL`, which is 1
-- for every open row) because SQLite counts NULLs as distinct in a UNIQUE
-- index, so an index on `closed_at` itself would let a second open row in.
--
-- A replanning is not append-only in the way a baseline is — closing it writes
-- `closed_at` and `baseline_number` once — but it is written once: its reason,
-- author and the moment it was opened never change, a closed replanning is
-- never reopened or changed, and none is removed. Triggers keep that, with
-- the message `replanning: written once`. The reason that matters is the
-- baseline's copy, which is insert-only.
CREATE TABLE replanning (
    id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    reason          TEXT    NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000 AND trim(reason) <> ''),
    opened_at       TEXT    NOT NULL,
    author_name     TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    closed_at       TEXT,
    baseline_number INTEGER REFERENCES baseline (number) CHECK (
                        baseline_number IS NULL
                        OR (typeof(baseline_number) = 'integer' AND baseline_number >= 2)
                    ),
    CHECK ((closed_at IS NULL) = (baseline_number IS NULL))
);

CREATE UNIQUE INDEX replanning_one_open ON replanning ((closed_at IS NULL))
WHERE closed_at IS NULL;

CREATE TRIGGER replanning_no_delete
BEFORE DELETE ON replanning
BEGIN
    SELECT RAISE(ABORT, 'replanning: written once');
END;

-- The only change a replanning takes is its closing: an open row gains its
-- `closed_at` and `baseline_number`, and nothing else moves.
CREATE TRIGGER replanning_closed_once
BEFORE UPDATE ON replanning
WHEN OLD.closed_at IS NOT NULL
  OR NEW.closed_at IS NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.reason IS NOT OLD.reason
  OR NEW.opened_at IS NOT OLD.opened_at
  OR NEW.author_name IS NOT OLD.author_name
BEGIN
    SELECT RAISE(ABORT, 'replanning: written once');
END;

CREATE TRIGGER replanning_no_replace
BEFORE INSERT ON replanning
WHEN EXISTS (SELECT 1 FROM replanning WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'replanning: written once');
END;

-- ── Baselines learn money ──────────────────────────────────────────────────
-- In whole minor units, as the cost lines hold it:
--
--   baseline.planned_cents           every cost line of the work
--   baseline_activity.planned_cents  the cost lines that name the activity
--   baseline_stage.planned_cents     every cost line of the stage, its
--                                    activities' included
--
-- A baseline taken from now on records each of them (0 when there is none).
-- A baseline taken before this migration did not: its money is NULL, which
-- means "not recorded then" — never 0, and never back-filled from today's
-- cost lines, which are not what the plan held when it was approved.
--
-- Adding a column is not an UPDATE: the insert-only triggers of migration 003
-- stay as they are, and they cover the new columns.
ALTER TABLE baseline ADD COLUMN planned_cents INTEGER CHECK (
    planned_cents IS NULL OR (typeof(planned_cents) = 'integer' AND planned_cents >= 0)
);
ALTER TABLE baseline_activity ADD COLUMN planned_cents INTEGER CHECK (
    planned_cents IS NULL OR (typeof(planned_cents) = 'integer' AND planned_cents >= 0)
);

-- ── Baselines learn stages ─────────────────────────────────────────────────
-- One row per stage the plan held when the baseline was taken — a stage with
-- no activity included — by id, with its position and its name then. Two
-- baselines compare their stages by id, so a stage renamed between them is the
-- same stage, not one removed and one added. There is no foreign key to
-- `stage` on purpose: a stage removed after approval stays in the baseline it
-- was approved in.
CREATE TABLE baseline_stage (
    baseline_id   TEXT    NOT NULL REFERENCES baseline (id),
    stage_id      TEXT    NOT NULL CHECK (length(stage_id) = 36),
    position      INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    planned_cents INTEGER CHECK (
                      planned_cents IS NULL
                      OR (typeof(planned_cents) = 'integer' AND planned_cents >= 0)
                  ),
    PRIMARY KEY (baseline_id, stage_id),
    UNIQUE (baseline_id, position)
);

-- ── The backfill ───────────────────────────────────────────────────────────
-- A baseline taken before this migration recorded its activities' stage
-- names and nothing else about its stages. Its stages are rebuilt from those
-- rows, one per stage, in the order they first appear in the breakdown:
--
-- - The id is the stage the activity still belongs to, when the activity is
--   still in the plan (an activity never moves between stages, so that is the
--   stage it was in when the baseline was taken).
-- - When none of that stage name's activities is left, the id is derived from
--   the name — the same name gives the same id in every baseline, so two old
--   baselines still compare that stage as one. The derivation is four
--   polynomial hashes of the name's code points, each modulo a prime just
--   under 2^32, written in the 8-4-4-4-12 form of a UUID.
-- - The money is NULL: not recorded then.
--
-- A stage that had no activity when an old baseline was taken left no trace
-- in it, and is not invented here.
--
-- The rows are written before the triggers below exist: the backfill adds
-- rows to past baselines, which the triggers refuse from now on.
WITH RECURSIVE
names (name) AS (
    SELECT DISTINCT stage_name FROM baseline_activity
),
hashed (name, i, a, b, c, d) AS (
    SELECT name, 0, 2166136261, 16777619, 5381, 1315423911 FROM names
    UNION ALL
    SELECT name, i + 1,
           (a * 31 + unicode(substr(name, i + 1, 1))) % 4294967291,
           (b * 37 + unicode(substr(name, i + 1, 1))) % 4294967279,
           (c * 41 + unicode(substr(name, i + 1, 1))) % 4294967231,
           (d * 43 + unicode(substr(name, i + 1, 1))) % 4294967197
    FROM hashed
    WHERE i < length(name)
),
derived (name, id) AS (
    SELECT name,
           printf('%08x-%04x-%04x-%04x-%04x%08x',
                  a, b >> 16, b & 65535, c >> 16, c & 65535, d)
    FROM hashed
    WHERE i = length(name)
),
held (baseline_id, position, stage_name, stage_id) AS (
    SELECT ba.baseline_id, ba.position, ba.stage_name, a.stage_id
    FROM baseline_activity ba
    LEFT JOIN activity a ON a.id = ba.activity_id
),
stages (baseline_id, stage_id, name, first) AS (
    -- Stages still in the plan, by the activities still in it.
    SELECT baseline_id, stage_id, min(stage_name), min(position)
    FROM held
    WHERE stage_id IS NOT NULL
    GROUP BY baseline_id, stage_id
    UNION ALL
    -- Stage names none of whose activities is left.
    SELECT h.baseline_id, d.id, h.stage_name, min(h.position)
    FROM held h
    JOIN derived d ON d.name = h.stage_name
    GROUP BY h.baseline_id, h.stage_name
    HAVING count(h.stage_id) = 0
)
INSERT INTO baseline_stage (baseline_id, stage_id, position, name, planned_cents)
SELECT baseline_id, stage_id,
       row_number() OVER (PARTITION BY baseline_id ORDER BY first),
       name, NULL
FROM stages;

-- ── baseline_stage: insert-only ────────────────────────────────────────────
-- The same battery as migration 003's, with the same message.
CREATE TRIGGER baseline_stage_no_update
BEFORE UPDATE ON baseline_stage
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_stage_no_delete
BEFORE DELETE ON baseline_stage
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_stage_no_replace
BEFORE INSERT ON baseline_stage
WHEN EXISTS (
    SELECT 1 FROM baseline_stage
    WHERE baseline_id = NEW.baseline_id
      AND (stage_id = NEW.stage_id OR position = NEW.position)
)
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_stage_only_on_the_latest
BEFORE INSERT ON baseline_stage
WHEN NEW.baseline_id IS NOT (SELECT id FROM baseline ORDER BY number DESC LIMIT 1)
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;
