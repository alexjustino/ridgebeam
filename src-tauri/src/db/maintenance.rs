//! Maintenance (G4): what the work needs again and again after the handover —
//! reseal the shower every 12 months, clean the gutters every 6 — on the work,
//! a room or a stage. Each time a task is done is `db::maintenance_done`, which
//! holds no statement that edits or removes a row.
//!
//! A task is written, changed — its frequency too — and moved at any time:
//! the next due day is the domain's, computed every time from the last time it
//! was done, so a new frequency counts from there. The one lock is the
//! records': a task that has been done is not removed (`invalid_input` with
//! the sentence), and neither is the room or the stage it is on, since each
//! time it was done is a fact and keeps what it was done to. The schema
//! refuses both again (a foreign key with no action; `aftercare: done on
//! record`, work migration 019).
//!
//! Targets and order are the care notes' (`db::care_notes`): a target is named
//! by kind and id and is not a foreign key, and each target's tasks are one
//! sequence, 1..n ([`MAINTENANCE`]). The tasks that name a room or a stage are
//! removed here, inside the transaction that removes it ([`remove_for`], after
//! [`refuse_if_done_on`], both called by `db::rooms::remove_room` and
//! `db::work::remove_stage`).
//!
//! # Changelog of this repository
//!
//! - G4: tasks listed (each with each time it was done), added, written whole,
//!   moved and removed while never done; a removed room's or stage's tasks
//!   removed with it, and its removal refused while a task on it has been
//!   done; work migration 019.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::MaintenanceTask;
use crate::db::care_notes::check_target_as;
use crate::db::maintenance_done;
use crate::db::order::{Direction, MAINTENANCE};
use crate::db::work::{exists, found};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a task id that is not in this work.
pub const MAINTENANCE_NOT_FOUND: &str = "That maintenance task is not in this work.";

/// The sentence for a target kind that is not one.
pub const MAINTENANCE_TARGET_KIND: &str = "A maintenance task is on the work, a room or a stage.";

/// The sentence for removing a task that has been done.
pub const MAINTENANCE_ON_RECORD: &str =
    "That task has been done, and each time is on record: it cannot be removed.";

/// The sentence for removing a room a task on it has been done on.
pub const ROOM_HAS_MAINTENANCE_DONE: &str =
    "A maintenance task on this room has been done, and each time is on record: the room cannot be removed.";

/// The sentence for removing a stage a task on it has been done on.
pub const STAGE_HAS_MAINTENANCE_DONE: &str =
    "A maintenance task on this stage has been done, and each time is on record: the stage cannot be removed.";

/// A task about to be written; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskFields {
    /// `work`, `room` or `stage`.
    pub target_kind: String,
    /// The room's or the stage's id; for the work, its `work_id`.
    pub target_id: String,
    /// What is to be done.
    pub title: String,
    /// Whole calendar months, 1 to 120.
    pub every_months: i64,
    /// `YYYY-MM-DD`.
    pub first_due_on: String,
    /// More words.
    pub note: Option<String>,
}

/// Every task, in the care notes' order — the work's first, then each room's
/// in the rooms' order, then each stage's in the stages' order; by position
/// within each — each with each time it was done, by `seq`.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<MaintenanceTask>> {
    let mut done_of: HashMap<String, Vec<_>> = HashMap::new();
    for done in maintenance_done::list(conn)? {
        done_of.entry(done.task_id.clone()).or_default().push(done);
    }
    let tasks = conn
        .prepare(
            "SELECT t.id, t.position, t.target_kind, t.target_id, t.title, t.every_months,
                    t.first_due_on, t.note, t.created_at
             FROM maintenance_task t
             LEFT JOIN room r ON t.target_kind = 'room' AND r.id = t.target_id
             LEFT JOIN stage s ON t.target_kind = 'stage' AND s.id = t.target_id
             ORDER BY CASE t.target_kind WHEN 'work' THEN 0 WHEN 'room' THEN 1 ELSE 2 END,
                      coalesce(r.position, s.position, 0), t.target_id, t.position",
        )?
        .query_map([], |row| {
            Ok(MaintenanceTask {
                id: row.get(0)?,
                position: row.get(1)?,
                target_kind: row.get(2)?,
                target_id: row.get(3)?,
                title: row.get(4)?,
                every_months: row.get(5)?,
                first_due_on: row.get(6)?,
                note: row.get(7)?,
                created_at: row.get(8)?,
                done: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut task| {
            task.done = done_of.remove(&task.id).unwrap_or_default();
            task
        })
        .collect();
    Ok(tasks)
}

/// Add a task at the end of its target's; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a target not in this work; [`Error::Database`]
/// when the row cannot be written.
pub fn add(conn: &Connection, fields: &TaskFields) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    check_target_as(
        &tx,
        &fields.target_kind,
        &fields.target_id,
        MAINTENANCE_TARGET_KIND,
    )?;
    let id = new_id();
    tx.execute(
        "INSERT INTO maintenance_task
           (id, target_kind, target_id, position, title, every_months, first_due_on, note,
            created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT coalesce(max(position), 0) + 1 FROM maintenance_task
                  WHERE target_kind = ?2 AND target_id = ?3),
                 ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            fields.target_kind,
            fields.target_id,
            fields.title,
            fields.every_months,
            fields.first_due_on,
            fields.note,
            now()
        ],
    )?;
    tx.commit()?;
    Ok(id)
}

/// Write a task's fields whole — its frequency too, done or not. A task moved
/// to another target goes to the end of that target's, and the tasks it left
/// close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a task not in this work, or a target not in
/// this work.
pub fn update(conn: &Connection, id: &str, fields: &TaskFields) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let held: (String, String) = tx
        .query_row(
            "SELECT target_kind, target_id FROM maintenance_task WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(MAINTENANCE_NOT_FOUND.into()))?;
    check_target_as(
        &tx,
        &fields.target_kind,
        &fields.target_id,
        MAINTENANCE_TARGET_KIND,
    )?;
    let moved = held != (fields.target_kind.clone(), fields.target_id.clone());
    let changed = tx.execute(
        "UPDATE maintenance_task
         SET target_kind = ?2, target_id = ?3, title = ?4, every_months = ?5,
             first_due_on = ?6, note = ?7,
             position = CASE WHEN ?8 THEN
                 (SELECT coalesce(max(position), 0) + 1 FROM maintenance_task
                  WHERE target_kind = ?2 AND target_id = ?3)
               ELSE position END
         WHERE id = ?1",
        params![
            id,
            fields.target_kind,
            fields.target_id,
            fields.title,
            fields.every_months,
            fields.first_due_on,
            fields.note,
            moved
        ],
    )?;
    found(changed, MAINTENANCE_NOT_FOUND)?;
    if moved {
        MAINTENANCE.close_gaps(&tx, Some(&format!("{}:{}", held.0, held.1)))?;
    }
    tx.commit()?;
    Ok(())
}

/// Move a task one step among its target's.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a task not in this work.
pub fn move_one(conn: &Connection, id: &str, direction: Direction) -> Result<()> {
    MAINTENANCE.move_one(conn, id, direction)
}

/// Remove a task that has never been done; the ones after it close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a task not in this work, or one that has been
/// done ([`MAINTENANCE_ON_RECORD`]).
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let scope = MAINTENANCE.scope_of(&tx, id)?;
    if exists(&tx, "SELECT 1 FROM maintenance_done WHERE task_id = ?1", id)? {
        return Err(Error::InvalidInput(MAINTENANCE_ON_RECORD.into()));
    }
    tx.execute("DELETE FROM maintenance_task WHERE id = ?1", [id])?;
    MAINTENANCE.close_gaps(&tx, scope.as_deref())?;
    tx.commit()?;
    Ok(())
}

/// Refuse to remove a room or a stage a task on it has been done on — called
/// by `db::rooms::remove_room` and `db::work::remove_stage` before it goes,
/// inside their transaction.
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`ROOM_HAS_MAINTENANCE_DONE`] or
/// [`STAGE_HAS_MAINTENANCE_DONE`].
pub fn refuse_if_done_on(conn: &Connection, kind: &str, target_id: &str) -> Result<()> {
    let done = conn
        .query_row(
            "SELECT 1 FROM maintenance_task t JOIN maintenance_done d ON d.task_id = t.id
             WHERE t.target_kind = ?1 AND t.target_id = ?2",
            params![kind, target_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !done {
        return Ok(());
    }
    let sentence = if kind == "room" {
        ROOM_HAS_MAINTENANCE_DONE
    } else {
        STAGE_HAS_MAINTENANCE_DONE
    };
    Err(Error::InvalidInput(sentence.into()))
}

/// Remove every task on a room or a stage — none of them done: the caller
/// refused first ([`refuse_if_done_on`]). Called inside the transaction that
/// removes the room or the stage.
///
/// # Errors
///
/// [`Error::Database`] when the rows cannot be removed.
pub fn remove_for(conn: &Connection, kind: &str, target_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM maintenance_task WHERE target_kind = ?1 AND target_id = ?2",
        params![kind, target_id],
    )?;
    Ok(())
}
