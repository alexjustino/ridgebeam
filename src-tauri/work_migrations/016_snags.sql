-- Ridgebeam — work migration 016: snags, and the retention they hold.
--
-- Slice E4. Defects and pending items found near the end of a work — snags
-- (pt "pendências") — are written down, each with where it is, who must fix
-- it, the day it is due and a photo of the problem; a snag is closed only
-- with a photo of it fixed, and a closure is a fact. A commitment's payment
-- plan may hold back its last part as retention, earned only when the stage
-- is closed and every snag of that stage on the commitment's person is
-- closed. What is open, overdue, held or earned is the domain's, computed
-- every time from these rows; nothing computed is stored.
--
-- ── A snag ─────────────────────────────────────────────────────────────────
-- `number` is 1, 2, 3 … for the whole work, continuing as max + 1, as a
-- change order's does. `stage_id` is where it is — a closed stage takes one:
-- snags are found after closing — `activity_id` optionally narrows it to an
-- activity of that stage, and `person_id` is who must fix it, or nobody. None
-- of the three is a foreign key: a stage, an activity or a person removed from
-- the plan later leaves the record as it was, as a change order does. The host
-- checks each is in the work when the snag is raised.
--
-- `due_on` is the day it should be fixed by, not before the day it was raised.
-- `photo_hash` is a photo of the problem, by the SHA-256 of a document of the
-- work (D3's rule: the interface adds the photo as a document first, through
-- the existing intake); the host checks it names an image document, the
-- schema that it is a hash.
--
-- ── A closure ──────────────────────────────────────────────────────────────
-- One per snag (`snag_id` is the key): `fixed` — **with a photo of it fixed**
-- (a CHECK) — or `withdrawn`, with a note saying why (a CHECK): a snag raised
-- by mistake is withdrawn, never deleted. Closed on a day not before the snag
-- was raised (`snag: closure`). A snag found again after its fix is a new
-- snag; its description may name the old one.
--
-- ── Both tables are insert-only ────────────────────────────────────────────
-- The change orders' battery (migration 013), with the message
-- `snag: append-only`: UPDATE and DELETE refused; a BEFORE INSERT guard
-- against REPLACE (which removes the row it replaces without firing a DELETE
-- trigger when `recursive_triggers` is off); and the number continuing as
-- max + 1.
--
-- ── Retention ──────────────────────────────────────────────────────────────
-- `payment_milestone.trigger` gains `retention`: the part of a commitment held
-- back until its stage is closed and every snag of that stage on the
-- commitment's person is closed. A retention milestone names no activity —
-- the CHECK of migration 011 already says so: only `activity_finished` names
-- one.
--
-- SQLite cannot change a CHECK on a column, so `payment_milestone` is rebuilt
-- the way migration 012 rebuilt `document`. Nothing points at it, so there is
-- no link to set aside:
--
-- 1. `payment_milestone_016` is created with the widened trigger rule and
--    every other column, CHECK and reference exactly as migration 011 wrote
--    them.
-- 2. Every milestone is copied across as it is — id, commitment, position,
--    label, share, trigger, activity, moment — **before** any trigger exists
--    on the new table: the lock trigger would refuse to copy the plan of a
--    commitment already paid against. Each row is checked against
--    `commitment` and `activity` as it is inserted.
-- 3. `payment_milestone` is dropped, taking its index and its seven triggers
--    with it (an implicit DELETE of a dropped table fires no trigger), and
--    `payment_milestone_016` is renamed `payment_milestone`.
-- 4. The index and the seven triggers of migration 011 are created again,
--    word for word, under the names they had.
--
-- A failure anywhere rolls the whole migration back, and the file stays at
-- version 15.

CREATE TABLE snag (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    number      INTEGER NOT NULL UNIQUE CHECK (typeof(number) = 'integer' AND number >= 1),
    title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) <> ''),
    description TEXT    CHECK (
                    description IS NULL
                    OR (length(description) BETWEEN 1 AND 2000 AND trim(description) <> '')
                ),
    stage_id    TEXT    NOT NULL CHECK (length(stage_id) = 36),
    activity_id TEXT    CHECK (activity_id IS NULL OR length(activity_id) = 36),
    person_id   TEXT    CHECK (person_id IS NULL OR length(person_id) = 36),
    raised_on   TEXT    NOT NULL CHECK (
                    raised_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(raised_on) IS raised_on
                ),
    due_on      TEXT    CHECK (
                    due_on IS NULL
                    OR (
                        due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                        AND date(due_on) IS due_on
                        AND due_on >= raised_on
                    )
                ),
    photo_hash  TEXT    CHECK (
                    photo_hash IS NULL
                    OR (length(photo_hash) = 64 AND photo_hash NOT GLOB '*[^0-9a-f]*')
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at  TEXT    NOT NULL
);

CREATE TABLE snag_closure (
    snag_id     TEXT    NOT NULL PRIMARY KEY REFERENCES snag (id),
    outcome     TEXT    NOT NULL CHECK (outcome IN ('fixed', 'withdrawn')),
    closed_on   TEXT    NOT NULL CHECK (
                    closed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(closed_on) IS closed_on
                ),
    photo_hash  TEXT    CHECK (
                    photo_hash IS NULL
                    OR (length(photo_hash) = 64 AND photo_hash NOT GLOB '*[^0-9a-f]*')
                ),
    note        TEXT    CHECK (
                    note IS NULL OR (length(note) BETWEEN 1 AND 2000 AND trim(note) <> '')
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at  TEXT    NOT NULL,
    -- Fixed is shown with a photo of it fixed; withdrawn says why.
    CHECK (outcome <> 'fixed' OR photo_hash IS NOT NULL),
    CHECK (outcome <> 'withdrawn' OR note IS NOT NULL)
);

-- ── snag: insert-only, numbered ────────────────────────────────────────────
CREATE TRIGGER snag_continues
BEFORE INSERT ON snag
WHEN NEW.number IS NOT (SELECT coalesce(max(number), 0) + 1 FROM snag)
BEGIN
    SELECT RAISE(ABORT, 'snag: append-only');
END;

CREATE TRIGGER snag_no_update BEFORE UPDATE ON snag
BEGIN SELECT RAISE(ABORT, 'snag: append-only'); END;

CREATE TRIGGER snag_no_delete BEFORE DELETE ON snag
BEGIN SELECT RAISE(ABORT, 'snag: append-only'); END;

CREATE TRIGGER snag_no_replace BEFORE INSERT ON snag
WHEN EXISTS (SELECT 1 FROM snag WHERE id = NEW.id OR number = NEW.number)
BEGIN SELECT RAISE(ABORT, 'snag: append-only'); END;

-- ── snag_closure: insert-only, one per snag, not before it ─────────────────
CREATE TRIGGER snag_closure_matches
BEFORE INSERT ON snag_closure
WHEN NOT EXISTS (
    SELECT 1 FROM snag WHERE id = NEW.snag_id AND raised_on <= NEW.closed_on
)
BEGIN
    SELECT RAISE(ABORT, 'snag: closure');
END;

CREATE TRIGGER snag_closure_no_update BEFORE UPDATE ON snag_closure
BEGIN SELECT RAISE(ABORT, 'snag: append-only'); END;

CREATE TRIGGER snag_closure_no_delete BEFORE DELETE ON snag_closure
BEGIN SELECT RAISE(ABORT, 'snag: append-only'); END;

CREATE TRIGGER snag_closure_no_replace BEFORE INSERT ON snag_closure
WHEN EXISTS (SELECT 1 FROM snag_closure WHERE snag_id = NEW.snag_id)
BEGIN SELECT RAISE(ABORT, 'snag: append-only'); END;

-- ── The payment milestone rebuild ──────────────────────────────────────────
CREATE TABLE payment_milestone_016 (
    id            TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    commitment_id TEXT    NOT NULL REFERENCES commitment (id) ON DELETE CASCADE,
    position      INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    label         TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 120 AND trim(label) <> ''),
    share_bp      INTEGER NOT NULL CHECK (
                      typeof(share_bp) = 'integer' AND share_bp BETWEEN 1 AND 10000
                  ),
    trigger       TEXT    NOT NULL CHECK (
                      trigger IN ('advance', 'stage_started', 'activity_finished', 'stage_closed',
                                  'retention')
                  ),
    activity_id   TEXT    REFERENCES activity (id),
    created_at    TEXT    NOT NULL,
    UNIQUE (commitment_id, position),
    -- An activity is named by the one trigger that is about an activity, and
    -- by no other — retention included.
    CHECK ((trigger = 'activity_finished') = (activity_id IS NOT NULL))
);

INSERT INTO payment_milestone_016
    (id, commitment_id, position, label, share_bp, trigger, activity_id, created_at)
SELECT id, commitment_id, position, label, share_bp, trigger, activity_id, created_at
FROM payment_milestone;

DROP TABLE payment_milestone;

ALTER TABLE payment_milestone_016 RENAME TO payment_milestone;

CREATE INDEX idx_payment_milestone_activity ON payment_milestone (activity_id);

-- The activity is one of the commitment's stage.
CREATE TRIGGER payment_milestone_activity_insert
BEFORE INSERT ON payment_milestone
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activity a JOIN commitment c ON c.stage_id = a.stage_id
    WHERE a.id = NEW.activity_id AND c.id = NEW.commitment_id
)
BEGIN
    SELECT RAISE(ABORT, 'money: milestone activity');
END;

CREATE TRIGGER payment_milestone_activity_update
BEFORE UPDATE OF activity_id, commitment_id ON payment_milestone
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activity a JOIN commitment c ON c.stage_id = a.stage_id
    WHERE a.id = NEW.activity_id AND c.id = NEW.commitment_id
)
BEGIN
    SELECT RAISE(ABORT, 'money: milestone activity');
END;

-- At most 100 % of the commitment.
CREATE TRIGGER payment_milestone_sum_insert
BEFORE INSERT ON payment_milestone
WHEN NEW.share_bp + (
    SELECT coalesce(sum(share_bp), 0) FROM payment_milestone
    WHERE commitment_id = NEW.commitment_id
) > 10000
BEGIN
    SELECT RAISE(ABORT, 'money: payment plan over 100 %');
END;

CREATE TRIGGER payment_milestone_sum_update
BEFORE UPDATE OF share_bp, commitment_id ON payment_milestone
WHEN NEW.share_bp + (
    SELECT coalesce(sum(share_bp), 0) FROM payment_milestone
    WHERE commitment_id = NEW.commitment_id AND id <> OLD.id
) > 10000
BEGIN
    SELECT RAISE(ABORT, 'money: payment plan over 100 %');
END;

-- Fixed from the first payment that names the commitment.
CREATE TRIGGER payment_milestone_locked_insert
BEFORE INSERT ON payment_milestone
WHEN EXISTS (SELECT 1 FROM payment WHERE commitment_id = NEW.commitment_id)
BEGIN
    SELECT RAISE(ABORT, 'money: payment plan locked');
END;

CREATE TRIGGER payment_milestone_locked_update
BEFORE UPDATE ON payment_milestone
WHEN EXISTS (
    SELECT 1 FROM payment WHERE commitment_id IN (OLD.commitment_id, NEW.commitment_id)
)
BEGIN
    SELECT RAISE(ABORT, 'money: payment plan locked');
END;

CREATE TRIGGER payment_milestone_locked_delete
BEFORE DELETE ON payment_milestone
WHEN EXISTS (SELECT 1 FROM payment WHERE commitment_id = OLD.commitment_id)
BEGIN
    SELECT RAISE(ABORT, 'money: payment plan locked');
END;
