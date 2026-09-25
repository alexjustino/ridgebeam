//! Baselines: the plan as it was approved. Written once, read ever after.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule.**
//! A baseline is requirement one of this product applied to the plan — the
//! record a slip is measured against — and the rule is kept in three places
//! that do not depend on each other:
//!
//! - **Here.** The only statements this module sends that write are `INSERT`s.
//!   A test (`db::append_only_tests`) reads this file's source and fails if a
//!   line of code in it names any of those three words, so a later change that
//!   "just fixes a baseline" cannot compile into a green build.
//! - **In the schema.** Triggers on `baseline` and `baseline_activity` refuse
//!   `UPDATE`, `DELETE` and `REPLACE` with the message `baseline: append-only`,
//!   whatever the connection's pragmas; rows are added only to the latest
//!   baseline (work migration 003).
//! - **At the boundary.** No command edits or removes a baseline. Slice F8 adds
//!   the reason a later baseline was taken, as a new baseline — never as an
//!   edit of an old one.
//!
//! Taking the first baseline is also approving the plan: `work.approved_at` is
//! set in the same transaction. That write is the work row's, and it lives with
//! the work row in `db::work::record_approval`, not here.
//!
//! The schedule is computed in the domain, so the interface sends where each
//! activity was placed; everything else in a row — the name, the stage's name,
//! the duration — is read from the file inside the transaction, so a baseline
//! records what the work held rather than what the interface said it held.
//!
//! # Changelog of this repository
//!
//! - F2: `take` and `list`.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};

use crate::contract::{Baseline, BaselineRow};
use crate::db::work::{record_approval, ACTIVITY_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// Where the schedule placed one activity, already checked: both dates or
/// neither, the start not after the finish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    /// The activity.
    pub activity_id: String,
    /// Its start, `YYYY-MM-DD`.
    pub start: Option<String>,
    /// Its finish, `YYYY-MM-DD`.
    pub finish: Option<String>,
}

/// The sentence for a plan with no activity.
pub const NOTHING_TO_APPROVE: &str = "A plan with no activity has nothing to approve yet.";

/// The sentence for an activity named twice.
pub const NAMED_TWICE: &str = "A baseline records each activity once.";

/// The sentence for a finish date that is not the last finish.
pub const FINISH_IS_THE_LAST: &str =
    "A baseline's finish date is the last finish among its activities.";

/// Take the next baseline: number max + 1, one row per activity, and — for the
/// first — the approval. One transaction; on any refusal nothing is written.
/// Returns the number taken.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the plan has no activity, a row names an
/// activity not in this work, names one twice, or leaves one out, or the finish
/// date is not the last finish among the rows; [`Error::Database`] when a row
/// cannot be written.
pub fn take(conn: &Connection, placements: &[Placement], finish_date: Option<&str>) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;

    // The plan as the file holds it, in breakdown order.
    let held: Vec<(String, String, String, Option<i64>)> = tx
        .prepare(
            "SELECT a.id, a.name, s.name, a.duration_days
             FROM activity a JOIN stage s ON s.id = a.stage_id
             ORDER BY s.position, a.position",
        )?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if held.is_empty() {
        return Err(Error::InvalidInput(NOTHING_TO_APPROVE.into()));
    }

    let known: HashSet<&str> = held.iter().map(|(id, ..)| id.as_str()).collect();
    let mut placed: HashMap<&str, &Placement> = HashMap::new();
    for placement in placements {
        if !known.contains(placement.activity_id.as_str()) {
            return Err(Error::InvalidInput(ACTIVITY_NOT_FOUND.into()));
        }
        if placed
            .insert(placement.activity_id.as_str(), placement)
            .is_some()
        {
            return Err(Error::InvalidInput(NAMED_TWICE.into()));
        }
    }
    let missing = held.len() - placed.len();
    if missing > 0 {
        return Err(Error::InvalidInput(format!(
            "A baseline records every activity in the plan; {missing} {} left out.",
            if missing == 1 { "is" } else { "are" }
        )));
    }

    let last_finish = placements.iter().filter_map(|p| p.finish.as_deref()).max();
    if last_finish != finish_date {
        return Err(Error::InvalidInput(FINISH_IS_THE_LAST.into()));
    }

    let number: i64 = tx.query_row(
        "SELECT coalesce(max(number), 0) + 1 FROM baseline",
        [],
        |row| row.get(0),
    )?;
    let baseline_id = new_id();
    tx.execute(
        "INSERT INTO baseline (id, number, taken_at, reason, finish_date)
         VALUES (?1, ?2, ?3, NULL, ?4)",
        params![baseline_id, number, now(), finish_date],
    )?;
    for (index, (activity_id, name, stage_name, duration_days)) in held.iter().enumerate() {
        let placement = placed[activity_id.as_str()];
        tx.execute(
            "INSERT INTO baseline_activity
               (baseline_id, activity_id, position, name, stage_name, duration_days, start, finish)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                baseline_id,
                activity_id,
                index as i64 + 1,
                name,
                stage_name,
                duration_days,
                placement.start,
                placement.finish
            ],
        )?;
    }
    if number == 1 {
        record_approval(&tx)?;
    }
    tx.commit()?;
    log::info!("baseline {number} was taken");
    Ok(number)
}

/// Every baseline, by number, each with its rows in breakdown order.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Baseline>> {
    let mut rows_of: HashMap<String, Vec<BaselineRow>> = HashMap::new();
    let rows = conn
        .prepare(
            "SELECT baseline_id, activity_id, name, stage_name, duration_days, start, finish
             FROM baseline_activity ORDER BY baseline_id, position",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                BaselineRow {
                    activity_id: row.get(1)?,
                    name: row.get(2)?,
                    stage_name: row.get(3)?,
                    duration_days: row.get(4)?,
                    start: row.get(5)?,
                    finish: row.get(6)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (baseline_id, row) in rows {
        rows_of.entry(baseline_id).or_default().push(row);
    }

    let baselines = conn
        .prepare("SELECT id, number, taken_at, reason, finish_date FROM baseline ORDER BY number")?
        .query_map([], |row| {
            Ok(Baseline {
                id: row.get(0)?,
                number: row.get(1)?,
                taken_at: row.get(2)?,
                reason: row.get(3)?,
                finish_date: row.get(4)?,
                rows: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut baseline| {
            baseline.rows = rows_of.remove(&baseline.id).unwrap_or_default();
            baseline
        })
        .collect();
    Ok(baselines)
}
