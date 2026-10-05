//! Purchases (G2): what an activity needs that takes time to arrive — a
//! worktop, windows, the tiles — with how long the supplier takes. What
//! happened to each (ordered, delivered, the order fell through) is
//! `db::purchase_events`, which holds no statement that edits or removes a
//! row.
//!
//! A purchase is plan, not fact: it is added, written whole and removed at
//! any time, approved plan or not — buying is the work, not its scope. The one
//! lock is the events': a purchase something has happened to is not removed
//! (`invalid_input` with the sentence), and neither is the stage it is on,
//! since what happened is a fact and keeps what it happened to. Its name,
//! quantity, supplier and note can still be changed; its lead time, its stage
//! and its activity are fixed once it has been ordered — an order keeps the
//! lead time it was placed with — and an activity a purchase on record needs
//! is not removed.
//!
//! A purchase is on a stage, and optionally on one of its activities — the
//! one that needs it; none is the stage's first activity, the domain's
//! reading. A closed stage takes one: nothing here refuses it, as nothing
//! refuses a fund.
//!
//! The purchases are one sequence for the work, 1..n ([`PURCHASES`]): a new
//! one is added at the end, and a removal closes the gap it leaves.
//!
//! The day to order by, what is late to order and what is late to arrive are
//! the domain's, computed every time from these rows and the forecast;
//! nothing computed is stored.
//!
//! # Changelog of this repository
//!
//! - G2: purchases listed (each with its events), added, written whole and
//!   removed; the lock that keeps a purchase, and its stage, once something
//!   has happened to it; the lead time, stage and activity fixed once it has
//!   been ordered, and the activity it needs kept; work migration 018.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Purchase;
use crate::db::money::ACTIVITY_OF_ANOTHER_STAGE;
use crate::db::order::PURCHASES;
use crate::db::purchase_events;
use crate::db::work::{exists, found, ACTIVITY_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a purchase id that is not in this work.
pub const PURCHASE_NOT_FOUND: &str = "That purchase is not in this work.";

/// The sentence for removing a purchase something has happened to.
pub const PURCHASE_ON_RECORD: &str =
    "That purchase has been ordered, and what happened to it is on record: it cannot be removed.";

/// The sentence for removing a stage a purchase on record is on.
pub const STAGE_HAS_PURCHASES_ON_RECORD: &str =
    "A purchase of this stage has been ordered, and what happened to it is on record: the stage cannot be removed.";

/// The sentence for changing an ordered purchase's lead time, stage or
/// activity.
pub const PURCHASE_TERMS_FIXED: &str =
    "The lead time, the stage and the activity of a purchase are fixed once it has been ordered: an order keeps the lead time it was placed with.";

/// The sentence for removing an activity a purchase on record needs.
pub const ACTIVITY_HAS_PURCHASES_ON_RECORD: &str =
    "A purchase this activity needs has been ordered, and what happened to it is on record: the activity cannot be removed.";

/// A purchase about to be written; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseFields {
    /// The stage it is for.
    pub stage_id: String,
    /// An activity of that stage, or `None` for its first.
    pub activity_id: Option<String>,
    /// What it is.
    pub name: String,
    /// How much, in words.
    pub quantity: Option<String>,
    /// From whom.
    pub supplier: Option<String>,
    /// Calendar days, 0 to 365.
    pub lead_days: i64,
    /// More words.
    pub note: Option<String>,
}

/// Every purchase, by position, each with its events by `seq`.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Purchase>> {
    let mut events_of: HashMap<String, Vec<_>> = HashMap::new();
    for event in purchase_events::list(conn)? {
        events_of
            .entry(event.purchase_id.clone())
            .or_default()
            .push(event);
    }
    let purchases = conn
        .prepare(
            "SELECT id, position, stage_id, activity_id, name, quantity, supplier, lead_days, note,
                    created_at
             FROM purchase ORDER BY position",
        )?
        .query_map([], |row| {
            Ok(Purchase {
                id: row.get(0)?,
                position: row.get(1)?,
                stage_id: row.get(2)?,
                activity_id: row.get(3)?,
                name: row.get(4)?,
                quantity: row.get(5)?,
                supplier: row.get(6)?,
                lead_days: row.get(7)?,
                note: row.get(8)?,
                created_at: row.get(9)?,
                events: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut purchase| {
            purchase.events = events_of.remove(&purchase.id).unwrap_or_default();
            purchase
        })
        .collect();
    Ok(purchases)
}

/// Refuse a stage not in this work, an activity not in this work, or one of
/// another stage.
fn refuse_unless_placed(conn: &Connection, fields: &PurchaseFields) -> Result<()> {
    if !exists(conn, "SELECT 1 FROM stage WHERE id = ?1", &fields.stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    if let Some(activity) = &fields.activity_id {
        let stage: String = conn
            .query_row(
                "SELECT stage_id FROM activity WHERE id = ?1",
                [activity],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::InvalidInput(ACTIVITY_NOT_FOUND.into()))?;
        if stage != fields.stage_id {
            return Err(Error::InvalidInput(ACTIVITY_OF_ANOTHER_STAGE.into()));
        }
    }
    Ok(())
}

/// Add a purchase at the end; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage or an activity not in this work, or an
/// activity of another stage; [`Error::Database`] when the row cannot be
/// written.
pub fn add(conn: &Connection, fields: &PurchaseFields) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    refuse_unless_placed(&tx, fields)?;
    let id = new_id();
    tx.execute(
        "INSERT INTO purchase
           (id, position, stage_id, activity_id, name, quantity, supplier, lead_days, note,
            created_at)
         VALUES (?1, (SELECT coalesce(max(position), 0) + 1 FROM purchase),
                 ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            fields.stage_id,
            fields.activity_id,
            fields.name,
            fields.quantity,
            fields.supplier,
            fields.lead_days,
            fields.note,
            now()
        ],
    )?;
    tx.commit()?;
    Ok(id)
}

/// Write a purchase's fields whole. Once something has happened to it, only
/// its name, quantity, supplier and note may change.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a purchase not in this work, a stage or an
/// activity not in this work, an activity of another stage, or a change to the
/// lead time, the stage or the activity of a purchase that has been ordered
/// ([`PURCHASE_TERMS_FIXED`]).
pub fn update(conn: &Connection, id: &str, fields: &PurchaseFields) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let held: (String, Option<String>, i64) = tx
        .query_row(
            "SELECT stage_id, activity_id, lead_days FROM purchase WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(PURCHASE_NOT_FOUND.into()))?;
    let terms = (
        fields.stage_id.clone(),
        fields.activity_id.clone(),
        fields.lead_days,
    );
    if terms != held
        && exists(
            &tx,
            "SELECT 1 FROM purchase_event WHERE purchase_id = ?1",
            id,
        )?
    {
        return Err(Error::InvalidInput(PURCHASE_TERMS_FIXED.into()));
    }
    refuse_unless_placed(&tx, fields)?;
    let changed = tx.execute(
        "UPDATE purchase SET stage_id = ?2, activity_id = ?3, name = ?4, quantity = ?5,
                             supplier = ?6, lead_days = ?7, note = ?8
         WHERE id = ?1",
        params![
            id,
            fields.stage_id,
            fields.activity_id,
            fields.name,
            fields.quantity,
            fields.supplier,
            fields.lead_days,
            fields.note
        ],
    )?;
    found(changed, PURCHASE_NOT_FOUND)?;
    tx.commit()?;
    Ok(())
}

/// Remove a purchase nothing has happened to, and close the gap it leaves.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a purchase not in this work, or one an event
/// names.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM purchase WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(PURCHASE_NOT_FOUND.into()));
    }
    if exists(
        &tx,
        "SELECT 1 FROM purchase_event WHERE purchase_id = ?1",
        id,
    )? {
        return Err(Error::InvalidInput(PURCHASE_ON_RECORD.into()));
    }
    tx.execute("DELETE FROM purchase WHERE id = ?1", [id])?;
    PURCHASES.close_gaps(&tx, None)?;
    tx.commit()?;
    Ok(())
}

/// Refuse to remove an activity a purchase on record needs — called by
/// `db::work::remove_activity_within` before the activity goes, inside its
/// transaction. A purchase nothing has happened to lets go of the activity
/// (the schema's `ON DELETE SET NULL`).
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`ACTIVITY_HAS_PURCHASES_ON_RECORD`].
pub fn refuse_if_activity_has_purchases_on_record(
    conn: &Connection,
    activity_id: &str,
) -> Result<()> {
    if exists(
        conn,
        "SELECT 1 FROM purchase p JOIN purchase_event e ON e.purchase_id = p.id
         WHERE p.activity_id = ?1",
        activity_id,
    )? {
        return Err(Error::InvalidInput(ACTIVITY_HAS_PURCHASES_ON_RECORD.into()));
    }
    Ok(())
}

/// Refuse to remove a stage a purchase on record is on — called by
/// `db::work::remove_stage` before the stage goes, inside its transaction.
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`STAGE_HAS_PURCHASES_ON_RECORD`].
pub fn refuse_if_stage_has_purchases_on_record(conn: &Connection, stage_id: &str) -> Result<()> {
    if exists(
        conn,
        "SELECT 1 FROM purchase p JOIN purchase_event e ON e.purchase_id = p.id
         WHERE p.stage_id = ?1",
        stage_id,
    )? {
        return Err(Error::InvalidInput(STAGE_HAS_PURCHASES_ON_RECORD.into()));
    }
    Ok(())
}
