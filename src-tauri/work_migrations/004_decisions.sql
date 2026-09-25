-- Ridgebeam — work migration 004: decisions.
--
-- Slice F3. A decision belongs to a stage — "Which tile", "Which colour" — and
-- carries a lead time: the working days between deciding and having what was
-- decided on site. Once it is made it carries when (`made_at`) and, if the
-- person wrote one, the answer.
--
-- What is NOT here is the point of the table. **The deadline is never a
-- column.** It is computed by the domain every time — the stage's earliest
-- scheduled start minus the lead time, on the working calendar — so it moves
-- when the schedule moves and nobody maintains it (ADR-017). There is no
-- "overdue" column either: overdue is the deadline against today, and today is
-- an input, not a fact the file could keep.
--
-- Positions order the decisions inside their stage, 1..n with no gaps, like
-- activities. Removing a stage removes its decisions (`ON DELETE CASCADE`).
--
-- An answer belongs to the making: a decision that is not made has none — the
-- last CHECK — and reopening a decision clears both.

CREATE TABLE decision (
    id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    stage_id       TEXT    NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    position       INTEGER NOT NULL CHECK (position >= 1),
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) <> ''),
    lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (
                       typeof(lead_time_days) = 'integer' AND lead_time_days BETWEEN 0 AND 3650
                   ),
    made_at        TEXT,
    answer         TEXT    CHECK (
                       answer IS NULL
                       OR (length(answer) BETWEEN 1 AND 500 AND trim(answer) <> '')
                   ),
    created_at     TEXT    NOT NULL,
    UNIQUE (stage_id, position),
    CHECK (answer IS NULL OR made_at IS NOT NULL)
);
