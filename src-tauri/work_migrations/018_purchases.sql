-- Ridgebeam — work migration 018: purchases, and what happened to each.
--
-- Slice G2. The materials an activity needs that take time to arrive — a
-- worktop, windows, the tiles — are written down with how long the supplier
-- takes (`lead_days`, calendar days: suppliers quote calendar days). The day
-- to order by, what to order this week, what is late to order and what is
-- late to arrive are the domain's, computed every time from these two
-- tables and the forecast; nothing here holds a day computed.
--
-- ── A purchase is plan ─────────────────────────────────────────────────────
-- `purchase` is something to buy: its stage (`stage_id`), optionally the
-- activity of that stage that needs it (`activity_id`; NULL is the stage's
-- first activity, the domain's reading), what it is (`name`), how much in
-- the person's words (`quantity`, free text — "12 m²"), from whom
-- (`supplier`), how long the supplier takes (`lead_days`, 0 to 365) and a
-- note. It is edited freely — buying is the work, not its scope, so no
-- approval locks it — and kept in order by `position`, 1..n for the whole
-- work, closed up after a removal, as the funds are (migration 014).
--
-- The stage is a foreign key that takes the purchase with it when the stage
-- is removed (`ON DELETE CASCADE`, as a commitment's); the activity one that
-- lets go of it (`ON DELETE SET NULL`): a purchase whose activity is removed
-- is needed by its stage's first activity. The activity is one of the
-- stage's — `purchase: activity` otherwise, on insert and on update.
--
-- A purchase an event names cannot be removed, nor the stage it is on: the
-- event names it by a foreign key with no action, and the host refuses first,
-- with a sentence.
--
-- Once something has happened to a purchase, its lead time, its stage and its
-- activity are fixed: an order keeps the lead time it was placed with, and
-- the day it is expected is read from it. Its name, quantity, supplier and
-- note stay editable. `purchase: ordered` otherwise — which also refuses the
-- `SET NULL` of an activity removed while a purchase of it is on record; the
-- host refuses that removal first, with a sentence.
--
-- ── What happened to it is a fact ──────────────────────────────────────────
-- `purchase_event` is what happened, in order: `ordered`, `delivered` or
-- `cancelled` (the order fell through — the purchase is to order again), on a
-- day never after today (the host's to refuse: the schema has no clock it
-- can trust), with a note and who recorded it. `seq` is one sequence per
-- purchase, continuing as max + 1. The rules, `purchase: event` otherwise:
--
-- - `ordered` only first, or after a `cancelled` — never two orders in a row;
-- - `delivered` and `cancelled` only after an `ordered` — an open order;
-- - nothing after `delivered`;
-- - never on a day before the event it follows.
--
-- The rules are checked only on an event that continues its purchase's
-- sequence: anything else is the battery's to refuse, with its own message.
--
-- ── The events are append-only ─────────────────────────────────────────────
-- The funds' battery (migration 014), with the message
-- `purchase: append-only`: UPDATE and DELETE refused; an insert guard against
-- REPLACE (which removes the row it replaces without firing a DELETE trigger
-- when `recursive_triggers` is off); and `seq` continuing as max + 1.

CREATE TABLE purchase (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    position    INTEGER NOT NULL UNIQUE CHECK (typeof(position) = 'integer' AND position >= 1),
    stage_id    TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    activity_id TEXT    REFERENCES activity (id) ON DELETE SET NULL,
    name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200 AND trim(name) <> ''),
    quantity    TEXT    CHECK (
                    quantity IS NULL OR (length(quantity) BETWEEN 1 AND 60 AND trim(quantity) <> '')
                ),
    supplier    TEXT    CHECK (
                    supplier IS NULL
                    OR (length(supplier) BETWEEN 1 AND 120 AND trim(supplier) <> '')
                ),
    lead_days   INTEGER NOT NULL CHECK (
                    typeof(lead_days) = 'integer' AND lead_days BETWEEN 0 AND 365
                ),
    note        TEXT    CHECK (
                    note IS NULL OR (length(note) BETWEEN 1 AND 2000 AND trim(note) <> '')
                ),
    created_at  TEXT    NOT NULL
);

CREATE INDEX idx_purchase_stage ON purchase (stage_id);
CREATE INDEX idx_purchase_activity ON purchase (activity_id);

CREATE TABLE purchase_event (
    purchase_id TEXT    NOT NULL REFERENCES purchase (id),
    seq         INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 1),
    kind        TEXT    NOT NULL CHECK (kind IN ('ordered', 'delivered', 'cancelled')),
    day         TEXT    NOT NULL CHECK (
                    day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(day) IS day
                ),
    note        TEXT    CHECK (
                    note IS NULL OR (length(note) BETWEEN 1 AND 500 AND trim(note) <> '')
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at  TEXT    NOT NULL,
    PRIMARY KEY (purchase_id, seq)
);

-- ── purchase: the activity is one of the stage's ───────────────────────────
CREATE TRIGGER purchase_activity_insert
BEFORE INSERT ON purchase
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activity WHERE id = NEW.activity_id AND stage_id = NEW.stage_id
)
BEGIN
    SELECT RAISE(ABORT, 'purchase: activity');
END;

CREATE TRIGGER purchase_activity_update
BEFORE UPDATE OF stage_id, activity_id ON purchase
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activity WHERE id = NEW.activity_id AND stage_id = NEW.stage_id
)
BEGIN
    SELECT RAISE(ABORT, 'purchase: activity');
END;

-- ── purchase: the terms of an order are fixed once it is on record ─────────
CREATE TRIGGER purchase_fixed_once_ordered
BEFORE UPDATE OF stage_id, activity_id, lead_days ON purchase
WHEN (
    NEW.stage_id IS NOT OLD.stage_id
    OR NEW.activity_id IS NOT OLD.activity_id
    OR NEW.lead_days IS NOT OLD.lead_days
) AND EXISTS (SELECT 1 FROM purchase_event WHERE purchase_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'purchase: ordered');
END;

-- ── purchase_event: append-only, one sequence per purchase ─────────────────
CREATE TRIGGER purchase_event_continues
BEFORE INSERT ON purchase_event
WHEN NEW.seq IS NOT (
    SELECT coalesce(max(seq), 0) + 1 FROM purchase_event WHERE purchase_id = NEW.purchase_id
)
BEGIN
    SELECT RAISE(ABORT, 'purchase: append-only');
END;

CREATE TRIGGER purchase_event_no_update BEFORE UPDATE ON purchase_event
BEGIN SELECT RAISE(ABORT, 'purchase: append-only'); END;

CREATE TRIGGER purchase_event_no_delete BEFORE DELETE ON purchase_event
BEGIN SELECT RAISE(ABORT, 'purchase: append-only'); END;

CREATE TRIGGER purchase_event_no_replace BEFORE INSERT ON purchase_event
WHEN EXISTS (
    SELECT 1 FROM purchase_event WHERE purchase_id = NEW.purchase_id AND seq = NEW.seq
)
BEGIN SELECT RAISE(ABORT, 'purchase: append-only'); END;

-- ── purchase_event: the order of what can happen ───────────────────────────
-- Ordered first or after a cancellation; delivered or cancelled only on an
-- open order; nothing after a delivery; never before the event it follows.
CREATE TRIGGER purchase_event_follows
BEFORE INSERT ON purchase_event
WHEN NEW.seq IS (
    SELECT coalesce(max(seq), 0) + 1 FROM purchase_event WHERE purchase_id = NEW.purchase_id
) AND (
    (
        NEW.kind = 'ordered' AND (
            SELECT kind FROM purchase_event
            WHERE purchase_id = NEW.purchase_id ORDER BY seq DESC LIMIT 1
        ) IN ('ordered', 'delivered')
    )
    OR (
        NEW.kind IN ('delivered', 'cancelled') AND (
            SELECT kind FROM purchase_event
            WHERE purchase_id = NEW.purchase_id ORDER BY seq DESC LIMIT 1
        ) IS NOT 'ordered'
    )
    OR EXISTS (
        SELECT 1 FROM purchase_event WHERE purchase_id = NEW.purchase_id AND day > NEW.day
    )
)
BEGIN
    SELECT RAISE(ABORT, 'purchase: event');
END;
