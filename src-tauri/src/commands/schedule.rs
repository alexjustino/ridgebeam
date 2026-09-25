//! The commands for the schedule: dependencies, and the baselines approval
//! takes.
//!
//! The schedule itself — offsets on the working calendar, the critical path,
//! the finish date, the slip — is computed in the domain from the snapshot. The
//! host stores what the person declared (dependencies) and what was approved
//! (baselines), and refuses what would break either: a dependency that closes a
//! loop, and any rewrite of a baseline.
//!
//! # Changelog of this boundary
//!
//! - F2: `dependency_add` (self, duplicate and unknown ends are
//!   `invalid_input`; a loop over the expanded graph is `dependency_cycle`),
//!   `dependency_update` (the lag), `dependency_remove`, `baseline_take` (the
//!   next number; the first approves the plan).

use tauri::State;

use crate::commands::work::change_work;
use crate::contract::{BaselineRowDraft, Endpoint, WorkSnapshot};
use crate::db::baselines::{self, Placement};
use crate::db::dependencies;
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::validate;

/// Declare that `blocked` starts `lag_days` working days after `blocker`
/// finishes.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an endpoint that is not an activity or a stage
/// of this work, a dependency from something to itself, one already declared,
/// or a lag that is not a whole number from 0 to 3650;
/// [`Error::DependencyCycle`] for one that would close a loop; and the errors
/// of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn dependency_add(
    open: State<'_, OpenWork>,
    blocker: Endpoint,
    blocked: Endpoint,
    lag_days: f64,
) -> Result<WorkSnapshot> {
    dependency_add_with(&open, &blocker, &blocked, lag_days)
}

/// Change a dependency's lag.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a lag that does not fit or a dependency not in
/// this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn dependency_update(
    open: State<'_, OpenWork>,
    id: String,
    lag_days: f64,
) -> Result<WorkSnapshot> {
    dependency_update_with(&open, &id, lag_days)
}

/// Remove a dependency.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a dependency not in this work, and the errors
/// of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn dependency_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    dependency_remove_with(&open, &id)
}

/// Take the next baseline from where the schedule placed every activity. The
/// first one approves the plan.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a row that names an activity not in this work
/// or names one twice, a plan with an activity left out or none at all, a date
/// that does not exist, a start after its finish, one date without the other,
/// or a finish date that is not the last finish; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn baseline_take(
    open: State<'_, OpenWork>,
    rows: Vec<BaselineRowDraft>,
    finish_date: Option<String>,
) -> Result<WorkSnapshot> {
    baseline_take_with(&open, &rows, finish_date.as_deref())
}

/// What [`dependency_add`] does once the state is in hand.
pub fn dependency_add_with(
    open: &OpenWork,
    blocker: &Endpoint,
    blocked: &Endpoint,
    lag_days: f64,
) -> Result<WorkSnapshot> {
    let blocker = validate::endpoint(blocker)?;
    let blocked = validate::endpoint(blocked)?;
    let lag_days = validate::lag_days(lag_days)?;
    change_work(open, |conn| {
        dependencies::add(conn, &blocker, &blocked, lag_days).map(|_| ())
    })
}

/// What [`dependency_update`] does once the state is in hand.
pub fn dependency_update_with(open: &OpenWork, id: &str, lag_days: f64) -> Result<WorkSnapshot> {
    let lag_days = validate::lag_days(lag_days)?;
    change_work(open, |conn| dependencies::set_lag(conn, id, lag_days))
}

/// What [`dependency_remove`] does once the state is in hand.
pub fn dependency_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| dependencies::remove(conn, id))
}

/// What [`baseline_take`] does once the state is in hand.
pub fn baseline_take_with(
    open: &OpenWork,
    rows: &[BaselineRowDraft],
    finish_date: Option<&str>,
) -> Result<WorkSnapshot> {
    let placements = rows.iter().map(placement).collect::<Result<Vec<_>>>()?;
    let finish_date = validate::optional_date("A baseline's finish date", finish_date)?;
    change_work(open, |conn| {
        baselines::take(conn, &placements, finish_date.as_deref()).map(|_| ())
    })
}

/// A row as the interface sent it, checked: real dates, both or neither, the
/// start not after the finish.
fn placement(row: &BaselineRowDraft) -> Result<Placement> {
    let start = validate::optional_date("An activity's start", row.start.as_deref())?;
    let finish = validate::optional_date("An activity's finish", row.finish.as_deref())?;
    match (&start, &finish) {
        (Some(start), Some(finish)) if start > finish => Err(Error::InvalidInput(
            "An activity cannot finish before it starts.".into(),
        )),
        (Some(_), None) | (None, Some(_)) => Err(Error::InvalidInput(
            "An activity placed on the schedule has a start and a finish; one not placed has neither."
                .into(),
        )),
        _ => Ok(Placement {
            activity_id: row.activity_id.clone(),
            start,
            finish,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plan::{activity_add_with, activity_remove_with, stage_add_with};
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;

    fn end(kind: &str, id: &str) -> Endpoint {
        Endpoint {
            kind: kind.into(),
            id: id.into(),
        }
    }

    fn draft(value: serde_json::Value) -> BaselineRowDraft {
        serde_json::from_value(value).expect("a row the interface could send")
    }

    #[test]
    fn a_dependency_is_added_updated_and_removed_and_every_step_returns_the_plan() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        activity_add_with(&open, &stage, "Tiling").unwrap();
        let plan = activity_add_with(&open, &stage, "Grout").unwrap();
        let (tiling, grout) = (plan.activities[0].id.clone(), plan.activities[1].id.clone());

        let plan = dependency_add_with(
            &open,
            &end("activity", &tiling),
            &end("activity", &grout),
            1.0,
        )
        .unwrap();
        let wire = serde_json::to_value(&plan.dependencies[0]).unwrap();
        assert_eq!(
            wire["blocker"],
            serde_json::json!({ "kind": "activity", "id": tiling })
        );
        assert_eq!(wire["blocked"]["id"], grout.as_str());
        assert_eq!(wire["lagDays"], 1);

        let id = plan.dependencies[0].id.clone();
        let plan = dependency_update_with(&open, &id, 4.0).unwrap();
        assert_eq!(plan.dependencies[0].lag_days, 4);
        let plan = dependency_remove_with(&open, &id).unwrap();
        assert!(plan.dependencies.is_empty());
        work_close_with(&open);
    }

    #[test]
    fn a_loop_is_dependency_cycle_with_the_names_and_a_bad_kind_or_lag_is_invalid_input() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();

        let refused =
            dependency_add_with(&open, &end("stage", &stage), &end("activity", &tiling), 0.0)
                .unwrap_err();
        let wire = serde_json::to_value(&refused).unwrap();
        assert_eq!(wire["kind"], "dependency_cycle");
        assert_eq!(wire["message"], "Tiling → Tiling");

        for (blocker, lag) in [(end("room", &stage), 0.0), (end("stage", &stage), 1.5)] {
            let refused =
                dependency_add_with(&open, &blocker, &end("activity", &tiling), lag).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
        }
        assert!(crate::commands::work::work_get_with(&open)
            .unwrap()
            .dependencies
            .is_empty());
        work_close_with(&open);
    }

    #[test]
    fn approving_takes_baseline_one_and_a_second_take_is_baseline_two() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let rows = vec![draft(serde_json::json!({
            "activityId": tiling, "start": "2026-10-05", "finish": "2026-10-07",
            "name": "ignored: the host reads the name from the file"
        }))];

        let plan = baseline_take_with(&open, &rows, Some("2026-10-07")).unwrap();
        assert!(plan.work.approved_at.is_some());
        let wire = serde_json::to_value(&plan).unwrap();
        assert_eq!(wire["baselines"][0]["number"], 1);
        assert_eq!(wire["baselines"][0]["finishDate"], "2026-10-07");
        assert_eq!(wire["baselines"][0]["reason"], serde_json::Value::Null);
        assert_eq!(wire["baselines"][0]["rows"][0]["name"], "Tiling");
        assert_eq!(wire["baselines"][0]["rows"][0]["stageName"], "Bathroom");
        assert!(wire["work"]["approvedAt"].is_string());

        let plan = baseline_take_with(&open, &rows, Some("2026-10-07")).unwrap();
        assert_eq!(plan.baselines[1].number, 2);

        // The activity goes; its baselines keep it.
        let plan = activity_remove_with(&open, &tiling).unwrap();
        assert_eq!(plan.baselines[0].rows[0].activity_id, tiling);
        work_close_with(&open);
    }

    #[test]
    fn a_row_with_one_date_a_start_after_its_finish_or_a_day_that_does_not_exist_is_refused() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();

        for (row, finish) in [
            (
                serde_json::json!({ "activityId": tiling, "start": "2026-10-05" }),
                None,
            ),
            (
                serde_json::json!({ "activityId": tiling, "start": "2026-10-08", "finish": "2026-10-07" }),
                Some("2026-10-07"),
            ),
            (
                serde_json::json!({ "activityId": tiling, "start": "2026-02-30", "finish": "2026-03-02" }),
                Some("2026-03-02"),
            ),
            (
                serde_json::json!({ "activityId": tiling }),
                Some("2026-13-01"),
            ),
        ] {
            let refused = baseline_take_with(&open, &[draft(row.clone())], finish).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{row}");
        }
        let plan = crate::commands::work::work_get_with(&open).unwrap();
        assert!(plan.baselines.is_empty());
        assert_eq!(plan.work.approved_at, None);
        work_close_with(&open);
    }

    #[test]
    fn schedule_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        assert_eq!(
            dependency_remove_with(&open, "x").unwrap_err().kind(),
            "no_work_open"
        );
        assert_eq!(
            baseline_take_with(&open, &[], None).unwrap_err().kind(),
            "no_work_open"
        );
    }
}
