//! An activity's range, walked through `activity_update` (slice D1).
//!
//! The optimistic and the pessimistic duration are the input of the finish as
//! a probability, which is the domain's alone. The host's part: the two ends
//! arrive together or not at all, each a duration, the optimistic not above
//! the pessimistic, and no change leaves the duration outside them — refused
//! with a sentence naming the range. The range is not what a baseline records,
//! so approval does not lock it; the duration still is. A refusal changes
//! nothing.

use serde_json::json;

use crate::commands::plan::{activity_add_with, activity_update_with, stage_add_with};
use crate::commands::schedule::{baseline_take_with, replan_open_with};
use crate::commands::templates::plan_apply_with;
use crate::commands::work::tests::host_with_a_work;
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{Activity, ActivityPatch, BaselineRowDraft, WorkSnapshot};
use crate::db::replanning::PLAN_APPROVED;
use crate::db::testing::Scratch;
use crate::db::work::duration_outside_range;
use crate::db::Db;
use crate::error::Result;
use crate::folder::OpenWork;
use crate::validate::{RANGE_BOTH_OR_NEITHER, RANGE_END_NOT_A_DURATION};

fn from<T: serde::de::DeserializeOwned>(json: serde_json::Value) -> T {
    serde_json::from_value(json).expect("a value the interface could send")
}

fn update(open: &OpenWork, id: &str, patch: serde_json::Value) -> Result<WorkSnapshot> {
    activity_update_with(open, id, &from::<ActivityPatch>(patch))
}

fn range_of(activity: &Activity) -> (Option<i64>, Option<i64>, Option<i64>) {
    (
        activity.duration_days,
        activity.duration_min_days,
        activity.duration_max_days,
    )
}

/// A work of one stage and one activity, Tiling, with nothing set yet.
fn tiling() -> (Db, OpenWork, Scratch, String) {
    let (db, open, scratch) = host_with_a_work();
    let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
        .id
        .clone();
    let tiling = activity_add_with(&open, &stage, "Tiling")
        .unwrap()
        .activities[0]
        .id
        .clone();
    (db, open, scratch, tiling)
}

/// Take the next baseline with every activity unplaced — the host checks the
/// rows, not the schedule.
fn take(open: &OpenWork) -> Result<WorkSnapshot> {
    let rows: Vec<BaselineRowDraft> = work_get_with(open)
        .unwrap()
        .activities
        .iter()
        .map(|a| from(json!({ "activityId": a.id })))
        .collect();
    baseline_take_with(open, &rows, None)
}

#[test]
fn a_range_is_set_on_any_activity_with_or_without_a_duration_and_cleared_with_null() {
    let (_db, open, _scratch, tiling) = tiling();

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 2, "durationMaxDays": 4 }),
    )
    .unwrap();
    let wire = serde_json::to_value(&plan.activities[0]).unwrap();
    assert_eq!(
        (
            &wire["durationDays"],
            &wire["durationMinDays"],
            &wire["durationMaxDays"]
        ),
        (&json!(null), &json!(2), &json!(4)),
        "a range with no duration is a range"
    );

    let plan = update(&open, &tiling, json!({ "durationDays": 3 })).unwrap();
    assert_eq!(range_of(&plan.activities[0]), (Some(3), Some(2), Some(4)));

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 3, "durationMaxDays": 3 }),
    )
    .unwrap();
    assert_eq!(
        range_of(&plan.activities[0]),
        (Some(3), Some(3), Some(3)),
        "a point is a range"
    );

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 1, "durationMaxDays": 3650 }),
    )
    .unwrap();
    assert_eq!(
        range_of(&plan.activities[0]),
        (Some(3), Some(1), Some(3650))
    );

    let plan = update(&open, &tiling, json!({ "name": "Wall tiling" })).unwrap();
    assert_eq!(
        range_of(&plan.activities[0]),
        (Some(3), Some(1), Some(3650)),
        "left out, left alone"
    );

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": null, "durationMaxDays": null }),
    )
    .unwrap();
    assert_eq!(
        range_of(&plan.activities[0]),
        (Some(3), None, None),
        "cleared; the duration stays"
    );

    update(
        &open,
        &tiling,
        json!({ "durationMinDays": 2, "durationMaxDays": 5 }),
    )
    .unwrap();
    let plan = update(&open, &tiling, json!({ "durationDays": null })).unwrap();
    assert_eq!(
        range_of(&plan.activities[0]),
        (None, Some(2), Some(5)),
        "clearing the duration leaves the range"
    );
    work_close_with(&open);
}

#[test]
fn a_range_sent_with_one_end_is_refused_and_nothing_changes() {
    let (_db, open, _scratch, tiling) = tiling();
    update(
        &open,
        &tiling,
        json!({ "durationDays": 3, "durationMinDays": 2, "durationMaxDays": 4 }),
    )
    .unwrap();
    let before = work_get_with(&open).unwrap();

    for patch in [
        json!({ "durationMinDays": 1 }),
        json!({ "durationMaxDays": 6 }),
        json!({ "durationMinDays": null }),
        json!({ "durationMaxDays": null }),
        json!({ "durationMinDays": 1, "durationMaxDays": null }),
        json!({ "durationMinDays": null, "durationMaxDays": 6 }),
        json!({ "name": "Wall tiling", "durationMinDays": 1 }),
    ] {
        let refused = update(&open, &tiling, patch.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{patch}");
        assert_eq!(refused.to_string(), RANGE_BOTH_OR_NEITHER, "{patch}");
    }
    assert_eq!(work_get_with(&open).unwrap(), before, "nothing changed");
    work_close_with(&open);
}

#[test]
fn an_end_that_is_not_a_duration_or_a_range_upside_down_is_refused() {
    let (_db, open, _scratch, tiling) = tiling();
    let before = work_get_with(&open).unwrap();

    for (min, max) in [
        (json!(0), json!(4)),
        (json!(2), json!(3651)),
        (json!(1.5), json!(4)),
        (json!(2), json!(4.5)),
        (json!(-2), json!(4)),
    ] {
        let refused = update(
            &open,
            &tiling,
            json!({ "durationMinDays": min, "durationMaxDays": max }),
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{min} {max}");
        assert_eq!(refused.to_string(), RANGE_END_NOT_A_DURATION, "{min} {max}");
    }

    let refused = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 6, "durationMaxDays": 4 }),
    )
    .unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(
        refused.to_string(),
        "The range runs from the optimistic duration to the pessimistic one: 6 is above 4."
    );
    assert_eq!(work_get_with(&open).unwrap(), before, "nothing changed");
    work_close_with(&open);
}

/// Min ≤ duration ≤ max, whichever side moves: a duration typed outside the
/// range it has, a range given that the duration it has falls outside, and
/// both sent together. Refused — never widened, never cleared — with a
/// sentence naming the range.
#[test]
fn a_duration_outside_its_range_is_refused_both_ways_with_the_range_named() {
    let (_db, open, _scratch, tiling) = tiling();
    update(
        &open,
        &tiling,
        json!({ "durationDays": 3, "durationMinDays": 2, "durationMaxDays": 4 }),
    )
    .expect("2 ≤ 3 ≤ 4, sent together");
    let before = work_get_with(&open).unwrap();

    for (patch, sentence) in [
        (
            json!({ "durationDays": 5 }),
            duration_outside_range(5, 2, 4),
        ),
        (
            json!({ "durationDays": 1 }),
            duration_outside_range(1, 2, 4),
        ),
        (
            json!({ "durationMinDays": 4, "durationMaxDays": 6 }),
            duration_outside_range(3, 4, 6),
        ),
        (
            json!({ "durationMinDays": 1, "durationMaxDays": 2 }),
            duration_outside_range(3, 1, 2),
        ),
        (
            json!({ "durationDays": 7, "durationMinDays": 2, "durationMaxDays": 6 }),
            duration_outside_range(7, 2, 6),
        ),
        (
            json!({ "durationDays": 1, "durationMinDays": 2, "durationMaxDays": 6 }),
            duration_outside_range(1, 2, 6),
        ),
    ] {
        let refused = update(&open, &tiling, patch.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{patch}");
        assert_eq!(refused.to_string(), sentence, "{patch}");
    }
    assert_eq!(
        duration_outside_range(5, 2, 4),
        "A duration of 5 working days is outside the range of 2 to 4 working days: \
         the duration lies between the optimistic and the pessimistic ends."
    );
    assert_eq!(
        duration_outside_range(1, 2, 4),
        "A duration of 1 working day is outside the range of 2 to 4 working days: \
         the duration lies between the optimistic and the pessimistic ends."
    );
    assert_eq!(work_get_with(&open).unwrap(), before, "nothing changed");

    let plan = update(
        &open,
        &tiling,
        json!({ "durationDays": 7, "durationMinDays": 5, "durationMaxDays": 9 }),
    )
    .expect("the range moved with the duration, in one patch");
    assert_eq!(range_of(&plan.activities[0]), (Some(7), Some(5), Some(9)));
    let plan = update(&open, &tiling, json!({ "durationDays": 5 })).expect("the lower end");
    assert_eq!(plan.activities[0].duration_days, Some(5));
    let plan = update(&open, &tiling, json!({ "durationDays": 9 })).expect("the upper end");
    assert_eq!(plan.activities[0].duration_days, Some(9));
    work_close_with(&open);
}

/// F9 let a person type a duration outside a template's range ("a person who
/// knows better types what they know"), and a template may carry one. Such a
/// row is not refused for a change to something else, nor for the same values
/// sent again; the first change to its duration or its range must bring the
/// duration inside.
#[test]
fn a_row_already_outside_its_range_is_refused_only_when_its_duration_or_range_changes() {
    let (_db, open, _scratch) = host_with_a_work();
    let draft = json!({
        "stages": [{ "key": "bath", "name": "Bathroom", "activities": [
            { "key": "tile", "name": "Tiling", "durationDays": 9,
              "durationMinDays": 2, "durationMaxDays": 4 }
        ] }]
    });
    let provenance =
        json!({ "templateId": "synthetic", "templateVersion": 1, "templateTitle": "S" });
    let plan = plan_apply_with(&open, &from(draft), &from(provenance)).unwrap();
    let tiling = plan.activities[0].id.clone();
    assert_eq!(range_of(&plan.activities[0]), (Some(9), Some(2), Some(4)));

    update(
        &open,
        &tiling,
        json!({ "name": "Wall tiling", "quantity": 12, "unit": "m²" }),
    )
    .expect("the range is not what changed");
    update(
        &open,
        &tiling,
        json!({ "durationDays": 9, "durationMinDays": 2, "durationMaxDays": 4 }),
    )
    .expect("what is held, sent again, changes nothing");

    let refused = update(&open, &tiling, json!({ "durationDays": 8 })).unwrap_err();
    assert_eq!(refused.to_string(), duration_outside_range(8, 2, 4));
    let refused = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 3, "durationMaxDays": 5 }),
    )
    .unwrap_err();
    assert_eq!(refused.to_string(), duration_outside_range(9, 3, 5));

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 6, "durationMaxDays": 12 }),
    )
    .expect("a range that holds the duration");
    assert_eq!(range_of(&plan.activities[0]), (Some(9), Some(6), Some(12)));
    work_close_with(&open);
}

/// The lock (F8) is on what a baseline records. A range is not in a baseline:
/// on an approved plan with no replanning open, a range-only patch goes
/// through — set, changed, cleared — and the baseline is untouched. A patch
/// that also changes the duration is still `plan_approved`, and changes
/// nothing, range included.
#[test]
fn a_range_is_free_on_an_approved_plan_and_a_duration_is_still_locked() {
    let (_db, open, _scratch, tiling) = tiling();
    update(&open, &tiling, json!({ "durationDays": 3 })).unwrap();
    let approved = take(&open).unwrap();
    assert!(approved.work.approved_at.is_some());
    assert_eq!(approved.replanning, None);

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 2, "durationMaxDays": 4 }),
    )
    .expect("a range is not locked");
    assert_eq!(range_of(&plan.activities[0]), (Some(3), Some(2), Some(4)));
    update(
        &open,
        &tiling,
        json!({ "durationMinDays": 1, "durationMaxDays": 6 }),
    )
    .expect("changed");
    update(
        &open,
        &tiling,
        json!({ "durationDays": 3, "durationMinDays": 2, "durationMaxDays": 5 }),
    )
    .expect("the duration it already has, beside a new range");
    let plan = work_get_with(&open).unwrap();
    assert_eq!(
        plan.baselines, approved.baselines,
        "the baseline is untouched"
    );
    assert_eq!(plan.replanning, None, "no replanning was opened");

    let before = work_get_with(&open).unwrap();
    for patch in [
        json!({ "durationDays": 4 }),
        json!({ "durationDays": 4, "durationMinDays": 2, "durationMaxDays": 6 }),
        json!({ "durationDays": null }),
    ] {
        let refused = update(&open, &tiling, patch.clone()).unwrap_err();
        assert_eq!(refused.kind(), "plan_approved", "{patch}");
        assert_eq!(refused.to_string(), PLAN_APPROVED, "{patch}");
    }
    assert_eq!(
        work_get_with(&open).unwrap(),
        before,
        "no refusal changed anything, the range sent beside the duration included"
    );

    let plan = update(
        &open,
        &tiling,
        json!({ "durationMinDays": null, "durationMaxDays": null }),
    )
    .expect("cleared on an approved plan");
    assert_eq!(range_of(&plan.activities[0]), (Some(3), None, None));

    replan_open_with(&open, "Tiles arrive late", "A. Engineer (synthetic)").unwrap();
    let plan = update(
        &open,
        &tiling,
        json!({ "durationDays": 4, "durationMinDays": 3, "durationMaxDays": 6 }),
    )
    .expect("while replanning, the duration moves too");
    assert_eq!(range_of(&plan.activities[0]), (Some(4), Some(3), Some(6)));
    work_close_with(&open);
}

/// The lock's refusal comes before the range's: a duration change on a locked
/// plan is `plan_approved` even when the range it is sent with would also be
/// refused — the person learns first that the plan is approved.
#[test]
fn on_a_locked_plan_a_duration_change_is_plan_approved_before_the_range_is_asked() {
    let (_db, open, _scratch, tiling) = tiling();
    update(
        &open,
        &tiling,
        json!({ "durationDays": 3, "durationMinDays": 2, "durationMaxDays": 4 }),
    )
    .unwrap();
    take(&open).unwrap();

    let refused = update(&open, &tiling, json!({ "durationDays": 8 })).unwrap_err();
    assert_eq!(refused.kind(), "plan_approved");

    let refused = update(
        &open,
        &tiling,
        json!({ "durationMinDays": 4, "durationMaxDays": 6 }),
    )
    .unwrap_err();
    assert_eq!(
        (refused.kind(), refused.to_string()),
        ("invalid_input", duration_outside_range(3, 4, 6)),
        "a range-only patch is not locked, and still holds the duration"
    );
    work_close_with(&open);
}
