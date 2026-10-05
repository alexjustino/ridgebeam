//! What happened to a purchase (G2): ordered, delivered, or the order fell
//! through. Written once, read ever after.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the receipts' writer, for the same reason: an order placed and
//! a delivery taken are facts. A mistake is not rewritten; an order that fell
//! through is a new line that says so (`cancelled`), and the purchase is to
//! order again. A test (`db::purchases_tests`) reads this file's source and
//! fails if a line of code in it names any of those three words; the schema
//! refuses them again with triggers and checks the order of what can happen
//! itself (work migration 018).
//!
//! The order of what can happen, said here first with a sentence naming the
//! purchase:
//!
//! - `ordered` first, or after a `cancelled` — never twice in a row;
//! - `delivered` and `cancelled` only on an open order — one `ordered` not
//!   yet delivered nor cancelled;
//! - nothing after `delivered`;
//! - never on a day before the event it follows.
//!
//! An event's day is never after today: the commands check it against the
//! host's clock before anything is written here.
//!
//! # Changelog of this repository
//!
//! - G2: `append`, `list`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::PurchaseEvent;
use crate::db::now;
use crate::db::purchases::PURCHASE_NOT_FOUND;
use crate::error::{Error, Result};

/// What happened to a purchase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// The order was placed.
    Ordered,
    /// It arrived.
    Delivered,
    /// The order fell through: the purchase is to order again.
    Cancelled,
}

impl Kind {
    /// The word the file and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Ordered => "ordered",
            Kind::Delivered => "delivered",
            Kind::Cancelled => "cancelled",
        }
    }
}

/// An event about to be recorded; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEvent {
    /// The purchase.
    pub purchase_id: String,
    /// What happened.
    pub kind: Kind,
    /// `YYYY-MM-DD`, not after today.
    pub day: String,
    /// A few words.
    pub note: Option<String>,
    /// The account that recorded it.
    pub author_name: String,
}

/// The sentence for a delivery with no open order.
pub fn delivered_without_order(name: &str) -> String {
    format!("“{name}” has no open order: it is marked as delivered only once it has been ordered.")
}

/// The sentence for a cancellation with no open order.
pub fn cancelled_without_order(name: &str) -> String {
    format!(
        "“{name}” has no open order to fall through: only an order not yet delivered falls through."
    )
}

/// The sentence for an order placed while one is open.
pub fn ordered_twice(name: &str, day: &str) -> String {
    format!(
        "“{name}” was already ordered on {day}: it is ordered again only if that order falls through."
    )
}

/// The sentence for anything after a delivery.
pub fn after_delivered(name: &str, day: &str) -> String {
    format!(
        "“{name}” was delivered on {day}: nothing more happens to a purchase once it is delivered."
    )
}

/// The sentence for an event dated before the one it follows.
pub fn before_the_last(name: &str, kind: &str, day: &str) -> String {
    format!("“{name}” was {kind} on {day}: what happens next is on that day or later.")
}

/// Append what happened to a purchase; returns the event's `seq`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a purchase not in this work, or an event the
/// order of what can happen does not allow (the module's header), each with
/// its sentence; [`Error::Database`] when the row cannot be written. Nothing
/// is written on any of them.
pub fn append(conn: &Connection, new: &NewEvent) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    let name: String = tx
        .query_row(
            "SELECT name FROM purchase WHERE id = ?1",
            [&new.purchase_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(PURCHASE_NOT_FOUND.into()))?;
    let last: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT seq, kind, day FROM purchase_event WHERE purchase_id = ?1
             ORDER BY seq DESC LIMIT 1",
            [&new.purchase_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let last_kind = last.as_ref().map(|(_, kind, _)| kind.as_str());
    let refused = match (new.kind, &last) {
        (_, Some((_, kind, day))) if kind == "delivered" => Some(after_delivered(&name, day)),
        (Kind::Ordered, Some((_, kind, day))) if kind == "ordered" => {
            Some(ordered_twice(&name, day))
        }
        (Kind::Delivered, _) if last_kind != Some("ordered") => {
            Some(delivered_without_order(&name))
        }
        (Kind::Cancelled, _) if last_kind != Some("ordered") => {
            Some(cancelled_without_order(&name))
        }
        (_, Some((_, kind, day))) if new.day < *day => Some(before_the_last(&name, kind, day)),
        _ => None,
    };
    if let Some(sentence) = refused {
        return Err(Error::InvalidInput(sentence));
    }

    let seq = last.map_or(1, |(seq, _, _)| seq + 1);
    tx.execute(
        "INSERT INTO purchase_event
           (purchase_id, seq, kind, day, note, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            new.purchase_id,
            seq,
            new.kind.as_str(),
            new.day,
            new.note,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!("a purchase was marked as {}", new.kind.as_str());
    Ok(seq)
}

/// Every event, by purchase and then by `seq`.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<PurchaseEvent>> {
    let events = conn
        .prepare(
            "SELECT purchase_id, seq, kind, day, note, author_name, created_at
             FROM purchase_event ORDER BY purchase_id, seq",
        )?
        .query_map([], |row| {
            Ok(PurchaseEvent {
                purchase_id: row.get(0)?,
                seq: row.get(1)?,
                kind: row.get(2)?,
                day: row.get(3)?,
                note: row.get(4)?,
                author_name: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(events)
}
