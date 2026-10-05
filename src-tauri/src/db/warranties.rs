//! Warranties (G4): what the work came with — what each is for, who gives it,
//! from when and for how long — on the work, a room or a stage.
//!
//! A warranty is what the paper says, typed by the person: it is written,
//! changed, moved and removed at any time, and a correction is an edit. Nothing
//! here reads the paper, and nothing here computes the day it ends: that is the
//! domain's, every time (calendar months, the same day `months` later).
//!
//! Its paper, when it has one, is a document of the work filed as a
//! `warranty`: another kind is refused with a sentence, and by the schema after
//! it (`aftercare: document`). A document removed, or filed again as another
//! kind, lets go of the warranty (work migration 019).
//!
//! Targets and order are the care notes' (`db::care_notes`): a target is named
//! by kind and id and is not a foreign key — the work by its `work_id` — and
//! each target's warranties are one sequence, 1..n ([`WARRANTIES`]). The
//! warranties that name a room or a stage are removed here, inside the
//! transaction that removes it ([`remove_for`], called by
//! `db::rooms::remove_room` and `db::work::remove_stage`).
//!
//! # Changelog of this repository
//!
//! - G4: warranties listed, added, written whole, moved and removed; a removed
//!   room's or stage's warranties removed with it; work migration 019.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Warranty;
use crate::db::care_notes::check_target_as;
use crate::db::documents::DOCUMENT_NOT_FOUND;
use crate::db::order::{Direction, WARRANTIES};
use crate::db::work::found;
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a warranty id that is not in this work.
pub const WARRANTY_NOT_FOUND: &str = "That warranty is not in this work.";

/// The sentence for a target kind that is not one.
pub const WARRANTY_TARGET_KIND: &str = "A warranty covers the work, a room or a stage.";

/// The sentence for a paper that is not filed as a warranty.
pub const WARRANTY_DOCUMENT_KIND: &str =
    "That document is not filed as a warranty: a warranty's paper is a document of the kind warranty.";

/// A warranty about to be written; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WarrantyFields {
    /// `work`, `room` or `stage`.
    pub target_kind: String,
    /// The room's or the stage's id; for the work, its `work_id`.
    pub target_id: String,
    /// What it is for.
    pub title: String,
    /// Who gives it.
    pub given_by: Option<String>,
    /// `YYYY-MM-DD`.
    pub starts_on: String,
    /// Whole calendar months, 1 to 600.
    pub months: i64,
    /// A document filed as a warranty.
    pub document_id: Option<String>,
    /// More words.
    pub note: Option<String>,
}

/// Every warranty: the work's first, then each room's in the rooms' order,
/// then each stage's in the stages' order; by position within each — the care
/// notes' order. A warranty whose target is gone — which the host never
/// leaves — is listed last.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Warranty>> {
    let warranties = conn
        .prepare(
            "SELECT w.id, w.position, w.target_kind, w.target_id, w.title, w.given_by,
                    w.starts_on, w.months, w.document_id, w.note, w.created_at
             FROM warranty w
             LEFT JOIN room r ON w.target_kind = 'room' AND r.id = w.target_id
             LEFT JOIN stage s ON w.target_kind = 'stage' AND s.id = w.target_id
             ORDER BY CASE w.target_kind WHEN 'work' THEN 0 WHEN 'room' THEN 1 ELSE 2 END,
                      coalesce(r.position, s.position, 0), w.target_id, w.position",
        )?
        .query_map([], |row| {
            Ok(Warranty {
                id: row.get(0)?,
                position: row.get(1)?,
                target_kind: row.get(2)?,
                target_id: row.get(3)?,
                title: row.get(4)?,
                given_by: row.get(5)?,
                starts_on: row.get(6)?,
                months: row.get(7)?,
                document_id: row.get(8)?,
                note: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(warranties)
}

/// Refuse a target not in this work, and a paper that is not a document of
/// this work filed as a warranty.
fn refuse_unless_placed(conn: &Connection, fields: &WarrantyFields) -> Result<()> {
    check_target_as(
        conn,
        &fields.target_kind,
        &fields.target_id,
        WARRANTY_TARGET_KIND,
    )?;
    if let Some(document) = &fields.document_id {
        let kind: String = conn
            .query_row(
                "SELECT kind FROM document WHERE id = ?1",
                [document],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::InvalidInput(DOCUMENT_NOT_FOUND.into()))?;
        if kind != "warranty" {
            return Err(Error::InvalidInput(WARRANTY_DOCUMENT_KIND.into()));
        }
    }
    Ok(())
}

/// Add a warranty at the end of its target's; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a target not in this work, a document not in
/// this work or not filed as a warranty; [`Error::Database`] when the row
/// cannot be written.
pub fn add(conn: &Connection, fields: &WarrantyFields) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    refuse_unless_placed(&tx, fields)?;
    let id = new_id();
    tx.execute(
        "INSERT INTO warranty
           (id, target_kind, target_id, position, title, given_by, starts_on, months,
            document_id, note, created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT coalesce(max(position), 0) + 1 FROM warranty
                  WHERE target_kind = ?2 AND target_id = ?3),
                 ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            fields.target_kind,
            fields.target_id,
            fields.title,
            fields.given_by,
            fields.starts_on,
            fields.months,
            fields.document_id,
            fields.note,
            now()
        ],
    )?;
    tx.commit()?;
    Ok(id)
}

/// Write a warranty's fields whole. A warranty moved to another target goes to
/// the end of that target's, and the warranties it left close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a warranty not in this work, a target not in
/// this work, or a document not in this work or not filed as a warranty.
pub fn update(conn: &Connection, id: &str, fields: &WarrantyFields) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let held: (String, String) = tx
        .query_row(
            "SELECT target_kind, target_id FROM warranty WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(WARRANTY_NOT_FOUND.into()))?;
    refuse_unless_placed(&tx, fields)?;
    let moved = held != (fields.target_kind.clone(), fields.target_id.clone());
    let changed = tx.execute(
        "UPDATE warranty SET target_kind = ?2, target_id = ?3, title = ?4, given_by = ?5,
                             starts_on = ?6, months = ?7, document_id = ?8, note = ?9,
                             position = CASE WHEN ?10 THEN
                                 (SELECT coalesce(max(position), 0) + 1 FROM warranty
                                  WHERE target_kind = ?2 AND target_id = ?3)
                               ELSE position END
         WHERE id = ?1",
        params![
            id,
            fields.target_kind,
            fields.target_id,
            fields.title,
            fields.given_by,
            fields.starts_on,
            fields.months,
            fields.document_id,
            fields.note,
            moved
        ],
    )?;
    found(changed, WARRANTY_NOT_FOUND)?;
    if moved {
        WARRANTIES.close_gaps(&tx, Some(&format!("{}:{}", held.0, held.1)))?;
    }
    tx.commit()?;
    Ok(())
}

/// Move a warranty one step among its target's.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a warranty not in this work.
pub fn move_one(conn: &Connection, id: &str, direction: Direction) -> Result<()> {
    WARRANTIES.move_one(conn, id, direction)
}

/// Remove a warranty; the ones after it close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a warranty not in this work.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let scope = WARRANTIES.scope_of(&tx, id)?;
    tx.execute("DELETE FROM warranty WHERE id = ?1", [id])?;
    WARRANTIES.close_gaps(&tx, scope.as_deref())?;
    tx.commit()?;
    Ok(())
}

/// Remove every warranty on a room or a stage. Called inside the transaction
/// that removes the room or the stage.
///
/// # Errors
///
/// [`Error::Database`] when the rows cannot be removed.
pub fn remove_for(conn: &Connection, kind: &str, target_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM warranty WHERE target_kind = ?1 AND target_id = ?2",
        params![kind, target_id],
    )?;
    Ok(())
}
