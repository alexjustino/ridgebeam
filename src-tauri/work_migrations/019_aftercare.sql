-- Ridgebeam — work migration 019: after the handover — warranties and
-- maintenance.
--
-- Slice G4. A work does not end at the handover. The owner records the
-- warranties it came with — what each is for, who gives it, from when and for
-- how long — and the maintenance it needs, each with how often: reseal the
-- shower every 12 months, service the boiler every 12, clean the gutters every
-- 6. When a warranty ends, when a task is next due, what is overdue and what
-- comes due in the next twelve months are the domain's, computed every time
-- from these three tables; nothing here holds a day computed. Months are
-- calendar months.
--
-- ── A warranty is what the paper says ──────────────────────────────────────
-- `warranty`: what it is for (`title`), on the work (by its `work_id`), a room
-- or a stage, who gives it as the person wrote it (`given_by` — "the
-- installer", a company), the day it starts (`starts_on`), how long it lasts
-- in whole calendar months (`months`, 1 to 600: fifty years is past any
-- warranty a person keeps), optionally the filed paper (`document_id`), and a
-- note. It is edited and removed at any time: a correction is an edit. A
-- warranty with conditions — register it, service it yearly — is a note, not a
-- rule; Ridgebeam does not read the paper.
--
-- The paper is a document of the work filed as a `warranty` (the kind
-- migration 012 added): `aftercare: document` otherwise, on insert and on
-- update — which also refuses a document that is not there, before the
-- foreign key would. Documents are removed in this product (`db::documents::
-- remove`), so the reference is a foreign key that lets go of the warranty
-- when its document goes (`ON DELETE SET NULL`): the warranty is still what
-- the paper said. A document filed again as another kind lets go of it too
-- (`document_kind_lets_go_of_warranty`), so a warranty never names a paper
-- that is not a warranty's.
--
-- A later migration that rebuilds `document` as 012 did must set the
-- warranties' references aside first — `DROP TABLE document` with foreign keys
-- on deletes every row, and that delete would clear every reference — and
-- create the trigger on `document` again, which goes with the table.
--
-- ── A maintenance task comes back ──────────────────────────────────────────
-- `maintenance_task`: what is to be done (`title`), on the work, a room or a
-- stage, every how many calendar months (`every_months`, 1 to 120), the day
-- it is first due (`first_due_on`) and a note. Edited at any time, its
-- frequency too: the next due day is computed from the last time it was done,
-- so a new frequency counts from there. Removed only while it has never been
-- done — what was done is a fact and keeps what it was done to: the record
-- names the task by a foreign key with no action, and the host refuses first,
-- with a sentence.
--
-- ── Targets and order ──────────────────────────────────────────────────────
-- Both follow the care notes (migration 012): a target is named by kind and
-- id and is not a foreign key (one column cannot reference three tables); each
-- target's rows are one sequence, `position` 1..n (`db::order`). The host
-- removes a room's or a stage's warranties and tasks in the transaction that
-- removes it, and refuses to remove a room or a stage while a task on it has
-- been done — with a sentence first, and here with
-- `aftercare: done on record` after it.
--
-- ── Each time a task is done is a fact ─────────────────────────────────────
-- `maintenance_done`: the task, `seq` (one sequence per task, continuing as
-- max + 1), the day it was done (`done_on`, never after today — the host's to
-- refuse: the schema has no clock it can trust), a note, and who recorded it.
-- Never before the time it follows: `aftercare: out of order` — checked only
-- on a record that continues its task's sequence; anything else is the
-- battery's to refuse, with its own message. The same day twice is two times.
--
-- The battery of the receipts (migration 014) and the purchases' events
-- (migration 018), with the message `aftercare: append-only`: UPDATE and
-- DELETE refused; an insert guard against REPLACE (which removes the row it
-- replaces without firing a DELETE trigger when `recursive_triggers` is off);
-- and `seq` continuing as max + 1.

CREATE TABLE warranty (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    target_kind TEXT    NOT NULL CHECK (target_kind IN ('work', 'room', 'stage')),
    target_id   TEXT    NOT NULL CHECK (length(target_id) BETWEEN 1 AND 64),
    position    INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) <> ''),
    given_by    TEXT    CHECK (
                    given_by IS NULL
                    OR (length(given_by) BETWEEN 1 AND 120 AND trim(given_by) <> '')
                ),
    starts_on   TEXT    NOT NULL CHECK (
                    starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(starts_on) IS starts_on
                ),
    months      INTEGER NOT NULL CHECK (typeof(months) = 'integer' AND months BETWEEN 1 AND 600),
    document_id TEXT    REFERENCES document (id) ON DELETE SET NULL,
    note        TEXT    CHECK (
                    note IS NULL OR (length(note) BETWEEN 1 AND 1000 AND trim(note) <> '')
                ),
    created_at  TEXT    NOT NULL,
    UNIQUE (target_kind, target_id, position)
);

CREATE INDEX idx_warranty_document ON warranty (document_id);

CREATE TABLE maintenance_task (
    id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    target_kind  TEXT    NOT NULL CHECK (target_kind IN ('work', 'room', 'stage')),
    target_id    TEXT    NOT NULL CHECK (length(target_id) BETWEEN 1 AND 64),
    position     INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    title        TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) <> ''),
    every_months INTEGER NOT NULL CHECK (
                     typeof(every_months) = 'integer' AND every_months BETWEEN 1 AND 120
                 ),
    first_due_on TEXT    NOT NULL CHECK (
                     first_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                     AND date(first_due_on) IS first_due_on
                 ),
    note         TEXT    CHECK (
                     note IS NULL OR (length(note) BETWEEN 1 AND 1000 AND trim(note) <> '')
                 ),
    created_at   TEXT    NOT NULL,
    UNIQUE (target_kind, target_id, position)
);

CREATE INDEX idx_maintenance_task_target ON maintenance_task (target_kind, target_id);

CREATE TABLE maintenance_done (
    task_id     TEXT    NOT NULL REFERENCES maintenance_task (id),
    seq         INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 1),
    done_on     TEXT    NOT NULL CHECK (
                    done_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(done_on) IS done_on
                ),
    note        TEXT    CHECK (
                    note IS NULL OR (length(note) BETWEEN 1 AND 500 AND trim(note) <> '')
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at  TEXT    NOT NULL,
    PRIMARY KEY (task_id, seq)
);

-- ── warranty: the paper is a document filed as a warranty ──────────────────
CREATE TRIGGER warranty_document_insert
BEFORE INSERT ON warranty
WHEN NEW.document_id IS NOT NULL
     AND (SELECT kind FROM document WHERE id = NEW.document_id) IS NOT 'warranty'
BEGIN
    SELECT RAISE(ABORT, 'aftercare: document');
END;

CREATE TRIGGER warranty_document_update
BEFORE UPDATE OF document_id ON warranty
WHEN NEW.document_id IS NOT NULL
     AND (SELECT kind FROM document WHERE id = NEW.document_id) IS NOT 'warranty'
BEGIN
    SELECT RAISE(ABORT, 'aftercare: document');
END;

-- A document filed again as another kind is no longer a warranty's paper.
CREATE TRIGGER document_kind_lets_go_of_warranty
AFTER UPDATE OF kind ON document
WHEN NEW.kind IS NOT 'warranty'
BEGIN
    UPDATE warranty SET document_id = NULL WHERE document_id = NEW.id;
END;

-- ── a room or a stage a task on it was done on is kept ─────────────────────
CREATE TRIGGER room_keeps_maintenance_done
BEFORE DELETE ON room
WHEN EXISTS (
    SELECT 1 FROM maintenance_task t JOIN maintenance_done d ON d.task_id = t.id
    WHERE t.target_kind = 'room' AND t.target_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'aftercare: done on record');
END;

CREATE TRIGGER stage_keeps_maintenance_done
BEFORE DELETE ON stage
WHEN EXISTS (
    SELECT 1 FROM maintenance_task t JOIN maintenance_done d ON d.task_id = t.id
    WHERE t.target_kind = 'stage' AND t.target_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'aftercare: done on record');
END;

-- ── maintenance_done: append-only, one sequence per task ───────────────────
CREATE TRIGGER maintenance_done_continues
BEFORE INSERT ON maintenance_done
WHEN NEW.seq IS NOT (
    SELECT coalesce(max(seq), 0) + 1 FROM maintenance_done WHERE task_id = NEW.task_id
)
BEGIN
    SELECT RAISE(ABORT, 'aftercare: append-only');
END;

CREATE TRIGGER maintenance_done_no_update BEFORE UPDATE ON maintenance_done
BEGIN SELECT RAISE(ABORT, 'aftercare: append-only'); END;

CREATE TRIGGER maintenance_done_no_delete BEFORE DELETE ON maintenance_done
BEGIN SELECT RAISE(ABORT, 'aftercare: append-only'); END;

CREATE TRIGGER maintenance_done_no_replace BEFORE INSERT ON maintenance_done
WHEN EXISTS (
    SELECT 1 FROM maintenance_done WHERE task_id = NEW.task_id AND seq = NEW.seq
)
BEGIN SELECT RAISE(ABORT, 'aftercare: append-only'); END;

-- ── maintenance_done: never before the time it follows ─────────────────────
CREATE TRIGGER maintenance_done_in_order
BEFORE INSERT ON maintenance_done
WHEN NEW.seq IS (
    SELECT coalesce(max(seq), 0) + 1 FROM maintenance_done WHERE task_id = NEW.task_id
) AND EXISTS (
    SELECT 1 FROM maintenance_done WHERE task_id = NEW.task_id AND done_on > NEW.done_on
)
BEGIN
    SELECT RAISE(ABORT, 'aftercare: out of order');
END;
