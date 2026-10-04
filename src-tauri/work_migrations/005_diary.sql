-- Ridgebeam — work migration 005: the diary. Requirement one: no entry is ever
-- lost, and none is ever rewritten.
--
-- Slice F4. An entry is a fact about one day on site: what was done, who was
-- there, the weather, whether the day was lost, what arrived, what went wrong,
-- who visited, and the photos. The plan is intent; the diary is fact — progress
-- is derived from it (the domain), never typed.
--
-- ── Append-only, in the schema ─────────────────────────────────────────────
-- Four tables — `diary_entry`, `diary_done`, `diary_present`, `diary_photo` —
-- and on every one of them:
--
-- - `BEFORE UPDATE` and `BEFORE DELETE` triggers refuse every edit and every
--   removal.
-- - A `BEFORE INSERT` guard refuses an insert whose key is already there. With
--   `recursive_triggers` off — SQLite's default, and how any other tool opens
--   this file — `REPLACE` removes the row it replaces without firing a DELETE
--   trigger; the guard fires before conflict resolution, so the replace never
--   reaches the row. (Proved in cargo, with the guard dropped.)
-- - A child row (a done line, a person present, a photo) may be added only to
--   the latest entry — the one being written. A past entry cannot gain a line
--   it did not have when its hash was computed.
--
-- And on `diary_entry`, `diary_continue_the_chain`: an entry is inserted only
-- as `seq = max + 1`, and only with `prev_hash` equal to the hash of the entry
-- before it (the empty string for the first). The chain cannot fork, skip or
-- start again.
--
-- Every trigger raises the one message `diary: append-only`. The host never
-- issues a statement that would reach one: `db::diary` holds no UPDATE, DELETE
-- or REPLACE, and a test reads its source to prove it.
--
-- ── The chain ──────────────────────────────────────────────────────────────
-- `hash` is the SHA-256 of the entry's canonical form, which includes
-- `prev_hash` and every child row; the canonical form is written out in full in
-- `src/db/diary.rs` and in docs/DATA_MODEL.md. It is tamper-evidence: whoever
-- owns the file can drop these triggers and rewrite a row, and verification will
-- then fail at that entry. It is not a signature and not proof of anything.
--
-- ── No foreign key into the plan ───────────────────────────────────────────
-- A done line names an activity and a presence names a person by id, without a
-- foreign key, on purpose: the plan may change after the day — an activity
-- removed, a person removed — and the diary must say what it said. A key with
-- `ON DELETE` would try to change the diary (and be refused); a key without
-- one would stop the plan from changing. The host checks the ids exist when the
-- entry is written.
--
-- Photos are named by the SHA-256 of their bytes: the file is
-- `<work>/documents/<hash>.<ext>`, its thumbnail `<work>/thumbnails/<hash>.jpg`.

CREATE TABLE diary_entry (
    seq          INTEGER NOT NULL PRIMARY KEY CHECK (typeof(seq) = 'integer' AND seq >= 1),
    day          TEXT    NOT NULL CHECK (
                     day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(day) IS day
                 ),
    kind         TEXT    NOT NULL CHECK (kind IN ('entry', 'correction')),
    corrects_seq INTEGER REFERENCES diary_entry (seq),
    -- NULL when nothing was written; never the empty text.
    note         TEXT    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 4000),
    weather      TEXT    CHECK (
                     weather IS NULL
                     OR weather IN ('sun', 'cloud', 'rain', 'storm', 'wind', 'other')
                 ),
    lost_day     INTEGER NOT NULL CHECK (lost_day IN (0, 1)),
    hours        REAL    CHECK (
                     hours IS NULL
                     OR (typeof(hours) IN ('real', 'integer') AND hours >= 0 AND hours <= 24)
                 ),
    deliveries   TEXT    CHECK (deliveries IS NULL OR length(deliveries) BETWEEN 1 AND 2000),
    incidents    TEXT    CHECK (incidents IS NULL OR length(incidents) BETWEEN 1 AND 2000),
    visitors     TEXT    CHECK (visitors IS NULL OR length(visitors) BETWEEN 1 AND 2000),
    author_name  TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at   TEXT    NOT NULL,
    prev_hash    TEXT    NOT NULL CHECK (
                     prev_hash = ''
                     OR (length(prev_hash) = 64 AND prev_hash NOT GLOB '*[^0-9a-f]*')
                 ),
    hash         TEXT    NOT NULL UNIQUE CHECK (
                     length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'
                 ),
    -- An entry corrects nothing; a correction corrects an earlier entry.
    CHECK (
        (kind = 'entry' AND corrects_seq IS NULL)
        OR (kind = 'correction' AND corrects_seq IS NOT NULL AND corrects_seq < seq)
    ),
    -- Only the first entry starts the chain.
    CHECK ((seq = 1) = (prev_hash = ''))
);

CREATE INDEX idx_diary_entry_day ON diary_entry (day);
CREATE INDEX idx_diary_entry_corrects ON diary_entry (corrects_seq);

CREATE TABLE diary_done (
    entry_seq   INTEGER NOT NULL REFERENCES diary_entry (seq),
    activity_id TEXT    NOT NULL CHECK (length(activity_id) = 36),
    state       TEXT    NOT NULL CHECK (state IN ('worked', 'finished')),
    quantity    REAL    CHECK (
                    quantity IS NULL
                    OR (typeof(quantity) IN ('real', 'integer') AND quantity >= 0)
                ),
    note        TEXT    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
    PRIMARY KEY (entry_seq, activity_id)
);

CREATE TABLE diary_present (
    entry_seq INTEGER NOT NULL REFERENCES diary_entry (seq),
    person_id TEXT    NOT NULL CHECK (length(person_id) = 36),
    PRIMARY KEY (entry_seq, person_id)
);

CREATE TABLE diary_photo (
    entry_seq INTEGER NOT NULL REFERENCES diary_entry (seq),
    position  INTEGER NOT NULL CHECK (position >= 1),
    file_hash TEXT    NOT NULL CHECK (
                  length(file_hash) = 64 AND file_hash NOT GLOB '*[^0-9a-f]*'
              ),
    file_name TEXT    NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    bytes     INTEGER NOT NULL CHECK (bytes >= 1),
    width     INTEGER NOT NULL CHECK (width >= 1),
    height    INTEGER NOT NULL CHECK (height >= 1),
    -- 1 when `<work>/thumbnails/<hash>.jpg` was rendered; 0 when the photo was
    -- kept but could not be drawn small. Not part of the hash: it describes the
    -- copy, not the day.
    thumbnail INTEGER NOT NULL CHECK (thumbnail IN (0, 1)),
    PRIMARY KEY (entry_seq, position),
    UNIQUE (entry_seq, file_hash)
);

CREATE INDEX idx_diary_photo_hash ON diary_photo (file_hash);

-- ── The chain ──────────────────────────────────────────────────────────────
CREATE TRIGGER diary_continue_the_chain
BEFORE INSERT ON diary_entry
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM diary_entry)
  OR NEW.prev_hash IS NOT coalesce((SELECT hash FROM diary_entry WHERE seq = NEW.seq - 1), '')
BEGIN
    SELECT RAISE(ABORT, 'diary: append-only');
END;

-- ── diary_entry ────────────────────────────────────────────────────────────
CREATE TRIGGER diary_entry_no_update BEFORE UPDATE ON diary_entry
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_entry_no_delete BEFORE DELETE ON diary_entry
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_entry_no_replace BEFORE INSERT ON diary_entry
WHEN EXISTS (SELECT 1 FROM diary_entry WHERE seq = NEW.seq OR hash = NEW.hash)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

-- ── diary_done ─────────────────────────────────────────────────────────────
CREATE TRIGGER diary_done_no_update BEFORE UPDATE ON diary_done
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_done_no_delete BEFORE DELETE ON diary_done
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_done_no_replace BEFORE INSERT ON diary_done
WHEN EXISTS (
    SELECT 1 FROM diary_done WHERE entry_seq = NEW.entry_seq AND activity_id = NEW.activity_id
)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_done_only_on_the_latest BEFORE INSERT ON diary_done
WHEN NEW.entry_seq IS NOT (SELECT max(seq) FROM diary_entry)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

-- ── diary_present ──────────────────────────────────────────────────────────
CREATE TRIGGER diary_present_no_update BEFORE UPDATE ON diary_present
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_present_no_delete BEFORE DELETE ON diary_present
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_present_no_replace BEFORE INSERT ON diary_present
WHEN EXISTS (
    SELECT 1 FROM diary_present WHERE entry_seq = NEW.entry_seq AND person_id = NEW.person_id
)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_present_only_on_the_latest BEFORE INSERT ON diary_present
WHEN NEW.entry_seq IS NOT (SELECT max(seq) FROM diary_entry)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

-- ── diary_photo ────────────────────────────────────────────────────────────
CREATE TRIGGER diary_photo_no_update BEFORE UPDATE ON diary_photo
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_photo_no_delete BEFORE DELETE ON diary_photo
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_photo_no_replace BEFORE INSERT ON diary_photo
WHEN EXISTS (
    SELECT 1 FROM diary_photo
    WHERE entry_seq = NEW.entry_seq AND (position = NEW.position OR file_hash = NEW.file_hash)
)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;

CREATE TRIGGER diary_photo_only_on_the_latest BEFORE INSERT ON diary_photo
WHEN NEW.entry_seq IS NOT (SELECT max(seq) FROM diary_entry)
BEGIN SELECT RAISE(ABORT, 'diary: append-only'); END;
