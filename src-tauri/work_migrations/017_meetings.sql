-- Ridgebeam — work migration 017: the weekly site meeting, and its minutes.
--
-- Slice G1. A site meeting starts from an agenda the record already wrote
-- (the domain's, computed every time; nothing of it is stored), and ends when
-- the person closes it. Closing it writes the minutes: the day it was held,
-- who was there, each item as the agenda said it with what was said and done,
-- the actions raised (what, on whom, by when) and the actions of earlier
-- meetings closed at it. The minutes are written once, at the close, and are
-- never edited: a mistake is said in the next meeting's minutes.
--
-- What was done in the meeting — a decision made, a change order approved, a
-- snag raised — is done through the product's own commands, and goes to the
-- record as always; an item's `outcome` only says, in words, that it happened
-- in the meeting.
--
-- ── A meeting ──────────────────────────────────────────────────────────────
-- `number` is 1, 2, 3 … for the whole work, continuing as max + 1, as a
-- change order's does. `held_on` is the day it was held — never after today,
-- by the host's clock. It is not held to the order of the meetings' days: a
-- meeting written down late is still written down. An action closed at a
-- meeting is never closed before the meeting that raised it, whatever the
-- order (`meeting: closure`, below).
--
-- `attendee_count`, `item_count` and `action_count` say how many attendees,
-- items and actions the minutes hold. They seal them: a row of one of the
-- three is taken only at a position from 1 to its count, and each position
-- only once — so the host writes them all with the meeting, in one
-- transaction, and nothing can be added to a meeting's minutes after it.
--
-- ── Who was there ──────────────────────────────────────────────────────────
-- A person of the plan, by `person_id`, or somebody named, by `name` — exactly
-- one of the two (a CHECK). A person attends once (UNIQUE), and a name is
-- written once — the same letters, whatever their case and the spaces around
-- them (`meeting: attendee`; SQLite's `lower` folds ASCII only, the host folds
-- every letter first). The person is not
-- a foreign key: a person removed from the plan later leaves the minutes as
-- they were, as a change order does. Minutes with nobody ticked are taken —
-- who attended is what the person ticked.
--
-- ── An item ────────────────────────────────────────────────────────────────
-- `kind` is the agenda's section: `action-carried`, `decision`, `change`,
-- `snag`, `payment`, `delay`, `lookahead`, `gate` or `other`. `ref_id` is the
-- id of what it is about — a decision, a change order, a snag, an action —
-- and not a foreign key. `title` is as the agenda said it, frozen; `note` is
-- what was said; `outcome` what was done in the meeting, in words.
--
-- ── An action ──────────────────────────────────────────────────────────────
-- What is to be done (`text`), on a person of the plan or on somebody named —
-- or on nobody named; never both — by a day not before the meeting
-- (`meeting: action`), or by no day. An action is a promise on record, not an
-- obligation the product enforces.
--
-- ── An action closed ───────────────────────────────────────────────────────
-- One per action (`action_id` is the key): `done` or `dropped`, with a note or
-- none, on a day not before the meeting that raised it. Closed at a later
-- meeting (`meeting_id`, that meeting's day, written with its minutes) or
-- between meetings (`meeting_id` NULL) — `meeting: closure` otherwise.
--
-- ── Every table is insert-only ─────────────────────────────────────────────
-- The snags' battery (migration 016), with the message `meeting: append-only`:
-- UPDATE and DELETE refused; a BEFORE INSERT guard against REPLACE (which
-- removes the row it replaces without firing a DELETE trigger when
-- `recursive_triggers` is off); the number continuing as max + 1; and the
-- seal above.

CREATE TABLE meeting (
    id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    number         INTEGER NOT NULL UNIQUE CHECK (typeof(number) = 'integer' AND number >= 1),
    held_on        TEXT    NOT NULL CHECK (
                       held_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                       AND date(held_on) IS held_on
                   ),
    notes          TEXT    CHECK (
                       notes IS NULL OR (length(notes) BETWEEN 1 AND 4000 AND trim(notes) <> '')
                   ),
    attendee_count INTEGER NOT NULL CHECK (
                       typeof(attendee_count) = 'integer' AND attendee_count BETWEEN 0 AND 100
                   ),
    item_count     INTEGER NOT NULL CHECK (
                       typeof(item_count) = 'integer' AND item_count BETWEEN 0 AND 500
                   ),
    action_count   INTEGER NOT NULL CHECK (
                       typeof(action_count) = 'integer' AND action_count BETWEEN 0 AND 200
                   ),
    author_name    TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at     TEXT    NOT NULL
);

CREATE TABLE meeting_attendee (
    meeting_id TEXT    NOT NULL REFERENCES meeting (id),
    position   INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    person_id  TEXT    CHECK (person_id IS NULL OR length(person_id) = 36),
    name       TEXT    CHECK (
                   name IS NULL OR (length(name) BETWEEN 1 AND 120 AND trim(name) <> '')
               ),
    PRIMARY KEY (meeting_id, position),
    UNIQUE (meeting_id, person_id),
    -- A person of the plan or somebody named: exactly one of the two.
    CHECK ((person_id IS NULL) <> (name IS NULL))
);

CREATE TABLE meeting_item (
    meeting_id TEXT    NOT NULL REFERENCES meeting (id),
    position   INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    kind       TEXT    NOT NULL CHECK (
                   kind IN ('action-carried', 'decision', 'change', 'snag', 'payment', 'delay',
                            'lookahead', 'gate', 'other')
               ),
    ref_id     TEXT    CHECK (
                   ref_id IS NULL OR (length(ref_id) BETWEEN 1 AND 64 AND trim(ref_id) <> '')
               ),
    title      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) <> ''),
    note       TEXT    CHECK (
                   note IS NULL OR (length(note) BETWEEN 1 AND 2000 AND trim(note) <> '')
               ),
    outcome    TEXT    CHECK (
                   outcome IS NULL OR (length(outcome) BETWEEN 1 AND 200 AND trim(outcome) <> '')
               ),
    PRIMARY KEY (meeting_id, position)
);

CREATE TABLE meeting_action (
    id         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    meeting_id TEXT    NOT NULL REFERENCES meeting (id),
    position   INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    text       TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 200 AND trim(text) <> ''),
    person_id  TEXT    CHECK (person_id IS NULL OR length(person_id) = 36),
    name       TEXT    CHECK (
                   name IS NULL OR (length(name) BETWEEN 1 AND 120 AND trim(name) <> '')
               ),
    due_on     TEXT    CHECK (
                   due_on IS NULL
                   OR (
                       due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                       AND date(due_on) IS due_on
                   )
               ),
    created_at TEXT    NOT NULL,
    UNIQUE (meeting_id, position),
    -- On a person of the plan, on somebody named, or on nobody named; never
    -- both.
    CHECK (person_id IS NULL OR name IS NULL)
);

CREATE TABLE meeting_action_closure (
    action_id   TEXT    NOT NULL PRIMARY KEY REFERENCES meeting_action (id),
    meeting_id  TEXT    REFERENCES meeting (id),
    closed_on   TEXT    NOT NULL CHECK (
                    closed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(closed_on) IS closed_on
                ),
    outcome     TEXT    NOT NULL CHECK (outcome IN ('done', 'dropped')),
    note        TEXT    CHECK (
                    note IS NULL OR (length(note) BETWEEN 1 AND 500 AND trim(note) <> '')
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at  TEXT    NOT NULL
);

CREATE INDEX idx_meeting_action_closure_meeting ON meeting_action_closure (meeting_id);

-- ── meeting: insert-only, numbered ─────────────────────────────────────────
CREATE TRIGGER meeting_continues
BEFORE INSERT ON meeting
WHEN NEW.number IS NOT (SELECT coalesce(max(number), 0) + 1 FROM meeting)
BEGIN
    SELECT RAISE(ABORT, 'meeting: append-only');
END;

CREATE TRIGGER meeting_no_update BEFORE UPDATE ON meeting
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_no_delete BEFORE DELETE ON meeting
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_no_replace BEFORE INSERT ON meeting
WHEN EXISTS (SELECT 1 FROM meeting WHERE id = NEW.id OR number = NEW.number)
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

-- ── meeting_attendee: insert-only, sealed by the meeting ───────────────────
CREATE TRIGGER meeting_attendee_sealed
BEFORE INSERT ON meeting_attendee
WHEN NEW.position > coalesce(
    (SELECT attendee_count FROM meeting WHERE id = NEW.meeting_id), 0
)
BEGIN
    SELECT RAISE(ABORT, 'meeting: append-only');
END;

CREATE TRIGGER meeting_attendee_named_once
BEFORE INSERT ON meeting_attendee
WHEN NEW.name IS NOT NULL AND EXISTS (
    SELECT 1 FROM meeting_attendee
    WHERE meeting_id = NEW.meeting_id AND lower(trim(name)) = lower(trim(NEW.name))
)
BEGIN
    SELECT RAISE(ABORT, 'meeting: attendee');
END;

CREATE TRIGGER meeting_attendee_no_update BEFORE UPDATE ON meeting_attendee
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_attendee_no_delete BEFORE DELETE ON meeting_attendee
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_attendee_no_replace BEFORE INSERT ON meeting_attendee
WHEN EXISTS (
    SELECT 1 FROM meeting_attendee
    WHERE meeting_id = NEW.meeting_id
      AND (position = NEW.position OR person_id = NEW.person_id)
)
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

-- ── meeting_item: insert-only, sealed by the meeting ───────────────────────
CREATE TRIGGER meeting_item_sealed
BEFORE INSERT ON meeting_item
WHEN NEW.position > coalesce((SELECT item_count FROM meeting WHERE id = NEW.meeting_id), 0)
BEGIN
    SELECT RAISE(ABORT, 'meeting: append-only');
END;

CREATE TRIGGER meeting_item_no_update BEFORE UPDATE ON meeting_item
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_item_no_delete BEFORE DELETE ON meeting_item
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_item_no_replace BEFORE INSERT ON meeting_item
WHEN EXISTS (
    SELECT 1 FROM meeting_item WHERE meeting_id = NEW.meeting_id AND position = NEW.position
)
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

-- ── meeting_action: insert-only, sealed, due not before the meeting ────────
CREATE TRIGGER meeting_action_sealed
BEFORE INSERT ON meeting_action
WHEN NEW.position > coalesce((SELECT action_count FROM meeting WHERE id = NEW.meeting_id), 0)
BEGIN
    SELECT RAISE(ABORT, 'meeting: append-only');
END;

CREATE TRIGGER meeting_action_matches
BEFORE INSERT ON meeting_action
WHEN NEW.due_on IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM meeting WHERE id = NEW.meeting_id AND held_on <= NEW.due_on
)
BEGIN
    SELECT RAISE(ABORT, 'meeting: action');
END;

CREATE TRIGGER meeting_action_no_update BEFORE UPDATE ON meeting_action
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_action_no_delete BEFORE DELETE ON meeting_action
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_action_no_replace BEFORE INSERT ON meeting_action
WHEN EXISTS (
    SELECT 1 FROM meeting_action
    WHERE id = NEW.id OR (meeting_id = NEW.meeting_id AND position = NEW.position)
)
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

-- ── meeting_action_closure: insert-only, one per action, not before it ─────
-- Not before the meeting that raised the action; and, when closed at a
-- meeting, at a later one, on its day.
CREATE TRIGGER meeting_action_closure_matches
BEFORE INSERT ON meeting_action_closure
WHEN NOT EXISTS (
    SELECT 1 FROM meeting_action a JOIN meeting m ON m.id = a.meeting_id
    WHERE a.id = NEW.action_id AND m.held_on <= NEW.closed_on
) OR (
    NEW.meeting_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM meeting_action a
        JOIN meeting m ON m.id = a.meeting_id
        JOIN meeting c ON c.id = NEW.meeting_id
        WHERE a.id = NEW.action_id AND c.held_on = NEW.closed_on AND c.number > m.number
    )
)
BEGIN
    SELECT RAISE(ABORT, 'meeting: closure');
END;

CREATE TRIGGER meeting_action_closure_no_update BEFORE UPDATE ON meeting_action_closure
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_action_closure_no_delete BEFORE DELETE ON meeting_action_closure
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;

CREATE TRIGGER meeting_action_closure_no_replace BEFORE INSERT ON meeting_action_closure
WHEN EXISTS (SELECT 1 FROM meeting_action_closure WHERE action_id = NEW.action_id)
BEGIN SELECT RAISE(ABORT, 'meeting: append-only'); END;
