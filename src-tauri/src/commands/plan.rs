//! The commands that change the plan: the calendar, people, stages and
//! activities.
//!
//! Every one checks its input (`crate::validate`), makes one change in one
//! transaction, and returns the whole plan as it now is. None of them writes
//! progress — there is no column for it, and there is no command for it: the
//! only way progress will ever change is a diary entry (slice F4).
//!
//! # Changelog of this boundary
//!
//! - F0: `calendar_set`, `person_add`, `stage_add`, `stage_rename`,
//!   `stage_remove`, `activity_add`, `activity_update`, `activity_remove`.
//! - F1: `person_rename`, `person_remove` (their activities are left with
//!   nobody responsible); `stage_move` and `activity_move`, one step up or
//!   down, a no-op at the edge, positions 1..n after; `activity_update` takes a
//!   quantity and a unit. Rooms are in `commands::rooms`.

use std::collections::BTreeSet;

use tauri::State;

use crate::commands::work::change_work;
use crate::contract::{ActivityPatch, CalendarDraft, Holiday, WorkSnapshot};
use crate::db::order::{ACTIVITIES, STAGES};
use crate::db::work::{self as repo, ActivityChange};
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::validate;

/// Replace the working calendar and every holiday.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a week with no working day, a working day of no
/// hours, a date that does not exist, or the same day twice; and the errors of
/// every work command ([`Error::NoWorkOpen`], [`Error::WorkMoved`],
/// [`Error::Database`]).
#[tauri::command(rename_all = "snake_case")]
pub fn calendar_set(
    open: State<'_, OpenWork>,
    calendar: CalendarDraft,
    holidays: Vec<Holiday>,
) -> Result<WorkSnapshot> {
    calendar_set_with(&open, &calendar, &holidays)
}

/// Add a person who can be responsible for an activity.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an empty or long name, and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn person_add(open: State<'_, OpenWork>, name: String) -> Result<WorkSnapshot> {
    person_add_with(&open, &name)
}

/// Add a stage after the last one.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an empty or long name, and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_add(open: State<'_, OpenWork>, name: String) -> Result<WorkSnapshot> {
    stage_add_with(&open, &name)
}

/// Rename a stage.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that does not fit or a stage not in this
/// work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_rename(open: State<'_, OpenWork>, id: String, name: String) -> Result<WorkSnapshot> {
    stage_rename_with(&open, &id, &name)
}

/// Remove a stage, and its activities with it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage not in this work, and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    stage_remove_with(&open, &id)
}

/// Add an activity at the end of a stage, with no duration and nobody
/// responsible yet — which readiness will say.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that does not fit or a stage not in this
/// work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn activity_add(
    open: State<'_, OpenWork>,
    stage_id: String,
    name: String,
) -> Result<WorkSnapshot> {
    activity_add_with(&open, &stage_id, &name)
}

/// Change an activity's name, duration or responsible. A field left out is
/// left alone; `null` clears it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, or an activity or a
/// person not in this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn activity_update(
    open: State<'_, OpenWork>,
    id: String,
    patch: ActivityPatch,
) -> Result<WorkSnapshot> {
    activity_update_with(&open, &id, &patch)
}

/// Remove an activity.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an activity not in this work, and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn activity_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    activity_remove_with(&open, &id)
}

/// Rename a person.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that does not fit or a person not in this
/// work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn person_rename(open: State<'_, OpenWork>, id: String, name: String) -> Result<WorkSnapshot> {
    person_rename_with(&open, &id, &name)
}

/// Remove a person. The activities they were responsible for stay, with
/// nobody responsible.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a person not in this work, and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn person_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    person_remove_with(&open, &id)
}

/// Move a stage one step, `up` or `down`. At the edge nothing moves, and that
/// is not an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a direction that is neither or a stage not in
/// this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    stage_move_with(&open, &id, &direction)
}

/// Move an activity one step within its stage, `up` or `down`. At the edge of
/// its stage nothing moves, and that is not an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a direction that is neither or an activity not
/// in this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn activity_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    activity_move_with(&open, &id, &direction)
}

/// What [`calendar_set`] does once the state is in hand.
pub fn calendar_set_with(
    open: &OpenWork,
    calendar: &CalendarDraft,
    holidays: &[Holiday],
) -> Result<WorkSnapshot> {
    let calendar = CalendarDraft {
        working_days: validate::working_days(&calendar.working_days)?,
        hours_per_day: validate::hours_per_day(calendar.hours_per_day)?,
    };
    let mut seen = BTreeSet::new();
    let holidays = holidays
        .iter()
        .map(|holiday| {
            let date = validate::date("A holiday", &holiday.date)?;
            if !seen.insert(date.clone()) {
                return Err(Error::InvalidInput(format!(
                    "{date} is listed as a holiday twice; a day is a holiday once."
                )));
            }
            Ok(Holiday {
                date,
                name: validate::name("holiday", &holiday.name)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    change_work(open, |conn| repo::set_calendar(conn, &calendar, &holidays))
}

/// What [`person_add`] does once the state is in hand.
pub fn person_add_with(open: &OpenWork, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("person", name)?;
    change_work(open, |conn| repo::add_person(conn, &name).map(|_| ()))
}

/// What [`stage_add`] does once the state is in hand.
pub fn stage_add_with(open: &OpenWork, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("stage", name)?;
    change_work(open, |conn| repo::add_stage(conn, &name).map(|_| ()))
}

/// What [`stage_rename`] does once the state is in hand.
pub fn stage_rename_with(open: &OpenWork, id: &str, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("stage", name)?;
    change_work(open, |conn| repo::rename_stage(conn, id, &name))
}

/// What [`stage_remove`] does once the state is in hand.
pub fn stage_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::remove_stage(conn, id))
}

/// What [`activity_add`] does once the state is in hand.
pub fn activity_add_with(open: &OpenWork, stage_id: &str, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("activity", name)?;
    change_work(open, |conn| {
        repo::add_activity(conn, stage_id, &name).map(|_| ())
    })
}

/// What [`activity_update`] does once the state is in hand.
pub fn activity_update_with(
    open: &OpenWork,
    id: &str,
    patch: &ActivityPatch,
) -> Result<WorkSnapshot> {
    let change = ActivityChange {
        name: patch
            .name
            .as_deref()
            .map(|name| validate::name("activity", name))
            .transpose()?,
        duration_days: patch
            .duration_days
            .map(|duration| duration.map(validate::duration_days).transpose())
            .transpose()?,
        responsible_id: patch.responsible_id.clone(),
        quantity: patch
            .quantity
            .map(|quantity| quantity.map(validate::quantity).transpose())
            .transpose()?,
        unit: patch
            .unit
            .as_ref()
            .map(|unit| validate::unit(unit.as_deref()))
            .transpose()?,
    };
    change_work(open, |conn| repo::update_activity(conn, id, &change))
}

/// What [`activity_remove`] does once the state is in hand.
pub fn activity_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::remove_activity(conn, id))
}

/// What [`person_rename`] does once the state is in hand.
pub fn person_rename_with(open: &OpenWork, id: &str, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("person", name)?;
    change_work(open, |conn| repo::rename_person(conn, id, &name))
}

/// What [`person_remove`] does once the state is in hand.
pub fn person_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::remove_person(conn, id))
}

/// What [`stage_move`] does once the state is in hand.
pub fn stage_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| STAGES.move_one(conn, id, direction))
}

/// What [`activity_move`] does once the state is in hand.
pub fn activity_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| ACTIVITIES.move_one(conn, id, direction))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;

    /// The journey the F0 proof walks: one stage, one activity with a duration
    /// and nobody responsible, then somebody responsible. Every step returns
    /// the whole plan.
    #[test]
    fn a_stage_an_activity_a_duration_and_a_responsible_each_return_the_whole_plan() {
        let (_db, open, _scratch) = host_with_a_work();

        let plan = stage_add_with(&open, "Bathroom").unwrap();
        let stage = plan.stages[0].id.clone();
        let plan = activity_add_with(&open, &stage, "Tiling").unwrap();
        let tiling = plan.activities[0].clone();
        assert_eq!(
            (tiling.duration_days, tiling.responsible_id.clone()),
            (None, None)
        );

        let patch: ActivityPatch =
            serde_json::from_value(serde_json::json!({ "durationDays": 3 })).unwrap();
        let plan = activity_update_with(&open, &tiling.id, &patch).unwrap();
        assert_eq!(plan.activities[0].duration_days, Some(3));
        assert_eq!(
            plan.activities[0].responsible_id, None,
            "left out, left alone"
        );

        let plan = person_add_with(&open, "Ana (synthetic)").unwrap();
        let ana = plan.people[0].id.clone();
        let patch: ActivityPatch =
            serde_json::from_value(serde_json::json!({ "responsibleId": ana })).unwrap();
        let plan = activity_update_with(&open, &tiling.id, &patch).unwrap();
        assert_eq!(
            plan.activities[0].responsible_id.as_deref(),
            Some(ana.as_str())
        );
        assert_eq!(plan.activities[0].duration_days, Some(3));

        let plan = stage_rename_with(&open, &stage, "Main bathroom").unwrap();
        assert_eq!(plan.stages[0].name, "Main bathroom");
        let plan = activity_remove_with(&open, &tiling.id).unwrap();
        assert!(plan.activities.is_empty());
        let plan = stage_remove_with(&open, &stage).unwrap();
        assert!(plan.stages.is_empty());
        work_close_with(&open);
    }

    #[test]
    fn an_activity_of_zero_days_or_half_a_day_is_refused_and_nothing_changes() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();

        for duration in [0.0, 2.5, -1.0] {
            let patch = ActivityPatch {
                duration_days: Some(Some(duration)),
                ..ActivityPatch::default()
            };
            let refused = activity_update_with(&open, &tiling, &patch).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{duration}");
        }
        let plan = crate::commands::work::work_get_with(&open).unwrap();
        assert_eq!(plan.activities[0].duration_days, None);
        work_close_with(&open);
    }

    #[test]
    fn a_calendar_with_no_working_day_or_no_hours_is_refused_before_it_reaches_the_file() {
        let (_db, open, _scratch) = host_with_a_work();

        for calendar in [
            CalendarDraft {
                working_days: "0000000".into(),
                hours_per_day: 8.0,
            },
            CalendarDraft {
                working_days: "1111100".into(),
                hours_per_day: 0.0,
            },
        ] {
            let refused = calendar_set_with(&open, &calendar, &[]).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
        }
        work_close_with(&open);
    }

    #[test]
    fn a_calendar_replaces_its_holidays_and_refuses_the_same_day_twice() {
        let (_db, open, _scratch) = host_with_a_work();
        let calendar = CalendarDraft {
            working_days: "1111110".into(),
            hours_per_day: 8.5,
        };
        let holiday = |date: &str| Holiday {
            date: date.into(),
            name: "Synthetic holiday".into(),
        };

        let plan = calendar_set_with(
            &open,
            &calendar,
            &[holiday("2026-12-25"), holiday("2026-11-02")],
        )
        .unwrap();
        assert_eq!(plan.calendar, calendar);
        let dates: Vec<_> = plan.holidays.iter().map(|h| h.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-11-02", "2026-12-25"], "by date");

        let refused = calendar_set_with(
            &open,
            &calendar,
            &[holiday("2026-12-25"), holiday("2026-12-25")],
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            crate::commands::work::work_get_with(&open)
                .unwrap()
                .holidays
                .len(),
            2
        );
        work_close_with(&open);
    }

    #[test]
    fn a_plan_command_with_no_work_open_is_no_work_open() {
        let (_db, open) = host();

        assert_eq!(
            stage_add_with(&open, "Bathroom").unwrap_err().kind(),
            "no_work_open"
        );
        assert_eq!(
            person_add_with(&open, "Ana").unwrap_err().kind(),
            "no_work_open"
        );
        // A name that does not fit is refused first: the host says what is
        // wrong with what it was sent before it says what is missing around it.
        assert_eq!(
            stage_add_with(&open, "").unwrap_err().kind(),
            "invalid_input"
        );
    }

    fn patch(json: serde_json::Value) -> ActivityPatch {
        serde_json::from_value(json).expect("a patch the interface could send")
    }

    /// The plan's order, as the breakdown numbers it: `1`, `1.1`, `1.2`, `2` …
    fn numbering(plan: &WorkSnapshot) -> Vec<String> {
        let mut rows = Vec::new();
        for stage in &plan.stages {
            rows.push(format!("{} {}", stage.position, stage.name));
            for activity in plan.activities.iter().filter(|a| a.stage_id == stage.id) {
                rows.push(format!(
                    "{}.{} {}",
                    stage.position, activity.position, activity.name
                ));
            }
        }
        rows
    }

    #[test]
    fn a_stage_moved_down_takes_its_activities_and_the_numbering_follows() {
        let (_db, open, _scratch) = host_with_a_work();
        let demolition = stage_add_with(&open, "Demolition").unwrap().stages[0]
            .id
            .clone();
        let bathroom = stage_add_with(&open, "Bathroom").unwrap().stages[1]
            .id
            .clone();
        activity_add_with(&open, &demolition, "Strip out").unwrap();
        activity_add_with(&open, &bathroom, "Tiling").unwrap();
        let grout = activity_add_with(&open, &bathroom, "Grout")
            .unwrap()
            .activities[2]
            .id
            .clone();

        let plan = stage_move_with(&open, &demolition, "down").unwrap();
        assert_eq!(
            numbering(&plan),
            vec![
                "1 Bathroom",
                "1.1 Tiling",
                "1.2 Grout",
                "2 Demolition",
                "2.1 Strip out"
            ]
        );

        let plan = activity_move_with(&open, &grout, "up").unwrap();
        assert_eq!(
            numbering(&plan),
            vec![
                "1 Bathroom",
                "1.1 Grout",
                "1.2 Tiling",
                "2 Demolition",
                "2.1 Strip out"
            ]
        );
        work_close_with(&open);
    }

    #[test]
    fn a_move_at_the_edge_returns_the_plan_unchanged_and_a_bad_direction_is_a_sentence() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let before = crate::commands::work::work_get_with(&open).unwrap();

        for plan in [
            stage_move_with(&open, &stage, "up").unwrap(),
            stage_move_with(&open, &stage, "down").unwrap(),
            activity_move_with(&open, &tiling, "up").unwrap(),
            activity_move_with(&open, &tiling, "down").unwrap(),
        ] {
            assert_eq!(plan, before);
        }

        for direction in ["left", "UP", ""] {
            let refused = stage_move_with(&open, &stage, direction).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
        }
        work_close_with(&open);
    }

    #[test]
    fn a_quantity_and_its_unit_arrive_through_the_patch_and_a_unit_alone_is_refused() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tile = activity_add_with(&open, &stage, "Lay the floor tile")
            .unwrap()
            .activities[0]
            .id
            .clone();

        let refused =
            activity_update_with(&open, &tile, &patch(serde_json::json!({ "unit": "m²" })))
                .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), repo::UNIT_WITHOUT_QUANTITY);

        let refused = activity_update_with(
            &open,
            &tile,
            &patch(serde_json::json!({ "quantity": -3, "unit": "m²" })),
        )
        .unwrap_err();
        assert_eq!(refused.to_string(), "A quantity is a number, 0 or more.");

        let plan = activity_update_with(
            &open,
            &tile,
            &patch(serde_json::json!({ "quantity": 12, "unit": " m² " })),
        )
        .unwrap();
        let wire = serde_json::to_value(&plan.activities[0]).unwrap();
        assert_eq!(wire["quantity"], 12.0);
        assert_eq!(wire["unit"], "m²");

        let plan =
            activity_update_with(&open, &tile, &patch(serde_json::json!({ "unit": "" }))).unwrap();
        assert_eq!(plan.activities[0].unit, None, "an empty unit is no unit");
        assert_eq!(plan.activities[0].quantity, Some(12.0));

        activity_update_with(&open, &tile, &patch(serde_json::json!({ "unit": "m²" }))).unwrap();
        let plan = activity_update_with(
            &open,
            &tile,
            &patch(serde_json::json!({ "quantity": null })),
        )
        .unwrap();
        assert_eq!(
            (plan.activities[0].quantity, plan.activities[0].unit.clone()),
            (None, None),
            "clearing the quantity clears the unit"
        );
        work_close_with(&open);
    }

    #[test]
    fn removing_a_person_clears_every_activity_they_were_responsible_for() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let tiler = person_add_with(&open, "A. Tiler").unwrap().people[0]
            .id
            .clone();
        activity_update_with(
            &open,
            &tiling,
            &patch(serde_json::json!({ "responsibleId": tiler })),
        )
        .unwrap();

        let plan = person_rename_with(&open, &tiler, "Ana Tiler").unwrap();
        assert_eq!(plan.people[0].name, "Ana Tiler");
        let plan = person_remove_with(&open, &tiler).unwrap();

        assert!(plan.people.is_empty());
        assert_eq!(plan.activities.len(), 1);
        assert_eq!(plan.activities[0].responsible_id, None);
        work_close_with(&open);
    }
}
