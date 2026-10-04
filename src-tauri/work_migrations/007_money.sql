-- Ridgebeam — work migration 007: money. Three amounts, three sources.
--
-- Slice F6.
--
-- - **Planned** is typed: a cost line on a stage, or on one of its activities.
--   It is the plan's, edited per work (`cost_line`).
-- - **Committed** is agreed: a quote or a contract accepted with somebody
--   (`commitment`). Editable, and removable, while nothing has been paid
--   against it; fixed from the first payment that names it.
-- - **Paid** is a fact: the payments ledger (`payment`), append-only. A
--   payment is never edited; a mistake is a new payment that says so — a
--   reversal, with a negative amount, naming the one it reverses.
--
-- Amounts are whole numbers of the currency's minor unit (cents) —
-- `amount_cents INTEGER` — never a floating-point number: money is counted,
-- not measured. The currency is the work's.
--
-- `person` gains `trade` — the tiler, the plumber — which groups money per
-- trade. People with no trade are grouped under "no trade yet".
--
-- ── The ledger is append-only ──────────────────────────────────────────────
-- The diary's trigger battery, with the message `money: append-only`: UPDATE
-- and DELETE refused; an insert guard against REPLACE with
-- `recursive_triggers` off; and `seq`, one sequence for the whole work,
-- continuing as max + 1. There is no hash chain: the chain is the diary's.
--
-- ── Reversals ──────────────────────────────────────────────────────────────
-- Only a reversal may be negative, and a reversal must be negative (a CHECK).
-- The trigger `payment_reversal_rules` refuses, with `money: reversal`:
--   a reversal of a payment that is not there, or of another reversal;
--   a reversal larger than the payment it reverses;
--   a second reversal of the same payment;
--   a reversal for another stage, another person or another commitment than
--   the payment it reverses.
--
-- ── Nothing that was paid disappears ───────────────────────────────────────
-- A payment names its stage, and may name a person and a commitment, by
-- foreign keys with no action: a stage, a person or a commitment named by a
-- payment cannot be removed (the host refuses first, with a sentence). A
-- commitment is removed with its stage only while nothing was paid against it.

ALTER TABLE person ADD COLUMN trade TEXT CHECK (
    trade IS NULL OR (length(trade) BETWEEN 1 AND 60 AND trim(trade) <> '')
);

CREATE TABLE cost_line (
    id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    stage_id     TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    activity_id  TEXT    REFERENCES activity (id) ON DELETE CASCADE,
    label        TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 120 AND trim(label) <> ''),
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
    created_at   TEXT    NOT NULL
);

CREATE INDEX idx_cost_line_stage ON cost_line (stage_id);
CREATE INDEX idx_cost_line_activity ON cost_line (activity_id);

CREATE TABLE commitment (
    id            TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    stage_id      TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    person_id     TEXT    REFERENCES person (id),
    label         TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 120 AND trim(label) <> ''),
    amount_cents  INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
    agreed_on     TEXT    NOT NULL CHECK (
                      agreed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                      AND date(agreed_on) IS agreed_on
                  ),
    document_hash TEXT    CHECK (
                      document_hash IS NULL
                      OR (length(document_hash) = 64 AND document_hash NOT GLOB '*[^0-9a-f]*')
                  ),
    created_at    TEXT    NOT NULL
);

CREATE INDEX idx_commitment_stage ON commitment (stage_id);

CREATE TABLE payment (
    id            TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    seq           INTEGER NOT NULL UNIQUE CHECK (typeof(seq) = 'integer' AND seq >= 1),
    day           TEXT    NOT NULL CHECK (
                      day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(day) IS day
                  ),
    person_id     TEXT    REFERENCES person (id),
    stage_id      TEXT    NOT NULL REFERENCES stage (id),
    commitment_id TEXT    REFERENCES commitment (id),
    amount_cents  INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents <> 0),
    what_for      TEXT    CHECK (what_for IS NULL OR (length(what_for) BETWEEN 1 AND 200 AND trim(what_for) <> '')),
    reverses_seq  INTEGER REFERENCES payment (seq),
    receipt_hash  TEXT    CHECK (
                      receipt_hash IS NULL
                      OR (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*')
                  ),
    author_name   TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at    TEXT    NOT NULL,
    -- A payment is positive; a reversal is negative, names an earlier payment,
    -- and says why.
    CHECK (
        (amount_cents > 0 AND reverses_seq IS NULL)
        OR (amount_cents < 0 AND reverses_seq IS NOT NULL AND reverses_seq < seq
            AND what_for IS NOT NULL)
    )
);

CREATE INDEX idx_payment_stage ON payment (stage_id);
CREATE INDEX idx_payment_commitment ON payment (commitment_id);

CREATE TRIGGER payment_continues
BEFORE INSERT ON payment
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM payment)
BEGIN
    SELECT RAISE(ABORT, 'money: append-only');
END;

CREATE TRIGGER payment_no_update BEFORE UPDATE ON payment
BEGIN SELECT RAISE(ABORT, 'money: append-only'); END;

CREATE TRIGGER payment_no_delete BEFORE DELETE ON payment
BEGIN SELECT RAISE(ABORT, 'money: append-only'); END;

CREATE TRIGGER payment_no_replace BEFORE INSERT ON payment
WHEN EXISTS (SELECT 1 FROM payment WHERE id = NEW.id OR seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'money: append-only'); END;

CREATE TRIGGER payment_reversal_rules
BEFORE INSERT ON payment
WHEN NEW.reverses_seq IS NOT NULL AND (
    NOT EXISTS (
        SELECT 1 FROM payment o
        WHERE o.seq = NEW.reverses_seq
          AND o.amount_cents > 0
          AND -NEW.amount_cents <= o.amount_cents
          AND o.stage_id = NEW.stage_id
          AND o.person_id IS NEW.person_id
          AND o.commitment_id IS NEW.commitment_id
    )
    OR EXISTS (SELECT 1 FROM payment r WHERE r.reverses_seq = NEW.reverses_seq)
)
BEGIN
    SELECT RAISE(ABORT, 'money: reversal');
END;
