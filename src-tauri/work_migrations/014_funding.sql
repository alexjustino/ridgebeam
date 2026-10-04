-- Ridgebeam — work migration 014: funding. Where the money comes from.
--
-- Slice E2. The owner writes down the money the work will receive — savings
-- on hand, a loan's tranches, a client's instalments — each expected on a
-- day, and records each sum when it actually arrives. Whether the money lasts
-- is the domain's, computed every time from these two tables, the schedule
-- and the money going out; nothing here holds a projection.
--
-- ── Funding is plan ────────────────────────────────────────────────────────
-- `funding` is a fund expected: what it is (`label`), where it comes from
-- (`source`), how much (`amount_cents`, more than 0), the day it is expected
-- (`expected_on`) and a note. It is edited freely — it is not the plan's
-- scope, so no approval locks it — and kept in order by `position`, 1..n for
-- the whole work, closed up after a removal. A fund a receipt names cannot be
-- removed: the receipt names it by a foreign key with no action, and the host
-- refuses first, with a sentence.
--
-- ── Receipts are facts ─────────────────────────────────────────────────────
-- `funding_receipt` is the money received, a ledger exactly like the
-- payments' (migration 007): append-only, `seq` one sequence for the work
-- continuing as max + 1, amounts in whole minor units and never 0. A receipt
-- may name the fund it belongs to, or none — money that arrived unplanned.
-- Its day is never after today; that is the host's to refuse, since the
-- schema has no clock it can trust.
--
-- A receipt is never edited; a mistake is a reversal — the negative of the
-- receipt it reverses, naming it by `reverses_seq`, for the same fund, dated
-- on or after it. A receipt is reversed once, in full, and a reversal is
-- never reversed. The trigger `funding_receipt_reversal_rules` refuses
-- anything else with `funding: reversal`.
--
-- ── The ledger is append-only ──────────────────────────────────────────────
-- The diary's trigger battery, with the message `funding: append-only`:
-- UPDATE and DELETE refused; an insert guard against REPLACE (which removes
-- the row it replaces without firing a DELETE trigger when
-- `recursive_triggers` is off); and `seq` continuing as max + 1.

CREATE TABLE funding (
    id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    position     INTEGER NOT NULL UNIQUE CHECK (typeof(position) = 'integer' AND position >= 1),
    label        TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 200 AND trim(label) <> ''),
    source       TEXT    CHECK (
                     source IS NULL OR (length(source) BETWEEN 1 AND 200 AND trim(source) <> '')
                 ),
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
    expected_on  TEXT    NOT NULL CHECK (
                     expected_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                     AND date(expected_on) IS expected_on
                 ),
    note         TEXT    CHECK (
                     note IS NULL OR (length(note) BETWEEN 1 AND 2000 AND trim(note) <> '')
                 ),
    created_at   TEXT    NOT NULL
);

CREATE TABLE funding_receipt (
    id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    seq          INTEGER NOT NULL UNIQUE CHECK (typeof(seq) = 'integer' AND seq >= 1),
    day          TEXT    NOT NULL CHECK (
                     day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(day) IS day
                 ),
    funding_id   TEXT    REFERENCES funding (id),
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents <> 0),
    note         TEXT    CHECK (
                     note IS NULL OR (length(note) BETWEEN 1 AND 200 AND trim(note) <> '')
                 ),
    reverses_seq INTEGER REFERENCES funding_receipt (seq),
    author_name  TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at   TEXT    NOT NULL,
    -- A receipt is positive; a reversal is negative and names an earlier one.
    CHECK (
        (amount_cents > 0 AND reverses_seq IS NULL)
        OR (amount_cents < 0 AND reverses_seq IS NOT NULL AND reverses_seq < seq)
    )
);

CREATE INDEX idx_funding_receipt_funding ON funding_receipt (funding_id);

CREATE TRIGGER funding_receipt_continues
BEFORE INSERT ON funding_receipt
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM funding_receipt)
BEGIN
    SELECT RAISE(ABORT, 'funding: append-only');
END;

CREATE TRIGGER funding_receipt_no_update BEFORE UPDATE ON funding_receipt
BEGIN SELECT RAISE(ABORT, 'funding: append-only'); END;

CREATE TRIGGER funding_receipt_no_delete BEFORE DELETE ON funding_receipt
BEGIN SELECT RAISE(ABORT, 'funding: append-only'); END;

CREATE TRIGGER funding_receipt_no_replace BEFORE INSERT ON funding_receipt
WHEN EXISTS (SELECT 1 FROM funding_receipt WHERE id = NEW.id OR seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'funding: append-only'); END;

CREATE TRIGGER funding_receipt_reversal_rules
BEFORE INSERT ON funding_receipt
WHEN NEW.reverses_seq IS NOT NULL AND (
    NOT EXISTS (
        SELECT 1 FROM funding_receipt o
        WHERE o.seq = NEW.reverses_seq
          AND o.amount_cents > 0
          AND -NEW.amount_cents = o.amount_cents
          AND o.funding_id IS NEW.funding_id
          AND o.day <= NEW.day
    )
    OR EXISTS (SELECT 1 FROM funding_receipt r WHERE r.reverses_seq = NEW.reverses_seq)
)
BEGIN
    SELECT RAISE(ABORT, 'funding: reversal');
END;
