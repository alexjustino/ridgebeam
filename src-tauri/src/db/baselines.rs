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
//! - **In the schema.** Triggers on `baseline`, `baseline_activity` and
//!   `baseline_stage` refuse `UPDATE`, `DELETE` and `REPLACE` with the message
//!   `baseline: append-only`, whatever the connection's pragmas; rows are
//!   added only to the latest baseline (work migrations 003 and 009).
//! - **At the boundary.** No command edits or removes a baseline. A later
//!   baseline carries the reason the plan changed, as a new baseline — never
//!   as an edit of an old one.
//!
//! Taking the first baseline is also approving the plan: `work.approved_at` is
//! set in the same transaction. That write is the work row's, and it lives with
//! the work row in `db::work::record_approval`, not here. Taking any later one
//! needs an open replanning: its reason is copied into the baseline and the
//! replanning is closed in the same transaction — a write that is the
//! replanning's, and lives in `db::replanning::close`.
//!
//! The schedule is computed in the domain, so the interface sends where each
//! activity was placed; everything else — each row's name, stage name,
//! duration and money, the stages, the work's planned money, the reason — is
//! read from the file inside the transaction, so a baseline records what the
//! work held rather than what the interface said it held.
//!
//! # Changelog of this repository
//!
//! - F2: `take` and `list`.
//! - F8: a baseline records its stages (`baseline_stage`) and its money —
//!   the work's, each stage's and each activity's planned cents; a baseline
//!   after the first needs an open replanning, copies its reason and closes
//!   it.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};

use crate::contract::{Baseline, BaselineRow, BaselineStage};
use crate::db::replanning::{self, REASON_NEEDED};
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

/// One activity as the file holds it when a baseline is taken.
struct HeldActivity {
    id: String,
    name: String,
    stage_name: String,
    duration_days: Option<i64>,
    planned_cents: i64,
}

/// Take the next baseline: number max + 1, one row per stage and per activity,
/// the planned money, and — for the first — the approval; for a later one, the
/// open replanning's reason, and the replanning closed. One transaction; on any
/// refusal nothing is written. Returns the number taken.
///
/// # Errors
///
/// [`Error::PlanApproved`] ([`REASON_NEEDED`]) for a baseline after the first
/// with no replanning open; [`Error::InvalidInput`] when the plan has no
/// activity, a row names an activity not in this work, names one twice, or
/// leaves one out, or the finish date is not the last finish among the rows;
/// [`Error::Database`] when a row cannot be written.
pub fn take(conn: &Connection, placements: &[Placement], finish_date: Option<&str>) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;

    // The plan as the file holds it, in breakdown order, each activity with
    // the money that names it.
    let held: Vec<HeldActivity> = tx
        .prepare(
            "SELECT a.id, a.name, s.name, a.duration_days,
                    (SELECT coalesce(sum(c.amount_cents), 0) FROM cost_line c
                     WHERE c.activity_id = a.id)
             FROM activity a JOIN stage s ON s.id = a.stage_id
             ORDER BY s.position, a.position",
        )?
        .query_map([], |row| {
            Ok(HeldActivity {
                id: row.get(0)?,
                name: row.get(1)?,
                stage_name: row.get(2)?,
                duration_days: row.get(3)?,
                planned_cents: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if held.is_empty() {
        return Err(Error::InvalidInput(NOTHING_TO_APPROVE.into()));
    }

    let number: i64 = tx.query_row(
        "SELECT coalesce(max(number), 0) + 1 FROM baseline",
        [],
        |row| row.get(0),
    )?;
    // Baseline 1 is the approval and has no reason. Every later one is taken
    // because the plan changed, and says why.
    let reason = if number == 1 {
        None
    } else {
        Some(
            replanning::open_reason(&tx)?
                .ok_or_else(|| Error::PlanApproved(REASON_NEEDED.into()))?,
        )
    };

    let known: HashSet<&str> = held.iter().map(|activity| activity.id.as_str()).collect();
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

    // Every stage, a stage with no activity included, with every cost line of
    // the stage — its activities' included.
    let stages: Vec<(String, String, i64)> = tx
        .prepare(
            "SELECT s.id, s.name,
                    (SELECT coalesce(sum(c.amount_cents), 0) FROM cost_line c
                     WHERE c.stage_id = s.id)
             FROM stage s ORDER BY s.position",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let planned_cents: i64 = tx.query_row(
        "SELECT coalesce(sum(amount_cents), 0) FROM cost_line",
        [],
        |row| row.get(0),
    )?;

    let baseline_id = new_id();
    tx.execute(
        "INSERT INTO baseline (id, number, taken_at, reason, finish_date, planned_cents)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            baseline_id,
            number,
            now(),
            reason,
            finish_date,
            planned_cents
        ],
    )?;
    for (index, (stage_id, name, stage_cents)) in stages.iter().enumerate() {
        tx.execute(
            "INSERT INTO baseline_stage (baseline_id, stage_id, position, name, planned_cents)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![baseline_id, stage_id, index as i64 + 1, name, stage_cents],
        )?;
    }
    for (index, activity) in held.iter().enumerate() {
        let placement = placed[activity.id.as_str()];
        tx.execute(
            "INSERT INTO baseline_activity
               (baseline_id, activity_id, position, name, stage_name, duration_days, start, finish,
                planned_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                baseline_id,
                activity.id,
                index as i64 + 1,
                activity.name,
                activity.stage_name,
                activity.duration_days,
                placement.start,
                placement.finish,
                activity.planned_cents
            ],
        )?;
    }
    if number == 1 {
        record_approval(&tx)?;
    } else {
        replanning::close(&tx, number)?;
    }
    tx.commit()?;
    log::info!("baseline {number} was taken");
    Ok(number)
}

/// Every baseline, by number, each with its stages in their order and its rows
/// in breakdown order.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Baseline>> {
    let mut rows_of: HashMap<String, Vec<BaselineRow>> = HashMap::new();
    let rows = conn
        .prepare(
            "SELECT baseline_id, activity_id, name, stage_name, duration_days, start, finish,
                    planned_cents
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
                    planned_cents: row.get(7)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (baseline_id, row) in rows {
        rows_of.entry(baseline_id).or_default().push(row);
    }

    let mut stages_of: HashMap<String, Vec<BaselineStage>> = HashMap::new();
    let stages = conn
        .prepare(
            "SELECT baseline_id, stage_id, position, name, planned_cents
             FROM baseline_stage ORDER BY baseline_id, position",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                BaselineStage {
                    stage_id: row.get(1)?,
                    position: row.get(2)?,
                    name: row.get(3)?,
                    planned_cents: row.get(4)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (baseline_id, stage) in stages {
        stages_of.entry(baseline_id).or_default().push(stage);
    }

    let baselines = conn
        .prepare(
            "SELECT id, number, taken_at, reason, finish_date, planned_cents
             FROM baseline ORDER BY number",
        )?
        .query_map([], |row| {
            Ok(Baseline {
                id: row.get(0)?,
                number: row.get(1)?,
                taken_at: row.get(2)?,
                reason: row.get(3)?,
                finish_date: row.get(4)?,
                planned_cents: row.get(5)?,
                stages: Vec::new(),
                rows: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut baseline| {
            baseline.stages = stages_of.remove(&baseline.id).unwrap_or_default();
            baseline.rows = rows_of.remove(&baseline.id).unwrap_or_default();
            baseline
        })
        .collect();
    Ok(baselines)
}
