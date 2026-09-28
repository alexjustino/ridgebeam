//! A plan applied whole, and ranges taken.
//!
//! A template reaches the host as a plan the domain has already read in one
//! language (`PlanDraft`), and the command layer has already checked every
//! value and resolved every key into a position ([`NewPlan`]). What this module
//! adds is what only the file can answer — whether the work is empty and not
//! approved, and whether the links close a loop over the expanded graph — and
//! the rows themselves, all of them in one transaction or none.
//!
//! Nothing here links a work back to its template: the plan gets new ids from
//! its first row, and the work records only where it came from (ADR-029).
//!
//! # Changelog of this repository
//!
//! - F9: `apply` (a plan onto an empty work), `ranges_open` and `take_ranges`
//!   (every range without a duration gives it one of its ends).

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::checks::{self, Gate};
use crate::db::dependencies::{self, End, Kind};
use crate::db::{decisions, money, rooms, work};
use crate::error::{Error, Result};

/// The sentence for a template applied to a work that already has a plan —
/// a stage, or an approval.
pub const PLAN_ALREADY: &str = "A template starts a plan: this work already has one.";

/// A plan about to be written: every value checked, every key resolved into a
/// position in the lists it names.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewPlan {
    /// Room names, in order.
    pub rooms: Vec<String>,
    /// Stages, in order.
    pub stages: Vec<NewStage>,
    /// Dependencies.
    pub links: Vec<NewLink>,
}

/// A stage about to be written.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewStage {
    /// Its name.
    pub name: String,
    /// Its activities, in order.
    pub activities: Vec<NewActivity>,
    /// Its checks, in order within each gate.
    pub checks: Vec<(Gate, String)>,
    /// Its cost lines, in order.
    pub cost_lines: Vec<NewCostLine>,
    /// Its decisions, in order.
    pub decisions: Vec<NewDecision>,
}

/// An activity about to be written.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewActivity {
    /// Its name.
    pub name: String,
    /// Its duration; `None` while the range is a range.
    pub duration_days: Option<i64>,
    /// Its range, lower end first.
    pub range: Option<(i64, i64)>,
    /// The rooms it touches, by position in [`NewPlan::rooms`], each once.
    pub rooms: Vec<usize>,
}

/// A cost line about to be written.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewCostLine {
    /// What it is for.
    pub label: String,
    /// The activity of its stage, by position; `None` for the stage.
    pub activity: Option<usize>,
    /// Its amount; `None`: not priced yet.
    pub amount_cents: Option<i64>,
}

/// A decision about to be written.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewDecision {
    /// Its name.
    pub name: String,
    /// Its lead time.
    pub lead_time_days: i64,
    /// Its lead range, lower end first.
    pub range: Option<(i64, i64)>,
}

/// One end of a link: a stage, or one of its activities, by position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Place {
    /// The stage, by position in [`NewPlan::stages`].
    pub stage: usize,
    /// The activity, by position in the stage's; `None` for the stage.
    pub activity: Option<usize>,
}

/// A dependency about to be written.
#[derive(Debug, Clone, PartialEq)]
pub struct NewLink {
    /// What has to finish first.
    pub blocker: Place,
    /// What waits for it.
    pub blocked: Place,
    /// Working days between.
    pub lag_days: i64,
}

/// Where the plan came from, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewProvenance {
    /// The template's id.
    pub template_id: String,
    /// Its version.
    pub template_version: i64,
    /// Its title.
    pub template_title: String,
}

/// Write `plan` into a work with no stage that is not approved, and record
/// where it came from — one transaction: on any refusal nothing is written,
/// the provenance included. Rooms are added after any the work already has.
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`PLAN_ALREADY`] for a work with a stage or an
/// approval, or the sentence of a link refused as `dependency_add` refuses it
/// (to itself, twice); [`Error::DependencyCycle`] for links that close a loop,
/// naming it; [`Error::Database`] when a row is refused.
pub fn apply(conn: &Connection, plan: &NewPlan, provenance: &NewProvenance) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let has_stage = tx
        .query_row("SELECT 1 FROM stage LIMIT 1", [], |_| Ok(()))
        .optional()?
        .is_some();
    let approved = work::work(&tx)?.approved_at.is_some();
    if has_stage || approved {
        return Err(Error::InvalidInput(PLAN_ALREADY.into()));
    }

    let room_ids = plan
        .rooms
        .iter()
        .map(|name| rooms::add_room(&tx, name))
        .collect::<Result<Vec<_>>>()?;

    let mut stage_ids = Vec::with_capacity(plan.stages.len());
    let mut activity_ids: Vec<Vec<String>> = Vec::with_capacity(plan.stages.len());
    for stage in &plan.stages {
        let stage_id = work::add_stage(&tx, &stage.name)?;
        let mut ids = Vec::with_capacity(stage.activities.len());
        for activity in &stage.activities {
            let id = work::add_activity(&tx, &stage_id, &activity.name)?;
            tx.execute(
                "UPDATE activity SET duration_days = ?2, duration_min_days = ?3,
                                     duration_max_days = ?4
                 WHERE id = ?1",
                params![
                    id,
                    activity.duration_days,
                    activity.range.map(|(low, _)| low),
                    activity.range.map(|(_, high)| high)
                ],
            )?;
            for &room in &activity.rooms {
                tx.execute(
                    "INSERT INTO activity_room (activity_id, room_id) VALUES (?1, ?2)",
                    params![id, room_ids[room]],
                )?;
            }
            ids.push(id);
        }
        for (gate, name) in &stage.checks {
            checks::add(&tx, &stage_id, *gate, name)?;
        }
        for line in &stage.cost_lines {
            let activity = line.activity.map(|index| ids[index].as_str());
            money::add_cost_line(&tx, &stage_id, activity, &line.label, line.amount_cents)?;
        }
        for decision in &stage.decisions {
            let id = decisions::add(&tx, &stage_id, &decision.name, decision.lead_time_days)?;
            tx.execute(
                "UPDATE decision SET lead_min_days = ?2, lead_max_days = ?3 WHERE id = ?1",
                params![
                    id,
                    decision.range.map(|(low, _)| low),
                    decision.range.map(|(_, high)| high)
                ],
            )?;
        }
        stage_ids.push(stage_id);
        activity_ids.push(ids);
    }

    let end = |place: Place| -> End {
        match place.activity {
            None => End {
                kind: Kind::Stage,
                id: stage_ids[place.stage].clone(),
            },
            Some(activity) => End {
                kind: Kind::Activity,
                id: activity_ids[place.stage][activity].clone(),
            },
        }
    };
    for link in &plan.links {
        dependencies::add_within(&tx, &end(link.blocker), &end(link.blocked), link.lag_days)?;
    }

    tx.execute(
        "UPDATE work SET template_id = ?1, template_version = ?2, template_title = ?3
         WHERE id = 1",
        params![
            provenance.template_id,
            provenance.template_version,
            provenance.template_title
        ],
    )?;
    tx.commit()?;
    log::info!(
        "a plan was applied: {} stages, {} links",
        plan.stages.len(),
        plan.links.len()
    );
    Ok(())
}

/// Which end of every range `take_ranges` gives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeEnd {
    /// The lower end — the hopeful plan.
    Low,
    /// The upper end — the careful one.
    High,
}

/// The activities a range would give a duration to: a range, no duration,
/// and a stage that is not closed (a closed stage is read-only).
const OPEN_RANGES: &str = "duration_days IS NULL AND duration_min_days IS NOT NULL
     AND stage_id NOT IN (SELECT id FROM stage WHERE closed_at IS NOT NULL)";

/// How many activities [`take_ranges`] would write.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn ranges_open(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        &format!("SELECT count(*) FROM activity WHERE {OPEN_RANGES}"),
        [],
        |row| row.get(0),
    )?)
}

/// Give every activity with a range and no duration — outside a closed
/// stage — one end of its range as its duration. An activity with a duration
/// keeps it, whatever its range says. Returns how many were written.
///
/// # Errors
///
/// [`Error::Database`] when the rows cannot be written.
pub fn take_ranges(conn: &Connection, which: RangeEnd) -> Result<usize> {
    let column = match which {
        RangeEnd::Low => "duration_min_days",
        RangeEnd::High => "duration_max_days",
    };
    let written = conn.execute(
        &format!("UPDATE activity SET duration_days = {column} WHERE {OPEN_RANGES}"),
        [],
    )?;
    log::info!("{written} ranges gave their activities a duration");
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_activity, add_stage, snapshot};

    fn refused_by_the_schema(conn: &Connection, sql: &str) -> bool {
        matches!(
            conn.execute(sql, []),
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == rusqlite::ErrorCode::ConstraintViolation
        )
    }

    /// The last guard, behind the domain's and the host's: a range has both
    /// ends or neither, whole, in bounds, the lower not above the upper; the
    /// provenance is all three or none.
    #[test]
    fn the_schema_refuses_half_a_range_a_range_upside_down_and_half_a_provenance() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let activity = add_activity(&conn, &stage, "Tiling").unwrap();
        let decision = decisions::add(&conn, &stage, "Which tile", 10).unwrap();

        for set in [
            "duration_min_days = 2",
            "duration_max_days = 2",
            "duration_min_days = 3, duration_max_days = 2",
            "duration_min_days = 0, duration_max_days = 2",
            "duration_min_days = 1, duration_max_days = 3651",
            "duration_min_days = 1.5, duration_max_days = 2",
            "duration_min_days = 1, duration_max_days = 'two'",
        ] {
            let sql = format!("UPDATE activity SET {set} WHERE id = '{activity}'");
            assert!(refused_by_the_schema(&conn, &sql), "{set}");
        }
        for set in [
            "lead_min_days = 2",
            "lead_max_days = 2",
            "lead_min_days = 5, lead_max_days = 2",
            "lead_min_days = -1, lead_max_days = 2",
            "lead_min_days = 0, lead_max_days = 3651",
        ] {
            let sql = format!("UPDATE decision SET {set} WHERE id = '{decision}'");
            assert!(refused_by_the_schema(&conn, &sql), "{set}");
        }
        for set in [
            "template_id = 'bathroom'",
            "template_id = 'bathroom', template_version = 1",
            "template_id = 'bathroom', template_title = 'Bathroom'",
            "template_id = 'bathroom', template_version = 0, template_title = 'Bathroom'",
            "template_id = '', template_version = 1, template_title = 'Bathroom'",
            "template_id = 'bathroom', template_version = 1, template_title = ' '",
        ] {
            let sql = format!("UPDATE work SET {set} WHERE id = 1");
            assert!(refused_by_the_schema(&conn, &sql), "{set}");
        }

        conn.execute(
            "UPDATE activity SET duration_min_days = 2, duration_max_days = 2 WHERE id = ?1",
            [&activity],
        )
        .expect("a point is a range of one");
        conn.execute(
            "UPDATE decision SET lead_min_days = 0, lead_max_days = 3650 WHERE id = ?1",
            [&decision],
        )
        .expect("0 to 3650");
        conn.execute(
            "UPDATE work SET template_id = 'bathroom', template_version = 2,
                             template_title = 'Bathroom' WHERE id = 1",
            [],
        )
        .expect("all three");
        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.activities[0].duration_min_days, Some(2));
        assert_eq!(plan.decisions[0].lead_max_days, Some(3650));
        assert_eq!(plan.work.template_version, Some(2));
    }

    #[test]
    fn a_cost_line_takes_no_amount_but_never_a_negative_or_a_fraction() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let line = money::add_cost_line(&conn, &stage, None, "Tiles", None).unwrap();
        for amount in ["-1", "2.5", "'ten'"] {
            let sql = format!("UPDATE cost_line SET amount_cents = {amount} WHERE id = '{line}'");
            assert!(refused_by_the_schema(&conn, &sql), "{amount}");
        }
        assert_eq!(snapshot(&conn).unwrap().cost_lines[0].amount_cents, None);
    }
}
