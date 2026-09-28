-- Ridgebeam — application migration 003: when each work was last backed up.
--
-- A backup (F11) is a file the person keeps wherever they keep things; the
-- product remembers only the day the last one was written, per work, so that
-- Settings and Diagnostics can say "Last backup: 2026-10-09" or "never". It is
-- here, in the application's own database, and not in the work: a backup of a
-- work cannot hold the moment it was itself written, and a work restored on
-- another machine was never backed up *there*.
--
-- One row per work, replaced by the next backup. Where the file went is not
-- kept: it is the person's, and it may be moved, renamed or deleted without the
-- product being told.

CREATE TABLE backup (
    work_id    TEXT    NOT NULL PRIMARY KEY CHECK (length(work_id) = 36),
    day        TEXT    NOT NULL CHECK (length(day) = 10),
    written_at TEXT    NOT NULL,
    bytes      INTEGER NOT NULL CHECK (bytes >= 0),
    files      INTEGER NOT NULL CHECK (files >= 1)
);
