//! The commands for decisions: add, rename or re-time, move, remove, make,
//! reopen.
//!
//! None of them takes or returns a deadline. A decision's deadline is its
//! stage's earliest scheduled start minus its lead time on the working
//! calendar, computed by the domain from the snapshot every time (ADR-017) —
//! which is why raising a lead time, or a lag before the stage, moves the
//! deadline without a command that says so. "Overdue" is the deadline against
//! today, and today is the interface's to pass, never the host's to read.
//!
//! # Changelog of this boundary
//!
//! - F3: `decision_add`, `decision_update`, `decision_remove`,
//!   `decision_move`, `decision_make` (once — a made decision is reopened
//!   first), `decision_reopen` (clears the moment and the answer).

use tauri::State;

use crate::commands::work::change_work;
use crate::contract::{DecisionPatch, WorkSnapshot};
use crate::db::decisions as repo;
use crate::db::order::DECISIONS;
use crate::error::Result;
use crate::folder::OpenWork;
use crate::validate;

/// Add a decision at the end of a stage's decisions.
///
/// A lead time longer than the time left before the stage starts is allowed:
/// the decision is overdue the moment it exists, and the interface says so
/// rather than refusing — the plan must be able to say the truth.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a name that does not fit, a lead
/// time that is not whole working days from 0 to 3650, or a stage not in this
/// work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn decision_add(
    open: State<'_, OpenWork>,
    stage_id: String,
    name: String,
    lead_time_days: f64,
) -> Result<WorkSnapshot> {
    decision_add_with(&open, &stage_id, &name, lead_time_days)
}

/// Change a decision's name or lead time.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a value that does not fit or a
/// decision not in this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn decision_update(
    open: State<'_, OpenWork>,
    id: String,
    patch: DecisionPatch,
) -> Result<WorkSnapshot> {
    decision_update_with(&open, &id, &patch)
}

/// Remove a decision.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a decision not in this work, and
/// the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn decision_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    decision_remove_with(&open, &id)
}

/// Move a decision one step within its stage, `up` or `down`. At the edge
/// nothing moves, and that is not an error.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a direction that is neither or a
/// decision not in this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn decision_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    decision_move_with(&open, &id, &direction)
}

/// Make a decision now, with the answer the person wrote or none.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for an answer longer than 500
/// characters, a decision not in this work, or one already made; and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn decision_make(
    open: State<'_, OpenWork>,
    id: String,
    answer: Option<String>,
) -> Result<WorkSnapshot> {
    decision_make_with(&open, &id, answer.as_deref())
}

/// Reopen a made decision: open again, with no moment and no answer.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a decision not in this work, or
/// one that is still open; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn decision_reopen(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    decision_reopen_with(&open, &id)
}

/// What [`decision_add`] does once the state is in hand.
pub fn decision_add_with(
    open: &OpenWork,
    stage_id: &str,
    name: &str,
    lead_time_days: f64,
) -> Result<WorkSnapshot> {
    let name = validate::name("decision", name)?;
    let lead_time_days = validate::lead_time_days(lead_time_days)?;
    change_work(open, |conn| {
        repo::add(conn, stage_id, &name, lead_time_days).map(|_| ())
    })
}

/// What [`decision_update`] does once the state is in hand.
pub fn decision_update_with(
    open: &OpenWork,
    id: &str,
    patch: &DecisionPatch,
) -> Result<WorkSnapshot> {
    let name = patch
        .name
        .as_deref()
        .map(|name| validate::name("decision", name))
        .transpose()?;
    let lead_time_days = patch
        .lead_time_days
        .map(validate::lead_time_days)
        .transpose()?;
    change_work(open, |conn| {
        repo::update(conn, id, name.as_deref(), lead_time_days)
    })
}

/// What [`decision_remove`] does once the state is in hand.
pub fn decision_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::remove(conn, id))
}

/// What [`decision_move`] does once the state is in hand.
pub fn decision_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| DECISIONS.move_one(conn, id, direction))
}

/// What [`decision_make`] does once the state is in hand.
pub fn decision_make_with(open: &OpenWork, id: &str, answer: Option<&str>) -> Result<WorkSnapshot> {
    let answer = validate::answer(answer)?;
    change_work(open, |conn| repo::make(conn, id, answer.as_deref()))
}

/// What [`decision_reopen`] does once the state is in hand.
pub fn decision_reopen_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::reopen(conn, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plan::{stage_add_with, stage_remove_with};
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;

    #[test]
    fn a_decision_walks_add_update_move_make_reopen_remove_and_each_step_returns_the_plan() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();

        let plan = decision_add_with(&open, &stage, " Which tile ", 10.0).unwrap();
        let tile = plan.decisions[0].id.clone();
        let wire = serde_json::to_value(&plan.decisions[0]).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({
                "id": tile, "stageId": stage, "position": 1, "name": "Which tile",
                "leadTimeDays": 10, "madeAt": null, "answer": null
            })
        );

        let plan = decision_add_with(&open, &stage, "Which grout", 0.0).unwrap();
        let grout = plan.decisions[1].id.clone();
        let patch: DecisionPatch =
            serde_json::from_value(serde_json::json!({ "leadTimeDays": 3 })).unwrap();
        let plan = decision_update_with(&open, &grout, &patch).unwrap();
        assert_eq!(plan.decisions[1].lead_time_days, 3);
        assert_eq!(
            plan.decisions[1].name, "Which grout",
            "left out, left alone"
        );

        let plan = decision_move_with(&open, &grout, "up").unwrap();
        assert_eq!(plan.decisions[0].id, grout);
        let plan = decision_move_with(&open, &grout, "up").unwrap();
        assert_eq!(plan.decisions[0].id, grout, "the edge is a no-op");

        let plan = decision_make_with(&open, &tile, Some("  Porcelain, grey ")).unwrap();
        let made = plan.decisions.iter().find(|d| d.id == tile).unwrap();
        assert!(made.made_at.is_some());
        assert_eq!(made.answer.as_deref(), Some("Porcelain, grey"));

        let refused = decision_make_with(&open, &tile, None).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "made twice");

        let plan = decision_reopen_with(&open, &tile).unwrap();
        let open_again = plan.decisions.iter().find(|d| d.id == tile).unwrap();
        assert_eq!((&open_again.made_at, &open_again.answer), (&None, &None));

        let plan = decision_make_with(&open, &tile, Some("   ")).unwrap();
        let made = plan.decisions.iter().find(|d| d.id == tile).unwrap();
        assert_eq!(made.answer, None, "an empty answer is no answer");

        let plan = decision_remove_with(&open, &grout).unwrap();
        assert_eq!(plan.decisions.len(), 1);
        assert_eq!(plan.decisions[0].position, 1);
        work_close_with(&open);
    }

    #[test]
    fn a_lead_time_out_of_range_a_long_answer_or_a_bad_name_is_refused_and_nothing_changes() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let tile = decision_add_with(&open, &stage, "Which tile", 10.0)
            .unwrap()
            .decisions[0]
            .id
            .clone();
        let before = crate::commands::work::work_get_with(&open).unwrap();

        for lead in [-1.0, 1.5, 3651.0] {
            assert_eq!(
                decision_add_with(&open, &stage, "Which tap", lead)
                    .unwrap_err()
                    .kind(),
                "invalid_input"
            );
            let patch = DecisionPatch {
                lead_time_days: Some(lead),
                ..DecisionPatch::default()
            };
            assert_eq!(
                decision_update_with(&open, &tile, &patch)
                    .unwrap_err()
                    .kind(),
                "invalid_input"
            );
        }
        assert_eq!(
            decision_add_with(&open, &stage, "  ", 1.0)
                .unwrap_err()
                .to_string(),
            "A decision needs a name."
        );
        assert_eq!(
            decision_make_with(&open, &tile, Some(&"a".repeat(501)))
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
        assert_eq!(
            decision_move_with(&open, &tile, "sideways")
                .unwrap_err()
                .kind(),
            "invalid_input"
        );

        assert_eq!(crate::commands::work::work_get_with(&open).unwrap(), before);
        work_close_with(&open);
    }

    #[test]
    fn removing_a_stage_takes_its_decisions_out_of_the_snapshot() {
        let (_db, open, _scratch) = host_with_a_work();
        let tiling = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let painting = stage_add_with(&open, "Painting").unwrap().stages[1]
            .id
            .clone();
        decision_add_with(&open, &tiling, "Which tile", 10.0).unwrap();
        decision_add_with(&open, &painting, "Which colour", 1.0).unwrap();

        let plan = stage_remove_with(&open, &tiling).unwrap();

        assert_eq!(plan.decisions.len(), 1);
        assert_eq!(plan.decisions[0].name, "Which colour");
        work_close_with(&open);
    }

    #[test]
    fn decision_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        assert_eq!(
            decision_add_with(&open, "s", "Which tile", 1.0)
                .unwrap_err()
                .kind(),
            "no_work_open"
        );
        assert_eq!(
            decision_reopen_with(&open, "d").unwrap_err().kind(),
            "no_work_open"
        );
    }
}
