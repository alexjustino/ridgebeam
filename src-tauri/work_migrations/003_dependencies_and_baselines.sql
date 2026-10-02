-- Ridgebeam — work migration 003: dependencies, and baselines that are never
-- rewritten.
--
-- Slice F2. Two things arrive, and one of them is requirement one.
--
-- ── Dependencies ───────────────────────────────────────────────────────────
-- A dependency joins two endpoints, each an activity or a stage: "the tiling
-- starts after the plumbing", or "the finishes start after the whole Structure
-- stage". Finish-to-start, with a lag in working days (0 to 3650) that is
-- waiting, not work. The domain expands a stage endpoint to the stage's
-- activities before it schedules.
--
-- An endpoint names a row in one of two tables, so it cannot be a foreign key.
-- The host removes the dependencies that name an activity or a stage in the
-- same transaction that removes it. A cycle — over the expanded graph — is
-- refused by the domain first and by the host second; SQLite cannot see one.
CREATE TABLE dependency (
    id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    blocker_kind TEXT    NOT NULL CHECK (blocker_kind IN ('activity', 'stage')),
    blocker_id   TEXT    NOT NULL CHECK (length(blocker_id) = 36),
    blocked_kind TEXT    NOT NULL CHECK (blocked_kind IN ('activity', 'stage')),
    blocked_id   TEXT    NOT NULL CHECK (length(blocked_id) = 36),
    lag_days     INTEGER NOT NULL DEFAULT 0 CHECK (
                     typeof(lag_days) = 'integer' AND lag_days BETWEEN 0 AND 3650
                 ),
    created_at   TEXT    NOT NULL,
    UNIQUE (blocker_kind, blocker_id, blocked_kind, blocked_id),
    CHECK (NOT (blocker_kind = blocked_kind AND blocker_id = blocked_id))
);

CREATE INDEX idx_dependency_blocked ON dependency (blocked_kind, blocked_id);

-- ── Approval ───────────────────────────────────────────────────────────────
-- When the plan was first approved, UTC; NULL until it is. Approving is taking
-- baseline 1, and a baseline is never taken back, so neither is the approval:
-- once set, the instant cannot change.
ALTER TABLE work ADD COLUMN approved_at TEXT;

CREATE TRIGGER work_approval_is_not_undone
BEFORE UPDATE OF approved_at ON work
WHEN OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT OLD.approved_at
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

-- ── Baselines: insert-only ─────────────────────────────────────────────────
-- A baseline is the plan as it was approved: each activity's name, stage,
-- duration, start and finish at that moment, and the finish date of the work.
-- It is the record a slip is measured against, so it is never rewritten.
--
-- Requirement one, enforced in the schema: no UPDATE, no DELETE, and no
-- REPLACE — on either table, whatever the connection's pragmas.
--
-- - `BEFORE UPDATE` and `BEFORE DELETE` triggers refuse every edit and every
--   removal.
-- - `INSERT OR REPLACE` (and `REPLACE INTO`, and an upsert) removes the row it
--   replaces without firing a DELETE trigger when `recursive_triggers` is off —
--   SQLite's default. So each table also has a `BEFORE INSERT` trigger that
--   refuses an insert whose key is already there. It fires before conflict
--   resolution, so the replace never reaches the row. With `recursive_triggers`
--   on (as this product opens every file), the DELETE trigger refuses it too.
-- - Rows may be added only to the latest baseline — the one being taken. A
--   past baseline cannot gain a row it did not have when it was approved.
--
-- A baseline row names its activity by id and copies its name and stage name:
-- there is no foreign key to `activity` on purpose, because an activity removed
-- after approval must stay in the baseline it was approved in.
--
-- The one message every trigger raises is `baseline: append-only`; the host
-- never issues a statement that would reach one.
CREATE TABLE baseline (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    number      INTEGER NOT NULL UNIQUE CHECK (typeof(number) = 'integer' AND number >= 1),
    taken_at    TEXT    NOT NULL,
    -- Why the plan changed; slice F8 asks for it. NULL for baseline 1.
    reason      TEXT    CHECK (reason IS NULL OR (length(reason) BETWEEN 1 AND 2000)),
    finish_date TEXT    CHECK (
                    finish_date IS NULL
                    OR (finish_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                        AND date(finish_date) IS finish_date)
                )
);

CREATE TABLE baseline_activity (
    baseline_id   TEXT    NOT NULL REFERENCES baseline (id),
    activity_id   TEXT    NOT NULL CHECK (length(activity_id) = 36),
    -- The order of the row in the breakdown when the baseline was taken.
    position      INTEGER NOT NULL CHECK (position >= 1),
    name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    stage_name    TEXT    NOT NULL CHECK (length(stage_name) BETWEEN 1 AND 120),
    duration_days INTEGER CHECK (
                      duration_days IS NULL
                      OR (typeof(duration_days) = 'integer' AND duration_days BETWEEN 1 AND 3650)
                  ),
    start         TEXT    CHECK (start IS NULL OR date(start) IS start),
    finish        TEXT    CHECK (finish IS NULL OR date(finish) IS finish),
    PRIMARY KEY (baseline_id, activity_id),
    CHECK ((start IS NULL) = (finish IS NULL)),
    CHECK (start IS NULL OR start <= finish)
);

CREATE TRIGGER baseline_no_update
BEFORE UPDATE ON baseline
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_no_delete
BEFORE DELETE ON baseline
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_no_replace
BEFORE INSERT ON baseline
WHEN EXISTS (SELECT 1 FROM baseline WHERE id = NEW.id OR number = NEW.number)
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_activity_no_update
BEFORE UPDATE ON baseline_activity
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_activity_no_delete
BEFORE DELETE ON baseline_activity
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_activity_no_replace
BEFORE INSERT ON baseline_activity
WHEN EXISTS (
    SELECT 1 FROM baseline_activity
    WHERE baseline_id = NEW.baseline_id AND activity_id = NEW.activity_id
)
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;

CREATE TRIGGER baseline_activity_only_on_the_latest
BEFORE INSERT ON baseline_activity
WHEN NEW.baseline_id IS NOT (SELECT id FROM baseline ORDER BY number DESC LIMIT 1)
BEGIN
    SELECT RAISE(ABORT, 'baseline: append-only');
END;
