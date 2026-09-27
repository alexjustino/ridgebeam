-- Ridgebeam — work migration 006: checks, their answers, and a stage's
-- lifecycle.
--
-- Slice F5. A stage is planned, then started, then closed — the person
-- decides, and the decision is recorded as two moments on the stage:
-- `started_at` and `closed_at` (both NULL: planned). This is intent, not
-- progress; progress still comes from the diary.
--
-- Starting needs the stage's **start gate** answered, closing its **close
-- gate**. A gate is a list of checks — questions the stage must answer — and a
-- gate is passed when every check's latest answer is `yes` or `na`. The host
-- refuses a start or a close while a gate is held; the domain says which items
-- hold it first.
--
-- The table is called `stage_check`, not `check`: CHECK is a reserved word in
-- SQL, and a table named after it would have to be quoted in every statement
-- that names it.
--
-- ── Answers are facts: append-only, not chained ────────────────────────────
-- An answer is who said what about a check, and when. Re-answering appends;
-- the latest answer counts; nothing is rewritten. `check_answer` carries the
-- same trigger battery as the diary — UPDATE and DELETE refused, the insert
-- guard against REPLACE with `recursive_triggers` off, and `seq` continuing
-- per check as max + 1 — with the message `checks: append-only`. There is no
-- hash chain: the chain is the diary's; an answer is a fact of the gate, not a
-- day of the record (docs/DATA_MODEL.md).
--
-- A check with an answer cannot be removed (its answers are facts; the host
-- refuses first, and the foreign key below refuses second), and so neither can
-- a stage whose checks were answered.
--
-- ── Once started, started ──────────────────────────────────────────────────
-- A start is not undone: `started_at`, once set, never changes. A close can be
-- reopened (`closed_at` back to NULL) — people make mistakes, and the diary
-- keeps what happened on site.

ALTER TABLE stage ADD COLUMN started_at TEXT;
ALTER TABLE stage ADD COLUMN closed_at TEXT CHECK (closed_at IS NULL OR started_at IS NOT NULL);

CREATE TRIGGER stage_start_is_not_undone
BEFORE UPDATE OF started_at ON stage
WHEN OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at
BEGIN
    SELECT RAISE(ABORT, 'checks: append-only');
END;

CREATE TABLE stage_check (
    id         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    stage_id   TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    gate       TEXT    NOT NULL CHECK (gate IN ('start', 'close')),
    position   INTEGER NOT NULL CHECK (position >= 1),
    name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200 AND trim(name) <> ''),
    created_at TEXT    NOT NULL,
    UNIQUE (stage_id, gate, position)
);

CREATE TABLE check_answer (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    check_id    TEXT    NOT NULL REFERENCES stage_check (id),
    seq         INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 1),
    answer      TEXT    NOT NULL CHECK (answer IN ('yes', 'no', 'na')),
    reason      TEXT    CHECK (reason IS NULL OR (length(reason) BETWEEN 1 AND 500 AND trim(reason) <> '')),
    photo_hash  TEXT    CHECK (
                    photo_hash IS NULL
                    OR (length(photo_hash) = 64 AND photo_hash NOT GLOB '*[^0-9a-f]*')
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    answered_at TEXT    NOT NULL,
    UNIQUE (check_id, seq),
    -- Not applicable always carries its reason.
    CHECK (answer <> 'na' OR reason IS NOT NULL)
);

CREATE INDEX idx_check_answer_check ON check_answer (check_id);

CREATE TRIGGER check_answer_continues
BEFORE INSERT ON check_answer
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM check_answer WHERE check_id = NEW.check_id)
BEGIN
    SELECT RAISE(ABORT, 'checks: append-only');
END;

CREATE TRIGGER check_answer_no_update BEFORE UPDATE ON check_answer
BEGIN SELECT RAISE(ABORT, 'checks: append-only'); END;

CREATE TRIGGER check_answer_no_delete BEFORE DELETE ON check_answer
BEGIN SELECT RAISE(ABORT, 'checks: append-only'); END;

CREATE TRIGGER check_answer_no_replace BEFORE INSERT ON check_answer
WHEN EXISTS (
    SELECT 1 FROM check_answer
    WHERE id = NEW.id OR (check_id = NEW.check_id AND seq = NEW.seq)
)
BEGIN SELECT RAISE(ABORT, 'checks: append-only'); END;
