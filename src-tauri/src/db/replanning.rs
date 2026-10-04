//! Replanning: an approved plan is locked until somebody says why it changes.
//!
//! Once the plan is approved (`work.approved_at`, set by baseline 1), every
//! command that changes what a baseline records — the stages, the activities'
//! names, durations and order, the dependencies, the calendar, the start date,
//! the cost lines — is refused with [`Error::PlanApproved`] unless a
//! replanning is open. The commands ask [`refuse_if_plan_locked`] first. Facts
//! never ask: the diary, answers, a stage's start and close, payments,
//! commitments, decisions, people, rooms and documents stay free.
//!
//! A replanning is a row, not a mode of the interface: it survives a restart.
//! It is opened with a reason ([`open`]), at most one at a time, and closed
//! only by taking the next baseline, which copies its reason ([`close`], called
//! by `db::baselines::take` inside the transaction that takes it). There is no
//! abandon: an edit already in the file ends in a baseline.
//!
//! The schema keeps a replanning written once (work migration 009): its reason
//! never changes, it is closed once, and it is never removed.
//!
//! # Changelog of this repository
//!
//! - F8: `refuse_if_plan_locked`, `open`, `current`, `open_reason`, `close`.
//! - E1: `open_within`, for the change order whose approval opens one.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Replanning;
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a change to an approved plan with no replanning open.
pub const PLAN_APPROVED: &str =
    "The plan is approved. To change it, replan it with a reason first.";

/// The sentence for a baseline after the first with no replanning open.
pub const REASON_NEEDED: &str = "A second baseline needs the reason the plan changed.";

/// The sentence for a replanning asked for before the plan is approved.
pub const NOT_APPROVED_YET: &str =
    "The plan is not approved yet, so there is nothing to replan: change it freely.";

/// The sentence for a second replanning while one is open.
pub const ALREADY_OPEN: &str =
    "A replanning is already open. Take the next baseline to close it before opening another.";

/// Whether the plan has been approved.
///
/// # Errors
///
/// [`Error::Database`] when the work row cannot be read.
pub(crate) fn approved(conn: &Connection) -> Result<bool> {
    let approved_at: Option<String> =
        conn.query_row("SELECT approved_at FROM work WHERE id = 1", [], |row| {
            row.get(0)
        })?;
    Ok(approved_at.is_some())
}

/// Refuse a change to the plan when it is approved and no replanning is open.
/// A plan not yet approved, or one being replanned, is changed freely.
///
/// # Errors
///
/// [`Error::PlanApproved`] with [`PLAN_APPROVED`]; [`Error::Database`] when
/// the file cannot be read.
pub fn refuse_if_plan_locked(conn: &Connection) -> Result<()> {
    if approved(conn)? && current(conn)?.is_none() {
        return Err(Error::PlanApproved(PLAN_APPROVED.into()));
    }
    Ok(())
}

/// Open a replanning with its reason, signed by `author_name`. The reason is
/// already checked (`validate::replan_reason`).
///
/// # Errors
///
/// [`Error::InvalidInput`] when the plan is not approved yet
/// ([`NOT_APPROVED_YET`]) or a replanning is already open ([`ALREADY_OPEN`]);
/// [`Error::Database`] when the row is refused.
pub fn open(conn: &Connection, reason: &str, author_name: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    open_within(&tx, reason, author_name)?;
    tx.commit()?;
    Ok(())
}

/// [`open`], inside a transaction the caller already holds and commits (E1:
/// an approved change order opens the replanning it is written into, with its
/// decision or not at all). Returns the replanning's id.
///
/// # Errors
///
/// As [`open`].
pub fn open_within(tx: &Connection, reason: &str, author_name: &str) -> Result<String> {
    if !approved(tx)? {
        return Err(Error::InvalidInput(NOT_APPROVED_YET.into()));
    }
    if current(tx)?.is_some() {
        return Err(Error::InvalidInput(ALREADY_OPEN.into()));
    }
    let id = new_id();
    tx.execute(
        "INSERT INTO replanning (id, reason, opened_at, author_name) VALUES (?1, ?2, ?3, ?4)",
        params![id, reason, now(), author_name],
    )?;
    log::info!("a replanning was opened");
    Ok(id)
}

/// The replanning that is open, or `None`.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn current(conn: &Connection) -> Result<Option<Replanning>> {
    let open = conn
        .query_row(
            "SELECT id, reason, opened_at, author_name FROM replanning WHERE closed_at IS NULL",
            [],
            |row| {
                Ok(Replanning {
                    id: row.get(0)?,
                    reason: row.get(1)?,
                    opened_at: row.get(2)?,
                    author_name: row.get(3)?,
                })
            },
        )
        .optional()?;
    Ok(open)
}

/// The reason of the replanning that is open, or `None`.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn open_reason(conn: &Connection) -> Result<Option<String>> {
    Ok(current(conn)?.map(|replanning| replanning.reason))
}

/// Close the open replanning: baseline `number` was taken for it. Called only
/// inside the transaction that takes that baseline.
///
/// # Errors
///
/// [`Error::Database`] when no replanning is open or the row is refused.
pub fn close(conn: &Connection, number: i64) -> Result<()> {
    let closed = conn.execute(
        "UPDATE replanning SET closed_at = ?1, baseline_number = ?2 WHERE closed_at IS NULL",
        params![now(), number],
    )?;
    if closed != 1 {
        return Err(Error::Database(rusqlite::Error::QueryReturnedNoRows));
    }
    log::info!("the replanning was closed by baseline {number}");
    Ok(())
}
