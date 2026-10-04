//! Answers to checks: who said what about a gate's question, and when. Written
//! once, read ever after.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the same rule as the diary's writer, and for the same reason: an answer is a
//! fact. Re-answering a check appends the next answer (`seq` + 1); the latest
//! counts, and every earlier one stays. A test (`db::checks`) reads this file's
//! source and fails if a line of code in it names any of those three words; the
//! schema refuses them again with triggers (work migration 006).
//!
//! There is no hash chain here. The chain is the diary's, because the diary is
//! the record of the site; an answer is a fact about a gate.
//!
//! # Changelog of this repository
//!
//! - F5: `append` and `list`.
//! - D3: a "yes" without a photo on a check that needs one is refused
//!   ([`NEEDS_PHOTO`]); "no", and "na" with its reason, are not. The schema
//!   refuses it again (`checks: needs a photo`, work migration 012).

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::CheckAnswer;
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a check id that is not in this work.
pub const CHECK_NOT_FOUND: &str = "That check is not in this work.";

/// The sentence for a "yes" without a photo on a check that needs one.
pub const NEEDS_PHOTO: &str = "This check needs a photo of the work before it is closed.";

/// An answer about to be written; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAnswer {
    /// The check.
    pub check_id: String,
    /// `yes`, `no` or `na`.
    pub answer: String,
    /// Why; always present for `na`.
    pub reason: Option<String>,
    /// A photo already copied into the work, by hash.
    pub photo_hash: Option<String>,
    /// The account that answered.
    pub author_name: String,
}

/// Append an answer to a check; returns its `seq`.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the check is not in this work, or for a "yes"
/// without a photo on a check that needs one ([`NEEDS_PHOTO`]);
/// [`Error::Database`] when the row cannot be written.
pub fn append(conn: &Connection, new: &NewAnswer) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    // The flag by its name: a file older than work migration 012 — which only
    // a test of an upgrade writes answers into — has no such column, and no
    // check of it needs a photo.
    let needs_photo: bool = tx
        .query_row(
            "SELECT * FROM stage_check WHERE id = ?1",
            [&new.check_id],
            |row| Ok(row.get::<_, i64>("needs_photo").unwrap_or(0) == 1),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(CHECK_NOT_FOUND.into()))?;
    if needs_photo && new.answer == "yes" && new.photo_hash.is_none() {
        return Err(Error::InvalidInput(NEEDS_PHOTO.into()));
    }
    let seq: i64 = tx.query_row(
        "SELECT coalesce(max(seq), 0) + 1 FROM check_answer WHERE check_id = ?1",
        [&new.check_id],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO check_answer
           (id, check_id, seq, answer, reason, photo_hash, author_name, answered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new_id(),
            new.check_id,
            seq,
            new.answer,
            new.reason,
            new.photo_hash,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    Ok(seq)
}

/// Every answer, in the checks' order — stage position, start gate before
/// close, check position — and then by `seq`.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<CheckAnswer>> {
    let answers = conn
        .prepare(
            "SELECT a.id, a.check_id, a.seq, a.answer, a.reason, a.photo_hash, a.author_name,
                    a.answered_at
             FROM check_answer a
             JOIN stage_check c ON c.id = a.check_id
             JOIN stage s ON s.id = c.stage_id
             ORDER BY s.position, CASE c.gate WHEN 'start' THEN 0 ELSE 1 END, c.position, a.seq",
        )?
        .query_map([], |row| {
            Ok(CheckAnswer {
                id: row.get(0)?,
                check_id: row.get(1)?,
                seq: row.get(2)?,
                answer: row.get(3)?,
                reason: row.get(4)?,
                photo_hash: row.get(5)?,
                author_name: row.get(6)?,
                answered_at: row.get(7)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(answers)
}
