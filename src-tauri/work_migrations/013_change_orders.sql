-- Ridgebeam — work migration 013: change orders. Nothing changes without a
-- price and a date.
--
-- Slice E1. After the plan is approved, a change somebody asks for is raised
-- on record — who asked, what changes, what it costs — and decided once:
-- approved, declined or withdrawn. What it does to the finish is the
-- schedule's (the domain computes it before anybody decides); the decision
-- keeps the figures of that moment. An approval writes the change into the
-- plan inside a replanning, which the person closes by taking the next
-- baseline, as always.
--
-- ── A change order ─────────────────────────────────────────────────────────
-- `number` is 1, 2, 3 … for the whole work, continuing as max + 1, as a
-- payment's `seq` does. `asked_by` is who asked for it:
--
--   owner   — the owner;
--   person  — a person of the plan, by `asked_by_person_id`;
--   other   — somebody else, by `asked_by_name`.
--
-- The person is named by id and is **not** a foreign key: a person removed
-- from the plan later leaves the record as it was. Neither is the stage the
-- change lands in (`stage_id`): a stage removed later leaves it too.
--
-- `cost_cents` is signed — a change can save money — and NULL when it was not
-- priced, which is not 0. `effects` is what it does to the plan, as data the
-- schedule can compute: a JSON array, each element one of
--
--   { "kind": "add", "name": "…", "durationDays": n, "after": activityId | null }
--   { "kind": "duration", "activityId": "…", "durationDays": n }
--   { "kind": "remove", "activityId": "…" }
--
-- The host checks every element before it writes (kinds, ranges, that every
-- id names an activity of the work, at most 50); the schema checks that the
-- column is a JSON array. An empty array is a change of money alone.
--
-- ── A decision ─────────────────────────────────────────────────────────────
-- One per change (`change_order_id` is the key): `approved`, `declined` or
-- `withdrawn`, on a day not before the change was raised. The finish before
-- and after and the signed working days between them are what the schedule
-- said at the moment of deciding, sent by the interface and kept as the fact
-- of that moment — the plan may move later for other reasons. `cost_cents` is
-- the change's, copied. An approval names the replanning it was written into
-- (`replanning_id`), and only an approval does.
--
-- ── Both tables are insert-only ────────────────────────────────────────────
-- The baselines' battery (migration 003), with the message
-- `change order: append-only`: UPDATE and DELETE refused; a BEFORE INSERT
-- guard against REPLACE (which removes the row it replaces without firing a
-- DELETE trigger when `recursive_triggers` is off); and the number continuing
-- as max + 1. A mistake is withdrawn and raised again: the record keeps both.
--
-- What the host refuses first with a sentence, the schema refuses again:
--
--   a change raised before the plan is approved — before approval there are
--   no change orders, the plan is still being written
--   (`change order: plan not approved`);
--   a decision for a change that is not there, dated before it was raised, or
--   with another amount than the change's (`change order: decision`).

CREATE TABLE change_order (
    id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    number             INTEGER NOT NULL UNIQUE CHECK (typeof(number) = 'integer' AND number >= 1),
    raised_on          TEXT    NOT NULL CHECK (
                           raised_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                           AND date(raised_on) IS raised_on
                       ),
    title              TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) <> ''),
    description        TEXT    CHECK (
                           description IS NULL
                           OR (length(description) BETWEEN 1 AND 2000 AND trim(description) <> '')
                       ),
    asked_by           TEXT    NOT NULL CHECK (asked_by IN ('owner', 'person', 'other')),
    asked_by_person_id TEXT    CHECK (
                           asked_by_person_id IS NULL OR length(asked_by_person_id) = 36
                       ),
    asked_by_name      TEXT    CHECK (
                           asked_by_name IS NULL
                           OR (length(asked_by_name) BETWEEN 1 AND 120 AND trim(asked_by_name) <> '')
                       ),
    stage_id           TEXT    NOT NULL CHECK (length(stage_id) = 36),
    cost_cents         INTEGER CHECK (cost_cents IS NULL OR typeof(cost_cents) = 'integer'),
    -- CASE, not AND: SQLite does not promise to stop at a false operand, and
    -- `json_type` on text that is not JSON is an error, not false.
    effects            TEXT    NOT NULL CHECK (
                           CASE WHEN json_valid(effects)
                                THEN json_type(effects) = 'array'
                                     AND json_array_length(effects) <= 50
                                ELSE 0
                           END
                       ),
    author_name        TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at         TEXT    NOT NULL,
    -- A person is named exactly when a person asked; a name exactly when
    -- somebody else did.
    CHECK ((asked_by = 'person') = (asked_by_person_id IS NOT NULL)),
    CHECK ((asked_by = 'other') = (asked_by_name IS NOT NULL))
);

CREATE TABLE change_order_decision (
    change_order_id TEXT    NOT NULL PRIMARY KEY REFERENCES change_order (id),
    outcome         TEXT    NOT NULL CHECK (outcome IN ('approved', 'declined', 'withdrawn')),
    decided_on      TEXT    NOT NULL CHECK (
                        decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                        AND date(decided_on) IS decided_on
                    ),
    note            TEXT    CHECK (
                        note IS NULL OR (length(note) BETWEEN 1 AND 2000 AND trim(note) <> '')
                    ),
    finish_before   TEXT    CHECK (finish_before IS NULL OR date(finish_before) IS finish_before),
    finish_after    TEXT    CHECK (finish_after IS NULL OR date(finish_after) IS finish_after),
    days_delta      INTEGER CHECK (days_delta IS NULL OR typeof(days_delta) = 'integer'),
    cost_cents      INTEGER CHECK (cost_cents IS NULL OR typeof(cost_cents) = 'integer'),
    replanning_id   TEXT    REFERENCES replanning (id),
    author_name     TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at      TEXT    NOT NULL,
    -- An approval is written into a replanning; nothing else is.
    CHECK ((outcome = 'approved') = (replanning_id IS NOT NULL))
);

CREATE INDEX idx_change_order_decision_replanning ON change_order_decision (replanning_id);

-- ── change_order: insert-only, numbered, after approval ────────────────────
CREATE TRIGGER change_order_after_approval
BEFORE INSERT ON change_order
WHEN (SELECT approved_at FROM work WHERE id = 1) IS NULL
BEGIN
    SELECT RAISE(ABORT, 'change order: plan not approved');
END;

CREATE TRIGGER change_order_continues
BEFORE INSERT ON change_order
WHEN NEW.number IS NOT (SELECT coalesce(max(number), 0) + 1 FROM change_order)
BEGIN
    SELECT RAISE(ABORT, 'change order: append-only');
END;

CREATE TRIGGER change_order_no_update BEFORE UPDATE ON change_order
BEGIN SELECT RAISE(ABORT, 'change order: append-only'); END;

CREATE TRIGGER change_order_no_delete BEFORE DELETE ON change_order
BEGIN SELECT RAISE(ABORT, 'change order: append-only'); END;

CREATE TRIGGER change_order_no_replace BEFORE INSERT ON change_order
WHEN EXISTS (SELECT 1 FROM change_order WHERE id = NEW.id OR number = NEW.number)
BEGIN SELECT RAISE(ABORT, 'change order: append-only'); END;

-- ── change_order_decision: insert-only, one per change ─────────────────────
CREATE TRIGGER change_order_decision_matches
BEFORE INSERT ON change_order_decision
WHEN NOT EXISTS (
    SELECT 1 FROM change_order
    WHERE id = NEW.change_order_id
      AND raised_on <= NEW.decided_on
      AND cost_cents IS NEW.cost_cents
)
BEGIN
    SELECT RAISE(ABORT, 'change order: decision');
END;

CREATE TRIGGER change_order_decision_no_update BEFORE UPDATE ON change_order_decision
BEGIN SELECT RAISE(ABORT, 'change order: append-only'); END;

CREATE TRIGGER change_order_decision_no_delete BEFORE DELETE ON change_order_decision
BEGIN SELECT RAISE(ABORT, 'change order: append-only'); END;

CREATE TRIGGER change_order_decision_no_replace BEFORE INSERT ON change_order_decision
WHEN EXISTS (SELECT 1 FROM change_order_decision WHERE change_order_id = NEW.change_order_id)
BEGIN SELECT RAISE(ABORT, 'change order: append-only'); END;
