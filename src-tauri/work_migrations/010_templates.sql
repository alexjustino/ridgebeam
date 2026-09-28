-- Ridgebeam — work migration 010: a plan started from a template.
--
-- Slice F9. A template is data, applied once as the work's own plan: nothing
-- links the work back to it (ADR-029). What the file learns is what a template
-- carries and a person's plan did not — ranges, a line not priced yet, and
-- where the plan came from.
--
-- ── An activity's range ────────────────────────────────────────────────────
-- `duration_min_days` and `duration_max_days`: the range of working days a
-- template gave, both or neither, 1 to 3650, the lower end not above the
-- upper. The duration itself (`duration_days`) stays NULL while the range is a
-- range — applying a template never invents a number — and is written only by
-- a person: typed, or taken from every range at once, its lower or its upper
-- end (`ranges_take`). The range is not constrained to hold the duration: a
-- person who knows better types what they know.
--
-- The pair's rule sits on the second column: a column's CHECK may name another
-- column of the same row, but not one that has not been added yet.
ALTER TABLE activity ADD COLUMN duration_min_days INTEGER CHECK (
    duration_min_days IS NULL
    OR (typeof(duration_min_days) = 'integer' AND duration_min_days BETWEEN 1 AND 3650)
);
ALTER TABLE activity ADD COLUMN duration_max_days INTEGER CHECK (
    (duration_max_days IS NULL) = (duration_min_days IS NULL)
    AND (
        duration_max_days IS NULL
        OR (typeof(duration_max_days) = 'integer'
            AND duration_max_days BETWEEN duration_min_days AND 3650)
    )
);

-- ── A decision's lead range ────────────────────────────────────────────────
-- The same for a decision's lead time, 0 to 3650. The lead time itself is the
-- upper end of the range — the earlier deadline, the conservative one — and
-- the range is kept for display.
ALTER TABLE decision ADD COLUMN lead_min_days INTEGER CHECK (
    lead_min_days IS NULL
    OR (typeof(lead_min_days) = 'integer' AND lead_min_days BETWEEN 0 AND 3650)
);
ALTER TABLE decision ADD COLUMN lead_max_days INTEGER CHECK (
    (lead_max_days IS NULL) = (lead_min_days IS NULL)
    AND (
        lead_max_days IS NULL
        OR (typeof(lead_max_days) = 'integer' AND lead_max_days BETWEEN lead_min_days AND 3650)
    )
);

-- ── Where the plan came from ───────────────────────────────────────────────
-- The template's id, its version and its title in the language the work was
-- started in — all three, or none for a plan started empty. Provenance, not a
-- tie: nothing is ever read from the template again.
ALTER TABLE work ADD COLUMN template_id TEXT CHECK (
    template_id IS NULL OR (length(template_id) BETWEEN 1 AND 64 AND trim(template_id) <> '')
);
ALTER TABLE work ADD COLUMN template_version INTEGER CHECK (
    template_version IS NULL
    OR (typeof(template_version) = 'integer' AND template_version >= 1)
);
ALTER TABLE work ADD COLUMN template_title TEXT CHECK (
    (template_title IS NULL) = (template_id IS NULL)
    AND (template_title IS NULL) = (template_version IS NULL)
    AND (template_title IS NULL
         OR (length(template_title) BETWEEN 1 AND 120 AND trim(template_title) <> ''))
);

-- ── A cost line with no amount yet ─────────────────────────────────────────
-- A template carries no prices: its cost lines are labels, and a line with no
-- amount is "not priced yet" — which is not 0. `cost_line.amount_cents`
-- becomes nullable. Every line already in a file has an amount, so no total
-- moves: planned money is the sum of the priced lines, and every line was one.
--
-- SQLite cannot drop a NOT NULL from a column, so the table is rebuilt:
--
-- 1. `cost_line_010` is created with the new column rule and every other
--    column, reference and CHECK exactly as migration 007 wrote them.
-- 2. Every row is copied across as it is — id, stage, activity, label, amount,
--    the moment it was written — so the ids the interface and the baselines
--    know stay the ids.
-- 3. `cost_line` is dropped, which drops its two indexes with it.
-- 4. `cost_line_010` is renamed `cost_line`, and the indexes are created again
--    under the names they had.
--
-- This runs with `foreign_keys = ON`, as the product opens every file, and
-- inside the runner's transaction — where SQLite ignores a change to that
-- pragma, so the rebuild could not turn it off even if it wanted to. It does
-- not need to: no table references `cost_line` (and no trigger or view names
-- it), so dropping it deletes no row another table points at; and each copied
-- row is checked against `stage` and `activity` as it is inserted, so a row
-- that got past this rebuild points where it did before. A failure anywhere
-- rolls the whole migration back, and the file stays at version 9.
CREATE TABLE cost_line_010 (
    id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    stage_id     TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    activity_id  TEXT    REFERENCES activity (id) ON DELETE CASCADE,
    label        TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 120 AND trim(label) <> ''),
    amount_cents INTEGER CHECK (
                     amount_cents IS NULL
                     OR (typeof(amount_cents) = 'integer' AND amount_cents >= 0)
                 ),
    created_at   TEXT    NOT NULL
);

INSERT INTO cost_line_010 (id, stage_id, activity_id, label, amount_cents, created_at)
SELECT id, stage_id, activity_id, label, amount_cents, created_at FROM cost_line;

DROP TABLE cost_line;

ALTER TABLE cost_line_010 RENAME TO cost_line;

CREATE INDEX idx_cost_line_stage ON cost_line (stage_id);
CREATE INDEX idx_cost_line_activity ON cost_line (activity_id);
