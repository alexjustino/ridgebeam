//! The money received (E2): one line per sum that arrived. Written once, read
//! ever after.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the payments' writer, for the same reason: money received is a
//! fact. A mistake is a new line that says so — a reversal, the negative of
//! the receipt it reverses, naming it. A test (`db::funding`) reads this
//! file's source and fails if a line of code in it names any of those three
//! words; the schema refuses them again with triggers and checks the reversal
//! rules itself (work migration 014).
//!
//! Amounts are whole minor units of the work's currency. A receipt's day is
//! never after today: the commands check it against the host's clock before
//! anything is written here.
//!
//! # Changelog of this repository
//!
//! - E2: `append`, `reverse`, `list`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::FundingReceipt;
use crate::db::funding::FUNDING_NOT_FOUND;
use crate::db::work::exists;
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// Money received, about to be written; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReceipt {
    /// `YYYY-MM-DD`, not after today.
    pub day: String,
    /// The fund it belongs to, or `None` for money that arrived unplanned.
    pub funding_id: Option<String>,
    /// Minor units, more than 0 (a reversal's is written by [`reverse`]).
    pub amount_cents: i64,
    /// A few words.
    pub note: Option<String>,
    /// The account that recorded it.
    pub author_name: String,
}

/// Append a receipt to the ledger; returns its `seq`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a fund not in this work; [`Error::Database`]
/// when the row cannot be written.
pub fn append(conn: &Connection, new: &NewReceipt) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    if let Some(funding) = &new.funding_id {
        if !exists(&tx, "SELECT 1 FROM funding WHERE id = ?1", funding)? {
            return Err(Error::InvalidInput(FUNDING_NOT_FOUND.into()));
        }
    }
    let seq = write(&tx, new, None)?;
    tx.commit()?;
    Ok(seq)
}

/// Reverse a receipt in full, on `day`: a new line of the opposite amount, for
/// the same fund. Returns the reversal's `seq`.
///
/// # Errors
///
/// [`Error::MoneyReversal`] for a receipt that is not there, is itself a
/// reversal, or has already been reversed; [`Error::InvalidInput`] for a day
/// before the money arrived; [`Error::Database`] when the row cannot be
/// written.
pub fn reverse(conn: &Connection, seq: i64, day: &str, author: &str) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    let (arrived, funding_id, amount_cents, reverses) = tx
        .query_row(
            "SELECT day, funding_id, amount_cents, reverses_seq
             FROM funding_receipt WHERE seq = ?1",
            [seq],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| Error::MoneyReversal(format!("There is no receipt #{seq} to reverse.")))?;
    if reverses.is_some() {
        return Err(Error::MoneyReversal(format!(
            "Receipt #{seq} is itself a reversal; it cannot be reversed."
        )));
    }
    let earlier: Option<i64> = tx
        .query_row(
            "SELECT seq FROM funding_receipt WHERE reverses_seq = ?1",
            [seq],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(by) = earlier {
        return Err(Error::MoneyReversal(format!(
            "Receipt #{seq} has already been reversed by #{by}."
        )));
    }
    if day < arrived.as_str() {
        return Err(Error::InvalidInput(format!(
            "Receipt #{seq} arrived on {arrived}: it is reversed on that day or later."
        )));
    }
    let reversal = NewReceipt {
        day: day.to_string(),
        funding_id,
        amount_cents: -amount_cents,
        note: None,
        author_name: author.to_string(),
    };
    let written = write(&tx, &reversal, Some(seq))?;
    tx.commit()?;
    Ok(written)
}

/// Insert one row at the end of the ledger.
fn write(conn: &Connection, new: &NewReceipt, reverses: Option<i64>) -> Result<i64> {
    let seq: i64 = conn.query_row(
        "SELECT coalesce(max(seq), 0) + 1 FROM funding_receipt",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO funding_receipt
           (id, seq, day, funding_id, amount_cents, note, reverses_seq, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            new_id(),
            seq,
            new.day,
            new.funding_id,
            new.amount_cents,
            new.note,
            reverses,
            new.author_name,
            now()
        ],
    )?;
    Ok(seq)
}

/// The whole ledger, by `seq`.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<FundingReceipt>> {
    let receipts = conn
        .prepare(
            "SELECT id, seq, day, funding_id, amount_cents, note, reverses_seq, author_name,
                    created_at
             FROM funding_receipt ORDER BY seq",
        )?
        .query_map([], |row| {
            Ok(FundingReceipt {
                id: row.get(0)?,
                seq: row.get(1)?,
                day: row.get(2)?,
                funding_id: row.get(3)?,
                amount_cents: row.get(4)?,
                note: row.get(5)?,
                reverses_seq: row.get(6)?,
                author_name: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(receipts)
}
