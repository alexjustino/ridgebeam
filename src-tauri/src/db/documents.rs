//! Documents: the files the work owns, and what each is attached to.
//!
//! One row per file — the hash is unique — so the same bytes added twice are
//! one document with two links, and one copy in `documents/`. A document is
//! attached (`document_link`) to the work, a stage, an activity, a decision, a
//! commitment (by id), or a diary entry or a payment (by `seq`, written as
//! text). A link is not a foreign key: a stage removed leaves its links, and
//! the interface lists them as detached rather than losing the document.
//!
//! Every file the work copies in becomes a document: from the Documents page,
//! and — from F7 on — a diary photo, an answer's photo, a receipt and a quote,
//! each linked where it came from. What existed before F7 was backfilled by
//! work migration 008; [`complete`] fills in, from the files themselves, what
//! that migration could not know.
//!
//! Removing a document removes its row and its links. The file goes only when
//! nothing else names its hash ([`hash_is_named`]); the diary's photo rows, the
//! answers, the ledger and the quotes are never touched here.
//!
//! # Changelog of this repository
//!
//! - F7: documents recorded, re-linked by hash, titled and kinded, linked and
//!   unlinked, removed; the backfill completed; the hashes the work names.
//! - D3: two more kinds, `warranty` and `manual`.
//! - E4: a snag's photo and its closure's are hashes the work names.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::{Document, DocumentLink, DocumentTarget};
use crate::db::work::{exists, found};
use crate::db::{new_id, now};
use crate::error::{Error, Result};
use crate::files::intake::{self, Format};

/// The kinds a document may be filed as — `warranty` and `manual` from D3
/// (work migration 012).
pub const KINDS: [&str; 9] = [
    "photo", "quote", "drawing", "permit", "receipt", "contract", "warranty", "manual", "other",
];

/// The kinds of thing a document may be attached to.
pub const TARGET_KINDS: [&str; 7] = [
    "work",
    "stage",
    "activity",
    "decision",
    "entry",
    "commitment",
    "payment",
];

/// The sentence for a document id that is not in this work.
pub const DOCUMENT_NOT_FOUND: &str = "That document is not in this work.";

/// The sentence for a target that is not in this work.
pub const TARGET_NOT_FOUND: &str = "What that document is attached to is not in this work.";

/// A file just copied in, about to be recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDocument<'a> {
    /// SHA-256 of the bytes.
    pub file_hash: &'a str,
    /// The name it had.
    pub file_name: &'a str,
    /// What its bytes are.
    pub format: Format,
    /// Its size.
    pub bytes: i64,
    /// Its size in pixels, for an image.
    pub size: Option<(i64, i64)>,
    /// How it is filed.
    pub kind: &'a str,
    /// The day it was added.
    pub added_on: &'a str,
    /// The account that added it.
    pub author_name: &'a str,
}

/// Every document with its links, by the day added, then as added.
///
/// A row the backfill could not complete — its file gone before F7 opened the
/// work — reads as `application/octet-stream` of 0 bytes; `documents_verify`
/// lists it as missing.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Document>> {
    let mut links: HashMap<String, Vec<DocumentLink>> = HashMap::new();
    let rows = conn
        .prepare(
            "SELECT document_id, target_kind, target_id FROM document_link
             ORDER BY document_id,
                      CASE target_kind WHEN 'work' THEN 0 WHEN 'stage' THEN 1
                           WHEN 'activity' THEN 2 WHEN 'decision' THEN 3 WHEN 'entry' THEN 4
                           WHEN 'commitment' THEN 5 ELSE 6 END,
                      target_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                DocumentTarget {
                    target_kind: row.get(1)?,
                    target_id: row.get(2)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (document, link) in rows {
        links.entry(document).or_default().push(link);
    }

    let documents = conn
        .prepare(
            "SELECT id, file_hash, file_name, coalesce(media_type, 'application/octet-stream'),
                    coalesce(bytes, 0), width, height, kind, title, added_on, author_name,
                    created_at
             FROM document ORDER BY added_on, created_at, id",
        )?
        .query_map([], |row| {
            Ok(Document {
                id: row.get(0)?,
                file_hash: row.get(1)?,
                file_name: row.get(2)?,
                media_type: row.get(3)?,
                bytes: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                kind: row.get(7)?,
                title: row.get(8)?,
                added_on: row.get(9)?,
                author_name: row.get(10)?,
                created_at: row.get(11)?,
                links: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut document| {
            document.links = links.remove(&document.id).unwrap_or_default();
            document
        })
        .collect();
    Ok(documents)
}

/// Refuse a target that is not in this work.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a kind that is not one, or an id that names
/// nothing of that kind.
pub fn check_target(conn: &Connection, target: &DocumentTarget) -> Result<()> {
    let id = target.target_id.as_str();
    let known = match target.target_kind.as_str() {
        "work" => exists(conn, "SELECT 1 FROM work WHERE work_id = ?1", id)?,
        "stage" => exists(conn, "SELECT 1 FROM stage WHERE id = ?1", id)?,
        "activity" => exists(conn, "SELECT 1 FROM activity WHERE id = ?1", id)?,
        "decision" => exists(conn, "SELECT 1 FROM decision WHERE id = ?1", id)?,
        "commitment" => exists(conn, "SELECT 1 FROM commitment WHERE id = ?1", id)?,
        "entry" => {
            is_seq(id) && exists(conn, "SELECT 1 FROM diary_entry WHERE seq = ?1", id)?
        }
        "payment" => is_seq(id) && exists(conn, "SELECT 1 FROM payment WHERE seq = ?1", id)?,
        _ => {
            return Err(Error::InvalidInput(
                "A document is attached to the work, a stage, an activity, a decision, a diary entry, a commitment or a payment."
                    .into(),
            ))
        }
    };
    if known {
        Ok(())
    } else {
        Err(Error::InvalidInput(TARGET_NOT_FOUND.into()))
    }
}

/// A `seq` as the link writes it: decimal digits, no sign, no leading zero.
fn is_seq(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 18
        && value.bytes().all(|b| b.is_ascii_digit())
        && !value.starts_with('0')
}

/// Record a file just copied in, and attach it. The same bytes already in the
/// work are the same document: it gains the link, keeps its title and kind.
/// Returns the document's id.
///
/// # Errors
///
/// [`Error::Database`] when a row cannot be written.
pub fn record(
    conn: &Connection,
    new: &NewDocument<'_>,
    target: Option<&DocumentTarget>,
) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM document WHERE file_hash = ?1",
            [new.file_hash],
            |row| row.get(0),
        )
        .optional()?;
    let id = match existing {
        Some(id) => id,
        None => {
            let id = new_id();
            let title: String = new.file_name.chars().take(200).collect();
            tx.execute(
                "INSERT INTO document
                   (id, file_hash, file_name, media_type, bytes, width, height, kind, title,
                    added_on, author_name, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    id,
                    new.file_hash,
                    new.file_name,
                    new.format.media_type(),
                    new.bytes,
                    new.size.map(|(w, _)| w),
                    new.size.map(|(_, h)| h),
                    new.kind,
                    title,
                    new.added_on,
                    new.author_name,
                    now()
                ],
            )?;
            id
        }
    };
    if let Some(target) = target {
        tx.execute(
            "INSERT OR IGNORE INTO document_link (document_id, target_kind, target_id)
             VALUES (?1, ?2, ?3)",
            params![id, target.target_kind, target.target_id],
        )?;
    }
    tx.commit()?;
    Ok(id)
}

/// Attach the document that holds these bytes, if the work has one. Used when
/// a diary entry, an answer, a payment or a quote re-attaches a file by hash.
///
/// # Errors
///
/// [`Error::Database`] when the row cannot be written.
pub fn link_hash(conn: &Connection, hash: &str, target: &DocumentTarget) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO document_link (document_id, target_kind, target_id)
         SELECT id, ?2, ?3 FROM document WHERE file_hash = ?1",
        params![hash, target.target_kind, target.target_id],
    )?;
    Ok(())
}

/// Change a document's title, kind, or both.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work.
pub fn update(conn: &Connection, id: &str, title: Option<&str>, kind: Option<&str>) -> Result<()> {
    let changed = conn.execute(
        "UPDATE document SET title = coalesce(?2, title), kind = coalesce(?3, kind)
         WHERE id = ?1",
        params![id, title, kind],
    )?;
    found(changed, DOCUMENT_NOT_FOUND)
}

/// Attach a document to a target; attaching it twice is one link.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document or a target not in this work.
pub fn link(conn: &Connection, id: &str, target: &DocumentTarget) -> Result<()> {
    if !exists(conn, "SELECT 1 FROM document WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(DOCUMENT_NOT_FOUND.into()));
    }
    check_target(conn, target)?;
    conn.execute(
        "INSERT OR IGNORE INTO document_link (document_id, target_kind, target_id)
         VALUES (?1, ?2, ?3)",
        params![id, target.target_kind, target.target_id],
    )?;
    Ok(())
}

/// Detach a document from a target. It stays in the library, attached to
/// nothing if that was its last link. A link to a target that is gone may be
/// detached too — that is how a detached target is cleared.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work, or a link it does
/// not have.
pub fn unlink(conn: &Connection, id: &str, target: &DocumentTarget) -> Result<()> {
    if !exists(conn, "SELECT 1 FROM document WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(DOCUMENT_NOT_FOUND.into()));
    }
    let changed = conn.execute(
        "DELETE FROM document_link WHERE document_id = ?1 AND target_kind = ?2 AND target_id = ?3",
        params![id, target.target_kind, target.target_id],
    )?;
    found(changed, "That document is not attached there.")
}

/// Remove a document and its links; returns its hash, so the caller can ask
/// whether anything else still names the file.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work.
pub fn remove(conn: &Connection, id: &str) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    let hash: String = tx
        .query_row(
            "SELECT file_hash FROM document WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(DOCUMENT_NOT_FOUND.into()))?;
    tx.execute("DELETE FROM document WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(hash)
}

/// The hashes of every file something in the work names: a document, a diary
/// photo, an answer, a receipt, a quote, a snag's photo or its closure's (E4).
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn named_hashes(conn: &Connection) -> Result<BTreeSet<String>> {
    let hashes = conn
        .prepare(
            "SELECT file_hash FROM document
             UNION SELECT file_hash FROM diary_photo
             UNION SELECT photo_hash FROM check_answer WHERE photo_hash IS NOT NULL
             UNION SELECT receipt_hash FROM payment WHERE receipt_hash IS NOT NULL
             UNION SELECT document_hash FROM commitment WHERE document_hash IS NOT NULL
             UNION SELECT photo_hash FROM snag WHERE photo_hash IS NOT NULL
             UNION SELECT photo_hash FROM snag_closure WHERE photo_hash IS NOT NULL",
        )?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<BTreeSet<_>, _>>()?;
    Ok(hashes)
}

/// Whether anything in the work still names these bytes.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn hash_is_named(conn: &Connection, hash: &str) -> Result<bool> {
    Ok(named_hashes(conn)?.contains(hash))
}

/// Fill in, from the files, what the backfill of migration 008 could not know:
/// the media type, and — for an answer's photo, a receipt or a quote — the
/// size and the dimensions. A row whose file is not in the folder is left as
/// it is. Runs every time a work is opened; with nothing to complete, it is
/// one query.
///
/// # Errors
///
/// [`Error::Database`] when a row cannot be read or written.
pub fn complete(conn: &Connection, folder: &Path) -> Result<()> {
    let incomplete: Vec<(String, String)> = conn
        .prepare("SELECT id, file_hash FROM document WHERE media_type IS NULL OR bytes IS NULL")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (id, hash) in incomplete {
        let Some(path) = intake::original(folder, &hash) else {
            log::warn!("a document's file is not in the folder; it stays incomplete");
            continue;
        };
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Some((format, size)) = intake::describe(&bytes) else {
            log::warn!("a document's file is not one this product keeps; it stays incomplete");
            continue;
        };
        conn.execute(
            "UPDATE document SET media_type = ?2, bytes = ?3, width = ?4, height = ?5
             WHERE id = ?1",
            params![
                id,
                format.media_type(),
                bytes.len() as i64,
                size.map(|(w, _)| i64::from(w)),
                size.map(|(_, h)| i64::from(h))
            ],
        )?;
    }
    Ok(())
}

/// A document's hash, media type and name.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work.
pub fn file_of(conn: &Connection, id: &str) -> Result<(String, Option<String>, String)> {
    conn.query_row(
        "SELECT file_hash, media_type, file_name FROM document WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()?
    .ok_or_else(|| Error::InvalidInput(DOCUMENT_NOT_FOUND.into()))
}

/// Every document's id, name and hash — what `documents_verify` re-reads.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn all_files(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let rows = conn
        .prepare("SELECT id, file_name, file_hash FROM document ORDER BY added_on, created_at, id")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
