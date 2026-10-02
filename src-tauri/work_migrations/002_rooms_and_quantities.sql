-- Ridgebeam — work migration 002: rooms, the rooms an activity touches, and how
-- much of an activity there is.
--
-- Slice F1. A room is a row of the work — the architect's and the owner's map
-- of it — and an activity touches zero or more rooms. The work breakdown, the
-- works by room and the owner's checklist are three arrangements of the same
-- rows; nothing here is stored per arrangement, and nothing is stored per lens.
--
-- A quantity is optional and is not a readiness rule. It is at least 0, and its
-- unit is a short word (`m²`, `m`, `un`). A unit means nothing without a
-- quantity; the host refuses one on its own with a sentence, and the schema
-- refuses it as well — a CHECK on an added column may name another column of
-- the same row, and SQLite tests it against every row already there.
--
-- Positions stay 1, 2, 3 … with no gaps: the host renumbers them in the same
-- transaction as every move and every removal.

-- ── Rooms ──────────────────────────────────────────────────────────────────
CREATE TABLE room (
    id         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    position   INTEGER NOT NULL UNIQUE CHECK (position >= 1),
    name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> ''),
    created_at TEXT    NOT NULL
);

-- ── The rooms an activity touches ──────────────────────────────────────────
-- Removing a room removes its links and leaves the activities; removing an
-- activity removes its links and leaves the rooms.
CREATE TABLE activity_room (
    activity_id TEXT NOT NULL REFERENCES activity (id) ON DELETE CASCADE,
    room_id     TEXT NOT NULL REFERENCES room (id) ON DELETE CASCADE,
    PRIMARY KEY (activity_id, room_id)
) WITHOUT ROWID;

CREATE INDEX idx_activity_room_room ON activity_room (room_id);

-- ── Quantity and unit ──────────────────────────────────────────────────────
-- `typeof` keeps text out of a column that holds a number: REAL affinity turns
-- `'12'` into 12.0 and leaves `'twelve'` as text rather than refusing it.
ALTER TABLE activity ADD COLUMN quantity REAL CHECK (
    quantity IS NULL OR (typeof(quantity) IN ('real', 'integer') AND quantity >= 0)
);

ALTER TABLE activity ADD COLUMN unit TEXT CHECK (
    unit IS NULL
    OR (length(unit) BETWEEN 1 AND 16 AND trim(unit) <> '' AND quantity IS NOT NULL)
);
