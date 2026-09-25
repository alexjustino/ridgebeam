-- Ridgebeam — work migration 001: a work, its calendar, its people, its stages
-- and their activities.
--
-- This is the schema of `work.sqlite3`, the one database inside a work folder
-- (docs/DATA_MODEL.md). It is numbered separately from the application's own
-- migrations: a work moves between machines and between versions on its own,
-- and `work.schema_version` is what says which migrations it has seen.
--
-- The `work` and `calendar` rows are not inserted here. They carry what the
-- person typed — a name, a start date, a working week — so the host inserts them
-- in the same transaction that applies this migration to a new work, and a work
-- file never exists without them.
--
-- Every text a person types is bounded by a CHECK, and every rule the domain
-- enforces before the host is enforced here again, because a work file may be
-- written by something that is not this product.
--
-- There is no progress column, and there never will be: progress is derived
-- from the diary (slice F4).
--
-- Identifiers are UUID v7 as 36-character text; timestamps are UTC with
-- milliseconds and a trailing Z; dates are ISO 8601 `YYYY-MM-DD`.

-- ── The work ───────────────────────────────────────────────────────────────
CREATE TABLE work (
    id             INTEGER PRIMARY KEY CHECK (id = 1),   -- one row, by design
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    work_id        TEXT    NOT NULL CHECK (length(work_id) = 36),
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> ''),
    place          TEXT    NOT NULL CHECK (length(place) <= 200),
    -- `date(x) IS x` refuses a day that does not exist: SQLite rolls 30 February
    -- over into March, so the date it gives back is not the one written. `IS`,
    -- not `=`, because `date()` of nonsense is NULL and a NULL CHECK passes.
    start_date     TEXT    NOT NULL CHECK (
                       start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                       AND date(start_date) IS start_date
                   ),
    currency       TEXT    NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
    created_at     TEXT    NOT NULL
);

-- ── The working calendar ───────────────────────────────────────────────────
-- Seven characters, Monday first, `1` working and `0` not. A week with no
-- working day is refused: nothing could ever be scheduled on it.
CREATE TABLE calendar (
    id            INTEGER PRIMARY KEY CHECK (id = 1),    -- one row, by design
    working_days  TEXT    NOT NULL CHECK (
                      working_days GLOB '[01][01][01][01][01][01][01]'
                      AND working_days <> '0000000'
                  ),
    hours_per_day REAL    NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 24)
);

-- A holiday is not a working day whatever the mask says.
CREATE TABLE holiday (
    date TEXT NOT NULL PRIMARY KEY CHECK (
             date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             AND date(date) IS date
         ),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> '')
);

-- ── People ─────────────────────────────────────────────────────────────────
-- A person is a row, not a user: somebody who can be responsible for an
-- activity. Slice F7 adds trade, phone, stages and availability.
CREATE TABLE person (
    id         TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> ''),
    created_at TEXT NOT NULL
);

-- ── Stages and activities ──────────────────────────────────────────────────
CREATE TABLE stage (
    id         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    position   INTEGER NOT NULL UNIQUE CHECK (position >= 1),
    name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> ''),
    created_at TEXT    NOT NULL
);

-- `duration_days` is working days, NULL until somebody knows it. `typeof` keeps
-- two and a half days out of a column that counts whole ones: INTEGER affinity
-- stores 2.5 as a REAL rather than refusing it.
CREATE TABLE activity (
    id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    stage_id       TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    position       INTEGER NOT NULL CHECK (position >= 1),
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> ''),
    duration_days  INTEGER CHECK (
                       duration_days IS NULL
                       OR (typeof(duration_days) = 'integer' AND duration_days BETWEEN 1 AND 3650)
                   ),
    responsible_id TEXT    REFERENCES person (id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL,
    UNIQUE (stage_id, position)
);

CREATE INDEX idx_activity_responsible ON activity (responsible_id);
