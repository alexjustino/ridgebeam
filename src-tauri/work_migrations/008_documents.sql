-- Ridgebeam — work migration 008: people as contacts, and documents.
--
-- Slice F7.
--
-- ── People as contacts ─────────────────────────────────────────────────────
-- A person gains a phone, an e-mail, a note and their availability, all as
-- the person typed them — stored, shown, never used: the product has no
-- network, and nothing is ever sent to an address. `person_stage` says which
-- stages somebody is expected on; who was actually on site is the diary's.
--
-- ── Documents ──────────────────────────────────────────────────────────────
-- A document is a file the work owns: copied into `<work>/documents/` under
-- the SHA-256 of its bytes, typed by those bytes (an image or a PDF), never
-- parsed beyond an image's header. One row per file — `file_hash` is UNIQUE —
-- so adding the same bytes again links the row again instead of copying twice.
-- `document_link` attaches a document to the work, a stage, an activity, a
-- decision, a diary entry or a payment (both by their `seq`, as text), or a
-- commitment. A target
-- is named by kind and id and is not a foreign key: when a stage goes, its
-- links stay, and the interface lists them as a detached target rather than
-- losing the document.
--
-- Removing a document removes its row and its links. The file is removed only
-- when nothing else names its hash — a diary photo, an answer, a receipt, a
-- quote — and the diary's own rows are never touched.
--
-- ── The backfill ───────────────────────────────────────────────────────────
-- Every photo and receipt the work already holds becomes a document, linked
-- where it came from:
--
--   diary photo          kind 'photo'    linked to the entry (by seq)
--   answer photo         kind 'photo'    linked to the check's stage
--   receipt              kind 'receipt'  linked to the payment (by seq)
--   commitment document  kind 'quote'    linked to the commitment
--
-- One row per hash, in that order of precedence; every origin is linked. The
-- id of a backfilled row is derived from its hash (its first 32 hex digits, in
-- the 8-4-4-4-12 form), so the backfill is deterministic; rows added from now
-- on carry a UUID v7.
--
-- What SQL cannot know is left NULL: a diary photo's row carries its name,
-- size and dimensions, but no row anywhere recorded a file's media type, and
-- an answer's photo, a receipt and a quote recorded only the hash. The host
-- completes those columns from the files themselves when the work is opened
-- (`db::documents::complete`); a row whose file is missing stays incomplete,
-- and `documents_verify` lists it as missing. This is the only case in which
-- `media_type` or `bytes` is NULL.

ALTER TABLE person ADD COLUMN phone TEXT CHECK (
    phone IS NULL OR (length(phone) BETWEEN 1 AND 40 AND trim(phone) <> '')
);
ALTER TABLE person ADD COLUMN email TEXT CHECK (
    email IS NULL OR (length(email) BETWEEN 1 AND 120 AND trim(email) <> '')
);
ALTER TABLE person ADD COLUMN note TEXT CHECK (
    note IS NULL OR (length(note) BETWEEN 1 AND 500 AND trim(note) <> '')
);
ALTER TABLE person ADD COLUMN availability TEXT CHECK (
    availability IS NULL OR (length(availability) BETWEEN 1 AND 200 AND trim(availability) <> '')
);

CREATE TABLE person_stage (
    person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    stage_id  TEXT NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, stage_id)
) WITHOUT ROWID;

CREATE INDEX idx_person_stage_stage ON person_stage (stage_id);

CREATE TABLE document (
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
                    kind IN ('photo', 'quote', 'drawing', 'permit', 'receipt', 'contract', 'other')
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

CREATE TABLE document_link (
    document_id TEXT NOT NULL REFERENCES document (id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (
                    target_kind IN ('work', 'stage', 'activity', 'decision', 'entry',
                                    'commitment', 'payment')
                ),
    target_id   TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 64),
    PRIMARY KEY (document_id, target_kind, target_id)
) WITHOUT ROWID;

CREATE INDEX idx_document_link_target ON document_link (target_kind, target_id);

-- ── Backfill: diary photos ─────────────────────────────────────────────────
-- The first time each hash appears in the diary gives its name, size and day.
INSERT INTO document
    (id, file_hash, file_name, media_type, bytes, width, height, kind, title, added_on,
     author_name, created_at)
SELECT substr(p.file_hash, 1, 8) || '-' || substr(p.file_hash, 9, 4) || '-'
           || substr(p.file_hash, 13, 4) || '-' || substr(p.file_hash, 17, 4) || '-'
           || substr(p.file_hash, 21, 12),
       p.file_hash, p.file_name, NULL, p.bytes, p.width, p.height, 'photo',
       substr(p.file_name, 1, 200), e.day, e.author_name,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM diary_photo p
JOIN diary_entry e ON e.seq = p.entry_seq
WHERE p.rowid = (
    SELECT q.rowid FROM diary_photo q WHERE q.file_hash = p.file_hash
    ORDER BY q.entry_seq, q.position LIMIT 1
);

INSERT INTO document_link (document_id, target_kind, target_id)
SELECT DISTINCT d.id, 'entry', CAST(p.entry_seq AS TEXT)
FROM diary_photo p JOIN document d ON d.file_hash = p.file_hash;

-- ── Backfill: answer photos ────────────────────────────────────────────────
INSERT INTO document
    (id, file_hash, file_name, media_type, bytes, width, height, kind, title, added_on,
     author_name, created_at)
SELECT substr(a.photo_hash, 1, 8) || '-' || substr(a.photo_hash, 9, 4) || '-'
           || substr(a.photo_hash, 13, 4) || '-' || substr(a.photo_hash, 17, 4) || '-'
           || substr(a.photo_hash, 21, 12),
       a.photo_hash, 'answer photo', NULL, NULL, NULL, NULL, 'photo',
       substr('Photo: ' || c.name, 1, 200),
       coalesce(date(a.answered_at), date('now')), a.author_name,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM check_answer a
JOIN stage_check c ON c.id = a.check_id
WHERE a.photo_hash IS NOT NULL
  AND a.rowid = (
      SELECT b.rowid FROM check_answer b WHERE b.photo_hash = a.photo_hash
      ORDER BY b.answered_at, b.rowid LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM document d WHERE d.file_hash = a.photo_hash);

INSERT OR IGNORE INTO document_link (document_id, target_kind, target_id)
SELECT DISTINCT d.id, 'stage', c.stage_id
FROM check_answer a
JOIN stage_check c ON c.id = a.check_id
JOIN document d ON d.file_hash = a.photo_hash;

-- ── Backfill: receipts ─────────────────────────────────────────────────────
INSERT INTO document
    (id, file_hash, file_name, media_type, bytes, width, height, kind, title, added_on,
     author_name, created_at)
SELECT substr(p.receipt_hash, 1, 8) || '-' || substr(p.receipt_hash, 9, 4) || '-'
           || substr(p.receipt_hash, 13, 4) || '-' || substr(p.receipt_hash, 17, 4) || '-'
           || substr(p.receipt_hash, 21, 12),
       p.receipt_hash, 'receipt', NULL, NULL, NULL, NULL, 'receipt',
       'Receipt of payment #' || p.seq, p.day, p.author_name,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM payment p
WHERE p.receipt_hash IS NOT NULL
  AND p.seq = (SELECT min(q.seq) FROM payment q WHERE q.receipt_hash = p.receipt_hash)
  AND NOT EXISTS (SELECT 1 FROM document d WHERE d.file_hash = p.receipt_hash);

INSERT OR IGNORE INTO document_link (document_id, target_kind, target_id)
SELECT DISTINCT d.id, 'payment', CAST(p.seq AS TEXT)
FROM payment p JOIN document d ON d.file_hash = p.receipt_hash;

-- ── Backfill: commitment documents ─────────────────────────────────────────
INSERT INTO document
    (id, file_hash, file_name, media_type, bytes, width, height, kind, title, added_on,
     author_name, created_at)
SELECT substr(c.document_hash, 1, 8) || '-' || substr(c.document_hash, 9, 4) || '-'
           || substr(c.document_hash, 13, 4) || '-' || substr(c.document_hash, 17, 4) || '-'
           || substr(c.document_hash, 21, 12),
       c.document_hash, 'quote', NULL, NULL, NULL, NULL, 'quote',
       substr('Quote: ' || c.label, 1, 200), c.agreed_on, 'Unknown account',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM commitment c
WHERE c.document_hash IS NOT NULL
  AND c.rowid = (
      SELECT k.rowid FROM commitment k WHERE k.document_hash = c.document_hash
      ORDER BY k.created_at, k.rowid LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM document d WHERE d.file_hash = c.document_hash);

INSERT OR IGNORE INTO document_link (document_id, target_kind, target_id)
SELECT DISTINCT d.id, 'commitment', c.id
FROM commitment c JOIN document d ON d.file_hash = c.document_hash;
