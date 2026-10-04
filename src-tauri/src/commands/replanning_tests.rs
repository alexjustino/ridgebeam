//! The lock on an approved plan, walked through the commands the interface
//! calls (slice F8).
//!
//! Every command that changes what a baseline records is refused with
//! `plan_approved` once the plan is approved and no replanning is open, and
//! accepted while one is; every fact stays free; `replan_open` refuses what it
//! must; and a baseline after the first needs, copies and closes a replanning.
//! A refusal changes nothing: the plan reads as it did before the attempt.

use chrono::NaiveDate;

use crate::commands::checks::{
    check_add_with, check_answer_with, stage_close_with, stage_reopen_with, stage_start_with,
    AnswerDraft,
};
use crate::commands::decisions::{decision_add_with, decision_make_with};
use crate::commands::diary::diary_entry_add_with;
use crate::commands::documents::document_add_with;
use crate::commands::money::{
    commitment_add_with, cost_line_add_with, cost_line_remove_with, cost_line_update_with,
    payment_add_with, CommitmentDraft,
};
use crate::commands::plan::{
    activity_add_with, activity_move_with, activity_remove_with, activity_update_with,
    calendar_set_with, person_add_with, person_set_stages_with, person_update_with, stage_add_with,
    stage_move_with, stage_remove_with, stage_rename_with,
};
use crate::commands::rooms::{activity_set_rooms_with, room_add_with};
use crate::commands::schedule::{
    baseline_take_with, dependency_add_with, dependency_remove_with, dependency_update_with,
    replan_open_with,
};
use crate::commands::work::tests::host_with_a_work;
use crate::commands::work::{work_close_with, work_get_with, work_open_with, work_update_with};
use crate::contract::{
    BaselineRowDraft, CalendarDraft, CostLinePatch, Endpoint, EntryDraft, WorkPatch, WorkSnapshot,
};
use crate::db::replanning::{ALREADY_OPEN, NOT_APPROVED_YET, PLAN_APPROVED, REASON_NEEDED};
use crate::db::testing::Scratch;
use crate::db::Db;
use crate::error::Result;
use crate::folder::OpenWork;
use crate::validate::REPLAN_REASON_NEEDED;

const AUTHOR: &str = "A. Engineer (synthetic)";
const REASON: &str = "Tiles arrive two weeks late";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

/// A work of three stages — Bathroom (Tiling 3 days, Grout 1 day), Finishes
/// (Paint), Cleanup (nothing yet) — a link Tiling → Grout, and two cost lines:
/// 120 000 on Tiling, 50 000 on Finishes.
struct Work {
    db: Db,
    open: OpenWork,
    scratch: Scratch,
    bathroom: String,
    finishes: String,
    cleanup: String,
    tiling: String,
    grout: String,
    paint: String,
    link: String,
    tiles: String,
    paint_line: String,
}

fn work() -> Work {
    let (db, open, scratch) = host_with_a_work();
    stage_add_with(&open, "Bathroom").unwrap();
    stage_add_with(&open, "Finishes").unwrap();
    let plan = stage_add_with(&open, "Cleanup").unwrap();
    let (bathroom, finishes, cleanup) = (
        plan.stages[0].id.clone(),
        plan.stages[1].id.clone(),
        plan.stages[2].id.clone(),
    );
    activity_add_with(&open, &bathroom, "Tiling").unwrap();
    activity_add_with(&open, &bathroom, "Grout").unwrap();
    let plan = activity_add_with(&open, &finishes, "Paint").unwrap();
    let (tiling, grout, paint) = (
        plan.activities[0].id.clone(),
        plan.activities[1].id.clone(),
        plan.activities[2].id.clone(),
    );
    for (id, days) in [(&tiling, 3), (&grout, 1)] {
        activity_update_with(
            &open,
            id,
            &patch(serde_json::json!({ "durationDays": days })),
        )
        .unwrap();
    }
    let link = dependency_add_with(
        &open,
        &end("activity", &tiling),
        &end("activity", &grout),
        0.0,
    )
    .unwrap()
    .dependencies[0]
        .id
        .clone();
    cost_line_add_with(&open, &bathroom, Some(&tiling), "Tiles", Some(120_000.0)).unwrap();
    let plan = cost_line_add_with(&open, &finishes, None, "Paint", Some(50_000.0)).unwrap();
    let (tiles, paint_line) = (plan.cost_lines[0].id.clone(), plan.cost_lines[1].id.clone());
    Work {
        db,
        open,
        scratch,
        bathroom,
        finishes,
        cleanup,
        tiling,
        grout,
        paint,
        link,
        tiles,
        paint_line,
    }
}

fn end(kind: &str, id: &str) -> Endpoint {
    Endpoint {
        kind: kind.into(),
        id: id.into(),
    }
}

fn patch<T: serde::de::DeserializeOwned>(json: serde_json::Value) -> T {
    serde_json::from_value(json).expect("a patch the interface could send")
}

/// Take the next baseline with every activity unplaced — the host checks the
/// rows, not the schedule.
fn take(open: &OpenWork) -> Result<WorkSnapshot> {
    let rows: Vec<BaselineRowDraft> = work_get_with(open)
        .unwrap()
        .activities
        .iter()
        .map(|a| patch(serde_json::json!({ "activityId": a.id })))
        .collect();
    baseline_take_with(open, &rows, None)
}

/// One command call, named, that the test runs twice.
type Change<'a> = Box<dyn Fn() -> Result<WorkSnapshot> + 'a>;

/// Every command that changes what a baseline records, each making one change
/// that would succeed on a plan being replanned. In an order that works when
/// run through once.
fn locked_changes(w: &Work) -> Vec<(&'static str, Change<'_>)> {
    let open = &w.open;
    vec![
        (
            "stage_add",
            Box::new(move || stage_add_with(open, "Painting")),
        ),
        (
            "stage_rename",
            Box::new(move || stage_rename_with(open, &w.bathroom, "Main bathroom")),
        ),
        (
            "stage_move",
            Box::new(move || stage_move_with(open, &w.finishes, "up")),
        ),
        (
            "activity_add",
            Box::new(move || activity_add_with(open, &w.bathroom, "Sealant")),
        ),
        (
            "activity_update (name)",
            Box::new(move || {
                activity_update_with(
                    open,
                    &w.tiling,
                    &patch(serde_json::json!({ "name": "Wall tiling" })),
                )
            }),
        ),
        (
            "activity_update (duration)",
            Box::new(move || {
                activity_update_with(
                    open,
                    &w.grout,
                    &patch(serde_json::json!({ "durationDays": 2 })),
                )
            }),
        ),
        (
            "activity_update (duration cleared)",
            Box::new(move || {
                activity_update_with(
                    open,
                    &w.grout,
                    &patch(serde_json::json!({ "durationDays": null })),
                )
            }),
        ),
        (
            "activity_move",
            Box::new(move || activity_move_with(open, &w.grout, "up")),
        ),
        (
            "dependency_add",
            Box::new(move || {
                dependency_add_with(
                    open,
                    &end("activity", &w.grout),
                    &end("activity", &w.paint),
                    1.0,
                )
            }),
        ),
        (
            "dependency_update",
            Box::new(move || dependency_update_with(open, &w.link, 2.0)),
        ),
        (
            "dependency_remove",
            Box::new(move || dependency_remove_with(open, &w.link)),
        ),
        (
            "calendar_set",
            Box::new(move || {
                calendar_set_with(
                    open,
                    &CalendarDraft {
                        working_days: "1111110".into(),
                        hours_per_day: 8.0,
                    },
                    &[],
                )
            }),
        ),
        (
            "work_update (start date)",
            Box::new(move || {
                work_update_with(
                    &w.db,
                    open,
                    &WorkPatch {
                        start_date: Some("2026-10-12".into()),
                        ..WorkPatch::default()
                    },
                )
            }),
        ),
        (
            "cost_line_add",
            Box::new(move || cost_line_add_with(open, &w.bathroom, None, "Labour", Some(30_000.0))),
        ),
        (
            "cost_line_update (amount)",
            Box::new(move || {
                cost_line_update_with(
                    open,
                    &w.tiles,
                    &CostLinePatch {
                        amount_cents: Some(Some(130_000.0)),
                        ..CostLinePatch::default()
                    },
                )
            }),
        ),
        (
            "cost_line_update (label)",
            Box::new(move || {
                cost_line_update_with(
                    open,
                    &w.tiles,
                    &CostLinePatch {
                        label: Some("Porcelain tiles".into()),
                        ..CostLinePatch::default()
                    },
                )
            }),
        ),
        (
            "cost_line_remove",
            Box::new(move || cost_line_remove_with(open, &w.paint_line)),
        ),
        (
            "activity_remove",
            Box::new(move || activity_remove_with(open, &w.paint)),
        ),
        (
            "stage_remove",
            Box::new(move || stage_remove_with(open, &w.cleanup)),
        ),
    ]
}

/// The negative the specification names: an approved plan edited with no
/// reason. Every change to what a baseline records is refused with the
/// sentence, and nothing moves; once a replanning is open, every one of them
/// goes through.
#[test]
fn every_change_to_an_approved_plan_is_refused_until_a_replanning_is_open() {
    let w = work();
    let approved = take(&w.open).unwrap();
    assert!(approved.work.approved_at.is_some());
    assert_eq!(approved.replanning, None);

    for (name, change) in locked_changes(&w) {
        let refused = change().expect_err(name);
        assert_eq!(refused.kind(), "plan_approved", "{name}");
        assert_eq!(refused.to_string(), PLAN_APPROVED, "{name}");
        let wire = serde_json::to_value(&refused).unwrap();
        assert_eq!(wire["kind"], "plan_approved");
        assert_eq!(wire["message"], PLAN_APPROVED);
    }
    assert_eq!(
        work_get_with(&w.open).unwrap(),
        approved,
        "no refusal changed anything"
    );

    let plan = replan_open_with(&w.open, REASON, AUTHOR).unwrap();
    assert_eq!(plan.replanning.as_ref().unwrap().reason, REASON);
    for (name, change) in locked_changes(&w) {
        change().unwrap_or_else(|error| panic!("{name} while replanning: {error}"));
    }
    let plan = work_get_with(&w.open).unwrap();
    assert!(
        plan.replanning.is_some(),
        "still open: only a baseline closes it"
    );
    assert_eq!(
        plan.baselines, approved.baselines,
        "the baseline is untouched"
    );
    work_close_with(&w.open);
}

/// Before approval nothing is locked, and there is nothing to replan.
#[test]
fn a_plan_not_yet_approved_is_changed_freely_and_cannot_be_replanned() {
    let w = work();
    let refused = replan_open_with(&w.open, REASON, AUTHOR).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), NOT_APPROVED_YET);
    for (name, change) in locked_changes(&w) {
        change().unwrap_or_else(|error| panic!("{name} before approval: {error}"));
    }
    assert_eq!(work_get_with(&w.open).unwrap().replanning, None);
    work_close_with(&w.open);
}

/// Facts are not the plan: after approval, with no replanning, the diary,
/// answers, a stage's start, close and reopen, payments, commitments,
/// decisions, people, rooms, documents — and the parts of an activity and of
/// the work that a baseline does not record — all stay free. So does a patch
/// that repeats what is held.
#[test]
fn facts_stay_free_after_approval() {
    let w = work();
    take(&w.open).unwrap();
    let open = &w.open;

    let ana = person_add_with(open, "A. Tiler").unwrap().people[0]
        .id
        .clone();
    person_update_with(open, &ana, &patch(serde_json::json!({ "trade": "tiler" }))).unwrap();
    person_set_stages_with(open, &ana, std::slice::from_ref(&w.bathroom)).unwrap();
    activity_update_with(
        open,
        &w.tiling,
        &patch(serde_json::json!({ "responsibleId": ana, "quantity": 12, "unit": "m²" })),
    )
    .unwrap();
    activity_update_with(
        open,
        &w.tiling,
        &patch(serde_json::json!({ "name": "Tiling", "durationDays": 3 })),
    )
    .expect("the name and duration it already has: no change");
    let room = room_add_with(open, "Bathroom").unwrap().rooms[0].id.clone();
    activity_set_rooms_with(open, &w.tiling, &[room]).unwrap();
    work_update_with(
        &w.db,
        open,
        &WorkPatch {
            name: Some("Synthetic bathroom, renamed".into()),
            place: Some("Another synthetic street".into()),
            currency: Some("EUR".into()),
            start_date: Some("2026-10-05".into()),
        },
    )
    .expect("the start it already has: no change");
    cost_line_update_with(
        open,
        &w.tiles,
        &CostLinePatch {
            label: Some("Tiles".into()),
            amount_cents: Some(Some(120_000.0)),
        },
    )
    .expect("the line as it is: no change");

    let decision = decision_add_with(open, &w.finishes, "Which paint", 5.0)
        .unwrap()
        .decisions[0]
        .id
        .clone();
    decision_make_with(open, &decision, Some("Matt white")).unwrap();

    let check = check_add_with(open, &w.bathroom, "start", "The area is clear")
        .unwrap()
        .checks[0]
        .id
        .clone();
    check_answer_with(
        open,
        &AnswerDraft {
            check_id: &check,
            answer: "yes",
            reason: None,
            photo_path: None,
            photo_hash: None,
        },
        AUTHOR,
    )
    .unwrap();
    stage_start_with(open, &w.bathroom).unwrap();
    stage_close_with(open, &w.bathroom).unwrap();
    stage_reopen_with(open, &w.bathroom).unwrap();

    commitment_add_with(
        open,
        &w.bathroom,
        &CommitmentDraft {
            person_id: Some(ana.as_str()),
            label: "Tiler's quote",
            amount_cents: 150_000.0,
            agreed_on: "2026-10-01",
            document_path: None,
            document_hash: None,
        },
    )
    .unwrap();
    payment_add_with(
        open,
        &patch(serde_json::json!({
            "day": "2026-10-08", "stageId": w.bathroom, "amountCents": 50_000
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let entry: EntryDraft = patch(serde_json::json!({
        "day": "2026-10-06", "kind": "entry", "note": "Tiles laid.",
        "done": [{ "activityId": w.tiling, "state": "worked" }]
    }));
    diary_entry_add_with(open, &entry, today(), AUTHOR).unwrap();
    let photo = w.scratch.path().join("wall.png");
    std::fs::write(&photo, crate::files::intake::tests::png(8, 8)).unwrap();
    let added = document_add_with(
        open,
        &[photo.to_string_lossy().into_owned()],
        "photo",
        None,
        today(),
        AUTHOR,
    )
    .unwrap();
    assert!(added.refused.is_empty());

    let plan = work_get_with(open).unwrap();
    assert_eq!(plan.replanning, None, "no fact opened a replanning");
    assert_eq!(plan.baselines.len(), 1);
    assert_eq!(plan.activities[0].name, "Tiling");
    assert_eq!(plan.work.start_date, "2026-10-05");
    work_close_with(open);
}

/// `replan_open` refuses a blank reason, one too long, and a second one while
/// one is open; it is a row, so it survives closing and opening the work.
#[test]
fn a_replanning_needs_a_reason_is_one_at_a_time_and_survives_a_restart() {
    let w = work();
    take(&w.open).unwrap();

    for blank in ["", "   ", "\n\t"] {
        let refused = replan_open_with(&w.open, blank, AUTHOR).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), REPLAN_REASON_NEEDED);
    }
    let refused = replan_open_with(&w.open, &"x".repeat(2001), AUTHOR).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(work_get_with(&w.open).unwrap().replanning, None);

    let plan = replan_open_with(&w.open, &format!("  {REASON}  "), AUTHOR).unwrap();
    let wire = serde_json::to_value(&plan).unwrap();
    let replanning = wire["replanning"].as_object().expect("an object");
    assert_eq!(replanning.len(), 4, "{replanning:?}");
    assert_eq!(replanning["reason"], REASON, "trimmed");
    assert_eq!(replanning["authorName"], AUTHOR);
    assert!(replanning["openedAt"].is_string());
    assert_eq!(replanning["id"].as_str().unwrap().len(), 36);

    let refused = replan_open_with(&w.open, "Another reason", AUTHOR).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), ALREADY_OPEN);

    let folder = w.scratch.path().join("Bathroom");
    work_close_with(&w.open);
    work_open_with(&w.db, &w.open, &folder.to_string_lossy()).unwrap();
    let plan = work_get_with(&w.open).unwrap();
    assert_eq!(
        plan.replanning.map(|r| r.reason).as_deref(),
        Some(REASON),
        "a replanning is a row: it is still open after a restart"
    );
    work_close_with(&w.open);
}

/// Baseline 2 is refused without a replanning — the second sentence — and
/// with one it records the reason, the stages and the money as the file holds
/// them, closes the replanning, and locks the plan again.
#[test]
fn a_second_baseline_needs_the_reason_records_it_and_locks_the_plan_again() {
    let w = work();
    let plan = take(&w.open).unwrap();
    let first = &plan.baselines[0];
    assert_eq!(first.reason, None);
    assert_eq!(first.planned_cents, Some(170_000), "recorded by this build");
    let stages: Vec<_> = first
        .stages
        .iter()
        .map(|s| (s.stage_id.as_str(), s.name.as_str(), s.planned_cents))
        .collect();
    assert_eq!(
        stages,
        vec![
            (w.bathroom.as_str(), "Bathroom", Some(120_000)),
            (w.finishes.as_str(), "Finishes", Some(50_000)),
            (w.cleanup.as_str(), "Cleanup", Some(0)),
        ]
    );

    let refused = take(&w.open).unwrap_err();
    assert_eq!(refused.kind(), "plan_approved");
    assert_eq!(refused.to_string(), REASON_NEEDED);
    assert_eq!(work_get_with(&w.open).unwrap().baselines.len(), 1);

    replan_open_with(&w.open, REASON, AUTHOR).unwrap();
    activity_update_with(
        &w.open,
        &w.tiling,
        &patch(serde_json::json!({ "durationDays": 13 })),
    )
    .unwrap();
    stage_rename_with(&w.open, &w.bathroom, "Main bathroom").unwrap();
    stage_add_with(&w.open, "Painting").unwrap();
    cost_line_update_with(
        &w.open,
        &w.tiles,
        &CostLinePatch {
            amount_cents: Some(Some(135_000.0)),
            ..CostLinePatch::default()
        },
    )
    .unwrap();

    let plan = take(&w.open).unwrap();
    assert_eq!(plan.replanning, None, "closed by the baseline it asked for");
    let second = &plan.baselines[1];
    assert_eq!(second.number, 2);
    assert_eq!(second.reason.as_deref(), Some(REASON));
    assert_eq!(second.planned_cents, Some(185_000));
    assert_eq!(
        second.stages[0].stage_id, w.bathroom,
        "renamed, the same stage"
    );
    assert_eq!(second.stages[0].name, "Main bathroom");
    assert_eq!(second.stages.len(), 4);
    assert_eq!(second.rows[0].duration_days, Some(13));
    assert_eq!(second.rows[0].planned_cents, Some(135_000));
    assert_eq!(plan.baselines[0], *first, "baseline 1 is as it was");

    let refused = activity_update_with(
        &w.open,
        &w.tiling,
        &patch(serde_json::json!({ "durationDays": 4 })),
    )
    .unwrap_err();
    assert_eq!(refused.kind(), "plan_approved", "locked again");
    assert_eq!(take(&w.open).unwrap_err().to_string(), REASON_NEEDED);
    work_close_with(&w.open);
}
