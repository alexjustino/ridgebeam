-- Ridgebeam — work migration 015: why a day was lost, and on whose account.
--
-- Slice E3. A diary entry could already say "no work was possible"
-- (`lost_day`); now it may also say why — one cause, in a closed list — and,
-- when it was somebody, who. The domain reads these to attribute the delay of
-- the work (the delay ledger); nothing computed is stored here.
--
-- ── Two columns, both NULL for every entry written before them ─────────────
-- - `lost_cause` — `weather`, `decision` (waiting for a decision), `absence`
--   (a crew did not come), `material` (material did not arrive), `owner` (the
--   owner's request), `access` (no access to the site) or `other`; only on an
--   entry whose `lost_day` is 1.
-- - `lost_party_person_id` — the person the day is put down to, by id; only
--   with a cause. No foreign key, as for every person the diary names
--   (migration 005): a person removed from the plan leaves the record as it
--   was. The host checks the id is a person of the work when the entry is
--   written.
--
-- A cause is changed the way everything in the diary is: by a correction,
-- which restates the day.
--
-- ── Why a plain ADD COLUMN, and not a rebuild ──────────────────────────────
-- SQLite accepts a column CHECK that reads another column of the row, and
-- tests it against every row already there (each passes: both columns are
-- NULL). No row is copied, so no row can change: every entry keeps its bytes,
-- and the triggers of migration 005 stay exactly as they were. They name no
-- column — `BEFORE UPDATE ON diary_entry` fires for an UPDATE of any column,
-- these two included — so a cause, once written, is as fixed as the rest of
-- the entry.
--
-- ── The chain ──────────────────────────────────────────────────────────────
-- The canonical form (`src/db/diary.rs`, docs/DATA_MODEL.md) gains one record,
-- `lost`, after the photos, **only when `lost_cause` is not NULL**. An entry
-- without a cause — every entry written before this migration — has the same
-- canonical string, and so the same hash, as before: the chain verifies
-- unchanged.

ALTER TABLE diary_entry ADD COLUMN lost_cause TEXT CHECK (
    lost_cause IS NULL
    OR (
        lost_cause IN ('weather', 'decision', 'absence', 'material', 'owner', 'access', 'other')
        AND lost_day = 1
    )
);

ALTER TABLE diary_entry ADD COLUMN lost_party_person_id TEXT CHECK (
    lost_party_person_id IS NULL
    OR (length(lost_party_person_id) = 36 AND lost_cause IS NOT NULL)
);
