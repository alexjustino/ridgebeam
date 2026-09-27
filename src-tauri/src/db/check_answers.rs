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

use rusqlite::{params, Connection};

use crate::contract::CheckAnswer;
use crate::db::work::exists;
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a check id that is not in this work.
pub const CHECK_NOT_FOUND: &str = "That check is not in this work.";

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
/// [`Error::InvalidInput`] when the check is not in this work;
/// [`Error::Database`] when the row cannot be written.
pub fn append(conn: &Connection, new: &NewAnswer) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    if !exists(
        &tx,
        "SELECT 1 FROM stage_check WHERE id = ?1",
        &new.check_id,
    )? {
        return Err(Error::InvalidInput(CHECK_NOT_FOUND.into()));
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
