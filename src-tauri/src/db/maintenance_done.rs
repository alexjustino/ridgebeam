//! Each time a maintenance task was done (G4). Written once, read ever after.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the receipts' and the purchases' writers, for the same reason:
//! the gutters cleaned on a day is a fact. A mistake is not rewritten; the
//! next time is a new line. A test (`db::aftercare_tests`) reads this file's
//! source and fails if a line of code in it names any of those three words;
//! the schema refuses them again with triggers, and holds the order itself
//! (work migration 019).
//!
//! Never before the time it follows: said here first with a sentence naming
//! the task, and by the schema after it (`aftercare: out of order`). The same
//! day as the time before is allowed — two times on one day are two times. A
//! day is never after today: the commands check it against the host's clock
//! before anything is written here.
//!
//! # Changelog of this repository
//!
//! - G4: `append`, `list`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::MaintenanceDone;
use crate::db::maintenance::MAINTENANCE_NOT_FOUND;
use crate::db::now;
use crate::error::{Error, Result};

/// A time a task was done, about to be recorded; every field already checked
/// on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDone {
    /// The task.
    pub task_id: String,
    /// `YYYY-MM-DD`, not after today.
    pub done_on: String,
    /// A few words.
    pub note: Option<String>,
    /// The account that recorded it.
    pub author_name: String,
}

/// The sentence for a time dated before the one it follows.
pub fn before_the_last(title: &str, day: &str) -> String {
    format!("“{title}” was last done on {day}: the next time is on that day or later.")
}

/// Record that a task was done; returns the record's `seq`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a task not in this work, or a day before the
/// time it follows, each with its sentence; [`Error::Database`] when the row
/// cannot be written. Nothing is written on any of them.
pub fn append(conn: &Connection, new: &NewDone) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    let title: String = tx
        .query_row(
            "SELECT title FROM maintenance_task WHERE id = ?1",
            [&new.task_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(MAINTENANCE_NOT_FOUND.into()))?;
    let last: Option<(i64, String)> = tx
        .query_row(
            "SELECT seq, done_on FROM maintenance_done WHERE task_id = ?1
             ORDER BY seq DESC LIMIT 1",
            [&new.task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((_, day)) = &last {
        if new.done_on < *day {
            return Err(Error::InvalidInput(before_the_last(&title, day)));
        }
    }

    let seq = last.map_or(1, |(seq, _)| seq + 1);
    tx.execute(
        "INSERT INTO maintenance_done (task_id, seq, done_on, note, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            new.task_id,
            seq,
            new.done_on,
            new.note,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!("a maintenance task was recorded as done");
    Ok(seq)
}

/// Every record, by task and then by `seq`.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<MaintenanceDone>> {
    let records = conn
        .prepare(
            "SELECT task_id, seq, done_on, note, author_name, created_at
             FROM maintenance_done ORDER BY task_id, seq",
        )?
        .query_map([], |row| {
            Ok(MaintenanceDone {
                task_id: row.get(0)?,
                seq: row.get(1)?,
                done_on: row.get(2)?,
                note: row.get(3)?,
                author_name: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(records)
}
