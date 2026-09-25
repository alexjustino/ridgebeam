-- Ridgebeam — application migration 001: the workspace, and the works recently opened.
--
-- This is the application's own small database, `ridgebeam.sqlite3`, in the
-- application data folder. It holds what is the person's rather than a work's,
-- and nothing about the content of a work: a work lives in its own folder, in
-- its own `work.sqlite3`, with its own migrations (`work_migrations/`).
--
-- Migrations are forward-only and numbered. `workspace.schema_version` records
-- the highest migration applied, and moves in the same transaction as the
-- migration itself.
--
-- Every timestamp column is UTC, ISO 8601 with milliseconds and a trailing Z.

-- ── Workspace ──────────────────────────────────────────────────────────────
CREATE TABLE workspace (
    id             INTEGER PRIMARY KEY CHECK (id = 1),   -- one row, by design
    schema_version INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO workspace (id) VALUES (1);

-- ── Recent works ───────────────────────────────────────────────────────────
-- A work the person opened, as it was last seen: its name and its folder. The
-- folder may have moved or gone since; the host says so (`present`) rather than
-- dropping the row, and the person finds the work again from a dialog.
CREATE TABLE recent_work (
    work_id   TEXT NOT NULL PRIMARY KEY CHECK (length(work_id) = 36),
    name      TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    folder    TEXT NOT NULL CHECK (length(folder) BETWEEN 1 AND 1024),
    opened_at TEXT NOT NULL
);

CREATE INDEX idx_recent_work_opened ON recent_work (opened_at DESC);
