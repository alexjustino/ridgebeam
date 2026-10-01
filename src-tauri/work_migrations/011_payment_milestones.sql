-- Ridgebeam — work migration 011: a commitment's payment plan.
--
-- Slice D2. "Am I paying ahead of the work?" A commitment (F6) gains the
-- milestones it is paid by: each a share of its amount, earned by a fact of the
-- work — never by a date and never by a tick. What is earned, paid, due now
-- and paid ahead is the domain's, computed every time from these rows, the
-- stages' lifecycle (F5) and the diary (F4); nothing computed is stored.
--
-- ── A milestone ────────────────────────────────────────────────────────────
-- `share_bp` is basis points of the commitment's amount — "30 %" is 3000 —
-- whole, 1 to 10 000, so a share is counted, not measured, like the money it
-- divides. `trigger` is the fact that earns it:
--
--   advance            — the day the commitment was agreed (a "sinal", paid
--                        before any work);
--   stage_started      — the stage's start gate passed;
--   activity_finished  — an effective diary entry finished `activity_id`;
--   stage_closed       — the close gate passed (a reopen un-earns it).
--
-- `activity_id` is given exactly when the trigger is `activity_finished` (a
-- CHECK), and names an activity of the commitment's own stage (a trigger,
-- behind the host's sentence). `position` orders a commitment's milestones,
-- 1..n, as every other ordered row in a work (`db::order`).
--
-- ── What the schema holds, behind the host ─────────────────────────────────
-- The host refuses each of these first, with a sentence; the schema refuses
-- them again, so a file written by something else holds the same rules:
--
--   the shares of one commitment add up to at most 10 000 — the rest is "not
--   in the plan yet", never assumed (`money: payment plan over 100 %`);
--   an activity of another stage (`money: milestone activity`);
--   any insert, change or removal once a payment names the commitment — a
--   plan rewritten after paying would hide being ahead (`money: payment plan
--   locked`). A reversal is a payment that names the commitment too: the lock
--   stays.
--
-- A closed stage does not refuse a milestone: money is not a plan edit. Nor
-- does an approved plan (F8): a payment plan is an agreement, not what a
-- baseline records.
--
-- ── What goes with what ────────────────────────────────────────────────────
-- A milestone goes with its commitment (`ON DELETE CASCADE`), which goes with
-- its stage only while nothing was paid against it (migration 007). The
-- activity a milestone names is referenced with no action: the host refuses
-- to remove an activity a milestone is earned by, with a sentence, and the
-- schema refuses it after. A stage removed whole takes its activities, its
-- commitments and their milestones in the same statement, which leaves no
-- milestone naming a removed activity.
--
-- The lookups by commitment are served by the index of `UNIQUE (commitment_id,
-- position)`; `idx_payment_milestone_activity` serves the foreign key an
-- activity's removal checks.

CREATE TABLE payment_milestone (
    id            TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    commitment_id TEXT    NOT NULL REFERENCES commitment (id) ON DELETE CASCADE,
    position      INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    label         TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 120 AND trim(label) <> ''),
    share_bp      INTEGER NOT NULL CHECK (
                      typeof(share_bp) = 'integer' AND share_bp BETWEEN 1 AND 10000
                  ),
    trigger       TEXT    NOT NULL CHECK (
                      trigger IN ('advance', 'stage_started', 'activity_finished', 'stage_closed')
                  ),
    activity_id   TEXT    REFERENCES activity (id),
    created_at    TEXT    NOT NULL,
    UNIQUE (commitment_id, position),
    -- An activity is named by the one trigger that is about an activity, and
    -- by no other.
    CHECK ((trigger = 'activity_finished') = (activity_id IS NOT NULL))
);

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
