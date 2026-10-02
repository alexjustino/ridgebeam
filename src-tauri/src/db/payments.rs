//! The payments ledger: paid money, one line per payment. Written once, read
//! ever after.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the diary's writer and of the answers', for the same reason: a
//! payment is a fact. A mistake is a new payment that says so — a reversal,
//! with a negative amount, naming the payment it reverses. A test
//! (`db::money`) reads this file's source and fails if a line of code in it
//! names any of those three words; the schema refuses them again with triggers
//! and checks the reversal rules itself (work migration 007).
//!
//! Amounts are whole minor units of the work's currency. There is no hash
//! chain: the chain is the diary's.
//!
//! # Changelog of this repository
//!
//! - F6: `append`, `reverse`, `list`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Payment;
use crate::db::work::{exists, PERSON_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a commitment id that is not in this work.
pub const COMMITMENT_NOT_FOUND: &str = "That commitment is not in this work.";

/// The sentence for a payment against a commitment of another stage.
pub const COMMITMENT_OF_ANOTHER_STAGE: &str =
    "That commitment is for another stage; a payment against it is for the same stage.";

/// A payment about to be written; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewPayment {
    /// `YYYY-MM-DD`, not after today.
    pub day: String,
    /// Who was paid.
    pub person_id: Option<String>,
    /// The stage it is for.
    pub stage_id: String,
    /// The commitment it pays against.
    pub commitment_id: Option<String>,
    /// Minor units, more than 0 (a reversal's is written by [`reverse`]).
    pub amount_cents: i64,
    /// What it was for.
    pub what_for: Option<String>,
    /// A receipt already copied in, by hash.
    pub receipt_hash: Option<String>,
    /// The account that recorded it.
    pub author_name: String,
}

/// Append a payment to the ledger; returns its `seq`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage, a person or a commitment not in this
/// work, or a commitment of another stage; [`Error::Database`] when the row
/// cannot be written.
pub fn append(conn: &Connection, new: &NewPayment) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM stage WHERE id = ?1", &new.stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    if let Some(person) = &new.person_id {
        if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", person)? {
            return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
        }
    }
    if let Some(commitment) = &new.commitment_id {
        let stage: String = tx
            .query_row(
                "SELECT stage_id FROM commitment WHERE id = ?1",
                [commitment],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::InvalidInput(COMMITMENT_NOT_FOUND.into()))?;
        if stage != new.stage_id {
            return Err(Error::InvalidInput(COMMITMENT_OF_ANOTHER_STAGE.into()));
        }
    }
    let seq = write(&tx, new, None)?;
    tx.commit()?;
    Ok(seq)
}

/// Reverse a payment in full, today: a new payment of the opposite amount,
/// for the same stage, person and commitment, with the reason as what it is
/// for. Returns the reversal's `seq`.
///
/// # Errors
///
/// [`Error::MoneyReversal`] for a payment that is not there, is itself a
/// reversal, or has already been reversed; [`Error::Database`] when the row
/// cannot be written.
pub fn reverse(conn: &Connection, seq: i64, why: &str, day: &str, author: &str) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    let original = tx
        .query_row(
            "SELECT person_id, stage_id, commitment_id, amount_cents, reverses_seq
             FROM payment WHERE seq = ?1",
            [seq],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| Error::MoneyReversal(format!("There is no payment #{seq} to reverse.")))?;
    let (person_id, stage_id, commitment_id, amount_cents, reverses) = original;
    if reverses.is_some() {
        return Err(Error::MoneyReversal(format!(
            "Payment #{seq} is itself a reversal; it cannot be reversed."
        )));
    }
    let earlier: Option<i64> = tx
        .query_row(
            "SELECT seq FROM payment WHERE reverses_seq = ?1",
            [seq],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(by) = earlier {
        return Err(Error::MoneyReversal(format!(
            "Payment #{seq} has already been reversed by #{by}."
        )));
    }
    let reversal = NewPayment {
        day: day.to_string(),
        person_id,
        stage_id,
        commitment_id,
        amount_cents: -amount_cents,
        what_for: Some(why.to_string()),
        receipt_hash: None,
        author_name: author.to_string(),
    };
    let written = write(&tx, &reversal, Some(seq))?;
    tx.commit()?;
    Ok(written)
}

/// Insert one row at the end of the ledger.
fn write(conn: &Connection, new: &NewPayment, reverses: Option<i64>) -> Result<i64> {
    let seq: i64 = conn.query_row("SELECT coalesce(max(seq), 0) + 1 FROM payment", [], |row| {
        row.get(0)
    })?;
    conn.execute(
        "INSERT INTO payment
           (id, seq, day, person_id, stage_id, commitment_id, amount_cents, what_for,
            reverses_seq, receipt_hash, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            new_id(),
            seq,
            new.day,
            new.person_id,
            new.stage_id,
            new.commitment_id,
            new.amount_cents,
            new.what_for,
            reverses,
            new.receipt_hash,
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
pub fn list(conn: &Connection) -> Result<Vec<Payment>> {
    let payments = conn
        .prepare(
            "SELECT id, seq, day, person_id, stage_id, commitment_id, amount_cents, what_for,
                    reverses_seq, receipt_hash, author_name, created_at
             FROM payment ORDER BY seq",
        )?
        .query_map([], |row| {
            Ok(Payment {
                id: row.get(0)?,
                seq: row.get(1)?,
                day: row.get(2)?,
                person_id: row.get(3)?,
                stage_id: row.get(4)?,
                commitment_id: row.get(5)?,
                amount_cents: row.get(6)?,
                what_for: row.get(7)?,
                reverses_seq: row.get(8)?,
                receipt_hash: row.get(9)?,
                author_name: row.get(10)?,
                created_at: row.get(11)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(payments)
}
