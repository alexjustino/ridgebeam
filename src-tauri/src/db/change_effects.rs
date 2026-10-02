//! What a change order does to the plan (E1): checked when it is raised,
//! written when it is approved — through the plan's own functions, never
//! through SQL of its own.
//!
//! An effect is data the schedule can compute (`contract::ChangeEffect`):
//!
//! - `add` — a new activity at the end of the change's stage, with its
//!   duration, finish-to-start after `after` (lag 0), or after nothing;
//! - `duration` — an existing activity's new duration;
//! - `remove` — an existing activity dropped, with the dependencies that name
//!   it, as `activity_remove` drops one.
//!
//! [`check`] runs when the change is raised: every id names an activity of the
//! work, no target is in a closed stage, a new duration lies inside the
//! activity's range, an activity a payment milestone is earned by is not
//! removed, and no activity is named against itself — removed and changed, or
//! removed and followed, or changed twice. [`apply`] runs inside the
//! transaction that records the approval: `db::work::add_activity`,
//! `update_activity_within`, `remove_activity_within` and
//! `db::dependencies::add_within`, the same functions and the same refusals as
//! the plan's own commands, so that the plan may have moved since the change
//! was raised and a refusal still says why in the plan's words. Any refusal
//! rolls the whole decision back.
//!
//! This module is apart from `db::change_orders` on purpose: that one writes
//! the record, by INSERT only, and a test reads its source to prove it. This
//! one writes the plan, which is edited.
//!
//! # Changelog of this repository
//!
//! - E1: `check`, `apply`.

use std::collections::HashSet;

use rusqlite::Connection;

use crate::contract::ChangeEffect;
use crate::db::dependencies::{self, End, Kind};
use crate::db::milestones;
use crate::db::work::{
    self, exists, refuse_if_activity_closed, refuse_if_duration_leaves_range, ActivityChange,
    ACTIVITY_NOT_FOUND,
};
use crate::error::{Error, Result};

/// The most effects one change order carries.
pub const MAX_EFFECTS: usize = 50;

/// The sentence for an `after` that names no activity of the work.
pub const AFTER_NOT_FOUND: &str = "The activity a new one is to start after is not in this work.";

/// The sentence for an activity a change removes and also names otherwise.
pub const REMOVED_AND_NAMED: &str =
    "An activity a change removes cannot also have its duration changed, or be followed by a new activity, in the same change.";

/// The sentence for an activity a change names twice in the same way.
pub const NAMED_TWICE: &str = "A change changes an activity's duration once, and removes it once.";

/// Check what a change would do, against the plan as it is now. Read only.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an activity not in this work, a duration
/// outside the activity's range, an activity a payment milestone is earned
/// by, or an activity named against itself; [`Error::StageClosed`] for a
/// target in a closed stage.
pub fn check(conn: &Connection, effects: &[ChangeEffect]) -> Result<()> {
    let mut removed = HashSet::new();
    let mut changed = HashSet::new();
    let mut followed = HashSet::new();
    for effect in effects {
        let fresh = match effect {
            ChangeEffect::Add { after, .. } => {
                if let Some(after) = after {
                    followed.insert(after.as_str());
                }
                true
            }
            ChangeEffect::Duration { activity_id, .. } => changed.insert(activity_id.as_str()),
            ChangeEffect::Remove { activity_id } => removed.insert(activity_id.as_str()),
        };
        if !fresh {
            return Err(Error::InvalidInput(NAMED_TWICE.into()));
        }
    }
    if removed
        .iter()
        .any(|id| changed.contains(id) || followed.contains(id))
    {
        return Err(Error::InvalidInput(REMOVED_AND_NAMED.into()));
    }

    for effect in effects {
        match effect {
            ChangeEffect::Add { after, .. } => {
                if let Some(after) = after {
                    if !exists(conn, "SELECT 1 FROM activity WHERE id = ?1", after)? {
                        return Err(Error::InvalidInput(AFTER_NOT_FOUND.into()));
                    }
                }
            }
            ChangeEffect::Duration {
                activity_id,
                duration_days,
            } => {
                must_exist(conn, activity_id)?;
                refuse_if_activity_closed(conn, activity_id)?;
                refuse_if_duration_leaves_range(conn, activity_id, &duration(*duration_days))?;
            }
            ChangeEffect::Remove { activity_id } => {
                must_exist(conn, activity_id)?;
                refuse_if_activity_closed(conn, activity_id)?;
                milestones::refuse_if_activity_earns(conn, activity_id)?;
            }
        }
    }
    Ok(())
}

/// Write a change's effects into the plan, in order, inside the caller's
/// transaction. A new activity goes at the end of `stage_id`.
///
/// # Errors
///
/// The refusals of the plan's own functions — an activity no longer in the
/// work, a closed stage, a duration outside a range, an activity a milestone
/// is earned by, a dependency that would close a loop — and
/// [`Error::Database`]. The caller's transaction rolls everything back.
pub fn apply(tx: &Connection, stage_id: &str, effects: &[ChangeEffect]) -> Result<()> {
    for effect in effects {
        match effect {
            ChangeEffect::Add {
                name,
                duration_days,
                after,
            } => {
                let id = work::add_activity(tx, stage_id, name)?;
                work::update_activity_within(tx, &id, &duration(*duration_days))?;
                if let Some(after) = after {
                    if !exists(tx, "SELECT 1 FROM activity WHERE id = ?1", after)? {
                        return Err(Error::InvalidInput(AFTER_NOT_FOUND.into()));
                    }
                    dependencies::add_within(
                        tx,
                        &End {
                            kind: Kind::Activity,
                            id: after.clone(),
                        },
                        &End {
                            kind: Kind::Activity,
                            id,
                        },
                        0,
                    )?;
                }
            }
            ChangeEffect::Duration {
                activity_id,
                duration_days,
            } => work::update_activity_within(tx, activity_id, &duration(*duration_days))?,
            ChangeEffect::Remove { activity_id } => {
                work::remove_activity_within(tx, activity_id)?;
            }
        }
    }
    Ok(())
}

/// The change that gives an activity a duration and touches nothing else.
fn duration(days: i64) -> ActivityChange {
    ActivityChange {
        duration_days: Some(Some(days)),
        ..ActivityChange::default()
    }
}

fn must_exist(conn: &Connection, activity_id: &str) -> Result<()> {
    if exists(conn, "SELECT 1 FROM activity WHERE id = ?1", activity_id)? {
        Ok(())
    } else {
        Err(Error::InvalidInput(ACTIVITY_NOT_FOUND.into()))
    }
}
