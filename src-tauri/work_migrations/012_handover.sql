-- Ridgebeam — work migration 012: the handover book.
--
-- Slice D3. At the end of a work, one PDF the owner keeps for decades: room by
-- room what was done and when, every decision with its answer, the photos of
-- hidden work taken before it was closed, the documents by name, who did what,
-- and the care notes. The book itself is composed by the domain and written by
-- the host (`report::images` embeds the photos); what the file learns is the
-- three things below.
--
-- ── Hidden work needs its photo ────────────────────────────────────────────
-- `stage_check.needs_photo`: a check that asks for a photo of the work before
-- it is closed — the pipes and wiring before the wall goes up. 0 for every
-- check already in a file, and for a new one unless the person or the template
-- says so. A "yes" on such a check without a photo is refused by the host with
-- a sentence ("This check needs a photo of the work before it is closed.") and
-- by the schema after it (`checks: needs a photo`); "no", and "n/a" with its
-- reason, are not — they are not the claim that the work was done. Answers
-- written before the flag was set stay as they are: they are facts, and the
-- book says it lacks their photo.
--
-- ── Two more kinds of document ─────────────────────────────────────────────
-- `warranty` and `manual` join the kinds a document is filed as. SQLite cannot
-- change a CHECK on a column, so `document` is rebuilt the way migration 010
-- rebuilt `cost_line` — with one more step, because a table points at it:
-- `document_link.document_id REFERENCES document (id) ON DELETE CASCADE`.
--
-- With `foreign_keys = ON` (the product opens every file so, and a pragma
-- cannot be changed inside the runner's transaction), `DROP TABLE document`
-- deletes every row first, and that delete would cascade into every link. So
-- the links are set aside before the table they point at is dropped:
--
-- 1. Every link is copied, as it is, into `document_link_012`, a plain table
--    with no reference.
-- 2. `document_link` is dropped — nothing points at it — which drops its
--    index with it.
-- 3. `document_012` is created with the new kind rule and every other column,
--    CHECK and default exactly as migration 008 wrote them; every document is
--    copied across as it is — id, hash, name, type, size, kind, title, day,
--    author, moment — so the ids the interface knows stay the ids.
-- 4. `document` is dropped (nothing points at it any more) and `document_012`
--    renamed `document`.
-- 5. `document_link` is created again exactly as migration 008 wrote it, the
--    links copied back — each one checked against `document` as it is
--    inserted — the holding table dropped and the index created again under
--    the name it had.
--
-- Neither table carried a trigger or a view to preserve. A failure anywhere
-- rolls the whole migration back, and the file stays at version 11.
--
-- ── Care notes ─────────────────────────────────────────────────────────────
-- `care_note`: what the owner must know to look after the work — "Reseal the
-- shower grout once a year", "The stopcock is under the sink" — on the work
-- (by its `work_id`), a room or a stage, in order (`position` 1..n per
-- target, `db::order`), 1 to 1 000 characters. They are not the plan: no
-- approval locks them and a closed stage does not refuse them. A target is
-- named by kind and id and is not a foreign key (one column cannot reference
-- three tables): the host removes the notes that name a room or a stage in the
-- transaction that removes it.

ALTER TABLE stage_check ADD COLUMN needs_photo INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(needs_photo) = 'integer' AND needs_photo IN (0, 1)
);

CREATE TRIGGER check_answer_needs_photo
BEFORE INSERT ON check_answer
WHEN NEW.answer = 'yes' AND NEW.photo_hash IS NULL
     AND (SELECT needs_photo FROM stage_check WHERE id = NEW.check_id) = 1
BEGIN
    SELECT RAISE(ABORT, 'checks: needs a photo');
END;

-- ── The document rebuild ───────────────────────────────────────────────────
CREATE TABLE document_link_012 (
    document_id TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id   TEXT NOT NULL
);

INSERT INTO document_link_012 (document_id, target_kind, target_id)
SELECT document_id, target_kind, target_id FROM document_link;

DROP TABLE document_link;

CREATE TABLE document_012 (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    file_hash   TEXT    NOT NULL UNIQUE CHECK (
                    length(file_hash) = 64 AND file_hash NOT GLOB '*[^0-9a-f]*'
                ),
    file_name   TEXT    NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    media_type  TEXT    CHECK (
                    media_type IS NULL
                    OR media_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp',
                                      'image/bmp', 'application/pdf')
                ),
    bytes       INTEGER CHECK (bytes IS NULL OR (typeof(bytes) = 'integer' AND bytes >= 1)),
    width       INTEGER CHECK (width IS NULL OR width >= 1),
    height      INTEGER CHECK (height IS NULL OR height >= 1),
    kind        TEXT    NOT NULL CHECK (
                    kind IN ('photo', 'quote', 'drawing', 'permit', 'receipt', 'contract',
                             'warranty', 'manual', 'other')
                ),
    title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) <> ''),
    added_on    TEXT    NOT NULL CHECK (
                    added_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(added_on) IS added_on
                ),
    author_name TEXT    NOT NULL CHECK (length(author_name) BETWEEN 1 AND 256),
    created_at  TEXT    NOT NULL,
    CHECK ((width IS NULL) = (height IS NULL)),
    -- A PDF has no size in pixels: it is never parsed.
    CHECK (media_type IS NOT 'application/pdf' OR width IS NULL)
);

INSERT INTO document_012
    (id, file_hash, file_name, media_type, bytes, width, height, kind, title, added_on,
     author_name, created_at)
SELECT id, file_hash, file_name, media_type, bytes, width, height, kind, title, added_on,
       author_name, created_at
FROM document;

DROP TABLE document;

ALTER TABLE document_012 RENAME TO document;

CREATE TABLE document_link (
    document_id TEXT NOT NULL REFERENCES document (id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (
                    target_kind IN ('work', 'stage', 'activity', 'decision', 'entry',
                                    'commitment', 'payment')
                ),
    target_id   TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 64),
    PRIMARY KEY (document_id, target_kind, target_id)
) WITHOUT ROWID;

INSERT INTO document_link (document_id, target_kind, target_id)
SELECT document_id, target_kind, target_id FROM document_link_012;

DROP TABLE document_link_012;

CREATE INDEX idx_document_link_target ON document_link (target_kind, target_id);

-- ── Care notes ─────────────────────────────────────────────────────────────
CREATE TABLE care_note (
    id          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
    target_kind TEXT    NOT NULL CHECK (target_kind IN ('work', 'room', 'stage')),
    target_id   TEXT    NOT NULL CHECK (length(target_id) BETWEEN 1 AND 64),
    position    INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
    text        TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 1000 AND trim(text) <> ''),
    created_at  TEXT    NOT NULL,
    UNIQUE (target_kind, target_id, position)
);
