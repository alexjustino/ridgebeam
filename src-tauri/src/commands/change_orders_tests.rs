//! Change orders walked through the commands the interface calls (slice E1).
//!
//! Before approval there are none. After it, a change is raised on record and
//! waits; it is decided once. An approval writes it into the plan inside a
//! replanning — opened for it, or the one already open — with its cost line,
//! in one transaction: a change that can no longer be applied writes nothing.
//! A decline or a withdrawal writes the decision alone, and the plan reads as
//! it did. Every refusal is a sentence, and changes nothing.

use chrono::NaiveDate;
use serde_json::json;

use crate::commands::change_orders::{
    change_order_decide_with, change_order_raise_with, ASKED_BY_NAME_NEEDED,
    ASKED_BY_PERSON_NEEDED, ASKED_BY_UNKNOWN, COST_NOT_WHOLE, DAYS_NOT_WHOLE,
    EFFECT_ACTIVITY_NEEDED, EFFECT_KIND_UNKNOWN, OUTCOME_UNKNOWN,
};
use crate::commands::checks::{stage_close_with, stage_start_with};
use crate::commands::plan::{
    activity_add_with, activity_remove_with, activity_update_with, person_add_with,
    person_remove_with, stage_add_with,
};
use crate::commands::schedule::{baseline_take_with, dependency_add_with, replan_open_with};
use crate::commands::work::tests::{host, host_with_a_work};
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{
    BaselineRowDraft, ChangeOrderDecisionDraft, ChangeOrderDraft, Endpoint, WorkSnapshot,
};
use crate::db::change_effects::{AFTER_NOT_FOUND, NAMED_TWICE, REMOVED_AND_NAMED};
use crate::db::change_orders::{CHANGE_ORDER_NOT_FOUND, NOT_APPROVED_YET};
use crate::db::testing::Scratch;
use crate::db::work::{ACTIVITY_NOT_FOUND, PERSON_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::Db;
use crate::error::Result;
use crate::folder::OpenWork;

const AUTHOR: &str = "A. Engineer (synthetic)";
const OWNER: &str = "An owner (synthetic)";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

/// A work of two stages — Bathroom (Tiling 3 days → Grout 1 day), Finishes
/// (Paint 2 days) — and a person, A. Tiler.
struct Work {
    _db: Db,
    open: OpenWork,
    _scratch: Scratch,
    bathroom: String,
    finishes: String,
    tiling: String,
    grout: String,
    paint: String,
    tiler: String,
}

fn work() -> Work {
    let (db, open, scratch) = host_with_a_work();
    stage_add_with(&open, "Bathroom").unwrap();
    let plan = stage_add_with(&open, "Finishes").unwrap();
    let (bathroom, finishes) = (plan.stages[0].id.clone(), plan.stages[1].id.clone());
    activity_add_with(&open, &bathroom, "Tiling").unwrap();
    activity_add_with(&open, &bathroom, "Grout").unwrap();
    let plan = activity_add_with(&open, &finishes, "Paint").unwrap();
    let (tiling, grout, paint) = (
        plan.activities[0].id.clone(),
        plan.activities[1].id.clone(),
        plan.activities[2].id.clone(),
    );
    for (id, days) in [(&tiling, 3), (&grout, 1), (&paint, 2)] {
        activity_update_with(&open, id, &from(json!({ "durationDays": days }))).unwrap();
    }
    dependency_add_with(&open, &end(&tiling), &end(&grout), 0.0).unwrap();
    let tiler = person_add_with(&open, "A. Tiler").unwrap().people[0]
        .id
        .clone();
    Work {
        _db: db,
        open,
        _scratch: scratch,
        bathroom,
        finishes,
        tiling,
        grout,
        paint,
        tiler,
    }
}

/// The same work, approved: baseline 1 taken.
fn approved() -> Work {
    let w = work();
    take(&w.open).expect("baseline 1");
    w
}

fn end(id: &str) -> Endpoint {
    Endpoint {
        kind: "activity".into(),
        id: id.into(),
    }
}

fn from<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("a shape the interface could send")
}

/// Take the next baseline with every activity unplaced.
fn take(open: &OpenWork) -> Result<WorkSnapshot> {
    let rows: Vec<BaselineRowDraft> = work_get_with(open)
        .unwrap()
        .activities
        .iter()
        .map(|a| from(json!({ "activityId": a.id })))
        .collect();
    baseline_take_with(open, &rows, None)
}

fn raise(open: &OpenWork, draft: serde_json::Value) -> Result<WorkSnapshot> {
    let draft: ChangeOrderDraft = from(draft);
    change_order_raise_with(open, &draft, today(), OWNER)
}

fn decide(open: &OpenWork, decision: serde_json::Value) -> Result<WorkSnapshot> {
    let decision: ChangeOrderDecisionDraft = from(decision);
    change_order_decide_with(open, &decision, today(), AUTHOR)
}

/// The change of the e2e: the owner asks for an extra socket after the
/// tiling, two working days, $300.00.
fn extra_socket(w: &Work) -> serde_json::Value {
    json!({
        "raisedOn": "2026-10-06",
        "title": "Extra socket",
        "description": "Beside the mirror.",
        "askedBy": "owner",
        "stageId": w.bathroom,
        "costCents": 30000,
        "effects": [
            { "kind": "add", "name": "Extra socket", "durationDays": 2, "after": w.tiling }
        ]
    })
}

#[test]
fn before_approval_there_are_no_change_orders_and_raising_one_is_refused() {
    let w = work();
    let before = work_get_with(&w.open).unwrap();

    let refused = raise(&w.open, extra_socket(&w)).unwrap_err();

    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), NOT_APPROVED_YET);
    let after = work_get_with(&w.open).unwrap();
    assert_eq!(after, before);
    assert!(after.change_orders.is_empty());
    let wire = serde_json::to_value(&after).unwrap();
    assert_eq!(wire["changeOrders"], json!([]), "present, and empty");
    work_close_with(&w.open);
}

#[test]
fn a_change_is_raised_on_record_and_waits_without_touching_the_plan() {
    let w = approved();
    let before = work_get_with(&w.open).unwrap();

    let plan = raise(&w.open, extra_socket(&w)).unwrap();

    let wire = serde_json::to_value(&plan.change_orders[0]).unwrap();
    let id = wire["id"].as_str().unwrap().to_string();
    let created = wire["createdAt"].as_str().unwrap().to_string();
    assert_eq!(id.len(), 36);
    assert_eq!(
        wire,
        json!({
            "id": id, "number": 1, "raisedOn": "2026-10-06", "title": "Extra socket",
            "description": "Beside the mirror.", "askedBy": "owner",
            "askedByPersonId": null, "askedByName": null, "stageId": w.bathroom,
            "costCents": 30000,
            "effects": [
                { "kind": "add", "name": "Extra socket", "durationDays": 2, "after": w.tiling }
            ],
            "authorName": OWNER, "createdAt": created, "decision": null
        })
    );
    // A record, not a plan edit: no replanning, and the plan as it was.
    assert_eq!(plan.replanning, None);
    assert_eq!(
        WorkSnapshot {
            change_orders: Vec::new(),
            ..plan.clone()
        },
        before
    );

    // The next one is #2, whoever asks; the shapes of the other two kinds.
    let plan = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-07", "title": "Shorter grout", "askedBy": "person",
            "askedByPersonId": w.tiler, "askedByName": "left behind by the form",
            "stageId": w.bathroom, "costCents": null,
            "effects": [
                { "kind": "duration", "activityId": w.grout, "durationDays": 1 },
                { "kind": "remove", "activityId": w.paint }
            ]
        }),
    )
    .unwrap();
    let wire = serde_json::to_value(&plan.change_orders[1]).unwrap();
    assert_eq!(wire["number"], 2);
    assert_eq!(wire["askedByPersonId"], w.tiler.as_str());
    assert_eq!(
        wire["askedByName"],
        json!(null),
        "only the chosen one is kept"
    );
    assert_eq!(wire["costCents"], json!(null), "not priced, not 0");
    assert_eq!(
        wire["effects"],
        json!([
            { "kind": "duration", "activityId": w.grout, "durationDays": 1 },
            { "kind": "remove", "activityId": w.paint }
        ])
    );
    let plan = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-08", "title": "Window sill", "askedBy": "other",
            "askedByName": "  The neighbour  ", "stageId": w.finishes, "costCents": 1500
        }),
    )
    .unwrap();
    assert_eq!(plan.change_orders[2].number, 3);
    assert_eq!(
        plan.change_orders[2].asked_by_name.as_deref(),
        Some("The neighbour")
    );
    assert!(plan.change_orders[2].effects.is_empty(), "money alone");
    work_close_with(&w.open);
}

#[test]
fn approving_opens_a_replanning_named_for_the_change_with_the_change_applied_and_its_cost() {
    let w = approved();
    let id = raise(&w.open, extra_socket(&w)).unwrap().change_orders[0]
        .id
        .clone();

    let plan = decide(
        &w.open,
        json!({
            "id": id, "outcome": "approved", "decidedOn": "2026-10-08",
            "note": "  Go ahead.  ", "finishBefore": "2026-10-09", "finishAfter": "2026-10-13",
            "daysDelta": 2
        }),
    )
    .unwrap();

    let replanning = plan.replanning.clone().expect("a replanning is open");
    assert_eq!(replanning.reason, "Change order #1 — Extra socket");
    assert_eq!(replanning.author_name, AUTHOR);
    // The activity, at the end of the change's stage, after the tiling.
    let socket = plan
        .activities
        .iter()
        .find(|a| a.name == "Extra socket")
        .expect("the activity is in the plan");
    assert_eq!(socket.stage_id, w.bathroom);
    assert_eq!(socket.position, 3);
    assert_eq!(socket.duration_days, Some(2));
    assert!(plan
        .dependencies
        .iter()
        .any(|d| d.blocker.id == w.tiling && d.blocked.id == socket.id && d.lag_days == 0));
    // Its money, on its stage.
    let line = plan
        .cost_lines
        .iter()
        .find(|l| l.label == "Change order #1")
        .expect("the cost line");
    assert_eq!(
        (
            line.stage_id.as_str(),
            line.activity_id.as_deref(),
            line.amount_cents
        ),
        (w.bathroom.as_str(), None, Some(30000))
    );
    // The decision, with the impact of that moment.
    let wire = serde_json::to_value(&plan.change_orders[0].decision).unwrap();
    let created = wire["createdAt"].as_str().unwrap().to_string();
    assert_eq!(
        wire,
        json!({
            "outcome": "approved", "decidedOn": "2026-10-08", "note": "Go ahead.",
            "finishBefore": "2026-10-09", "finishAfter": "2026-10-13", "daysDelta": 2,
            "costCents": 30000, "replanningId": replanning.id, "authorName": AUTHOR,
            "createdAt": created
        })
    );

    // The person reviews the plan and takes the next baseline, as always.
    let plan = take(&w.open).unwrap();
    assert_eq!(plan.baselines[1].number, 2);
    assert_eq!(
        plan.baselines[1].reason.as_deref(),
        Some("Change order #1 — Extra socket")
    );
    assert_eq!(plan.replanning, None);
    assert!(plan.baselines[1]
        .rows
        .iter()
        .any(|r| r.name == "Extra socket"));
    work_close_with(&w.open);
}

#[test]
fn an_approval_joins_the_replanning_already_open_and_leaves_its_reason() {
    let w = approved();
    replan_open_with(&w.open, "Tiles arrive two weeks late", AUTHOR).unwrap();
    let open_id = work_get_with(&w.open).unwrap().replanning.unwrap().id;
    let id = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-06", "title": "Longer paint", "askedBy": "owner",
            "stageId": w.finishes,
            "effects": [{ "kind": "duration", "activityId": w.paint, "durationDays": 4 }]
        }),
    )
    .unwrap()
    .change_orders[0]
        .id
        .clone();

    let plan = decide(
        &w.open,
        json!({ "id": id, "outcome": "approved", "decidedOn": "2026-10-09" }),
    )
    .unwrap();

    let replanning = plan.replanning.unwrap();
    assert_eq!(replanning.id, open_id);
    assert_eq!(replanning.reason, "Tiles arrive two weeks late");
    let paint = plan.activities.iter().find(|a| a.id == w.paint).unwrap();
    assert_eq!(paint.duration_days, Some(4));
    let decision = plan.change_orders[0].decision.clone().unwrap();
    assert_eq!(decision.replanning_id.as_deref(), Some(open_id.as_str()));
    assert_eq!(
        (
            decision.finish_before,
            decision.finish_after,
            decision.days_delta
        ),
        (None, None, None),
        "an impact not sent is not known"
    );
    assert!(
        plan.cost_lines.is_empty(),
        "a change not priced adds no cost line"
    );
    work_close_with(&w.open);
}

#[test]
fn a_change_that_can_no_longer_be_applied_refuses_the_whole_approval_and_writes_nothing() {
    let w = approved();
    // Adds an activity, lengthens the grout, removes the paint — in that order,
    // so a partial write would show.
    let id = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-06", "title": "Rework", "askedBy": "owner",
            "stageId": w.bathroom, "costCents": 10000,
            "effects": [
                { "kind": "add", "name": "Sealant", "durationDays": 1, "after": w.grout },
                { "kind": "duration", "activityId": w.grout, "durationDays": 2 },
                { "kind": "remove", "activityId": w.paint }
            ]
        }),
    )
    .unwrap()
    .change_orders[0]
        .id
        .clone();
    // Meanwhile the paint went, in a replanning of its own, closed by a baseline.
    replan_open_with(&w.open, "Painting is the owner's", AUTHOR).unwrap();
    activity_remove_with(&w.open, &w.paint).unwrap();
    let before = take(&w.open).unwrap();
    assert_eq!(before.replanning, None);

    let refused = decide(
        &w.open,
        json!({ "id": id, "outcome": "approved", "decidedOn": "2026-10-09" }),
    )
    .unwrap_err();

    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), ACTIVITY_NOT_FOUND);
    let after = work_get_with(&w.open).unwrap();
    assert_eq!(
        after, before,
        "no replanning, no activity, no duration, no cost line, no decision"
    );
    assert_eq!(after.change_orders[0].decision, None, "it still waits");

    // It can still be withdrawn — and raised again as it now stands.
    let plan = decide(
        &w.open,
        json!({ "id": id, "outcome": "withdrawn", "decidedOn": "2026-10-09" }),
    )
    .unwrap();
    assert_eq!(
        plan.change_orders[0].decision.as_ref().unwrap().outcome,
        "withdrawn"
    );
    work_close_with(&w.open);
}

#[test]
fn a_decline_or_a_withdrawal_writes_the_decision_and_nothing_else() {
    let w = approved();
    raise(&w.open, extra_socket(&w)).unwrap();
    let plan = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-07", "title": "Remove the paint", "askedBy": "person",
            "askedByPersonId": w.tiler, "stageId": w.finishes, "costCents": -20000,
            "effects": [{ "kind": "remove", "activityId": w.paint }]
        }),
    )
    .unwrap();
    let (first, second) = (
        plan.change_orders[0].id.clone(),
        plan.change_orders[1].id.clone(),
    );
    let before = plan;

    decide(
        &w.open,
        json!({
            "id": first, "outcome": "declined", "decidedOn": "2026-10-08",
            "note": "Not this time.", "finishBefore": "2026-10-09",
            "finishAfter": "2026-10-13", "daysDelta": 2
        }),
    )
    .unwrap();
    let plan = decide(
        &w.open,
        json!({ "id": second, "outcome": "withdrawn", "decidedOn": "2026-10-09" }),
    )
    .unwrap();

    assert_eq!(
        WorkSnapshot {
            change_orders: before.change_orders.clone(),
            ..plan.clone()
        },
        before,
        "the plan reads as it did, and no replanning was opened"
    );
    let declined = plan.change_orders[0].decision.clone().unwrap();
    assert_eq!(declined.outcome, "declined");
    assert_eq!(declined.replanning_id, None);
    assert_eq!(
        declined.days_delta,
        Some(2),
        "the impact is kept all the same"
    );
    assert_eq!(declined.cost_cents, Some(30000));
    let withdrawn = plan.change_orders[1].decision.clone().unwrap();
    assert_eq!(withdrawn.outcome, "withdrawn");
    assert_eq!(withdrawn.cost_cents, Some(-20000), "a saving, signed");
    work_close_with(&w.open);
}

#[test]
fn a_saving_approved_keeps_its_amount_and_adds_no_cost_line() {
    let w = approved();
    let id = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-06", "title": "No paint", "askedBy": "owner",
            "stageId": w.finishes, "costCents": -20000,
            "effects": [{ "kind": "remove", "activityId": w.paint }]
        }),
    )
    .unwrap()
    .change_orders[0]
        .id
        .clone();

    let plan = decide(
        &w.open,
        json!({ "id": id, "outcome": "approved", "decidedOn": "2026-10-06", "daysDelta": -2 }),
    )
    .unwrap();

    assert!(plan.activities.iter().all(|a| a.id != w.paint));
    assert!(
        plan.cost_lines.is_empty(),
        "a planned amount is never negative"
    );
    let decision = plan.change_orders[0].decision.clone().unwrap();
    assert_eq!(
        (decision.cost_cents, decision.days_delta),
        (Some(-20000), Some(-2))
    );
    // The baseline still remembers the paint.
    assert!(plan.baselines[0]
        .rows
        .iter()
        .any(|r| r.activity_id == w.paint));
    work_close_with(&w.open);
}

#[test]
fn a_change_is_decided_once_on_a_day_that_has_happened_and_not_before_it_was_raised() {
    let w = approved();
    let id = raise(&w.open, extra_socket(&w)).unwrap().change_orders[0]
        .id
        .clone();

    for (decision, sentence) in [
        (
            json!({ "id": id, "outcome": "approved", "decidedOn": "2026-10-05" }),
            "Change order #1 was raised on 2026-10-06: it cannot be decided before that day.",
        ),
        (
            json!({ "id": id, "outcome": "declined", "decidedOn": "2026-10-10" }),
            "2026-10-10 has not happened yet: a change order is decided on a day that has.",
        ),
        (
            json!({ "id": id, "outcome": "accepted", "decidedOn": "2026-10-08" }),
            OUTCOME_UNKNOWN,
        ),
        (
            json!({ "id": id, "outcome": "declined", "decidedOn": "2026-10-08", "daysDelta": 1.5 }),
            DAYS_NOT_WHOLE,
        ),
        (
            json!({ "id": id, "outcome": "declined", "decidedOn": "2026-10-08",
                    "finishAfter": "2026-02-30" }),
            "The finish with the change is a date written YYYY-MM-DD, on a day that exists.",
        ),
        (
            json!({ "id": "00000000-0000-7000-8000-0000000000ff", "outcome": "declined",
                    "decidedOn": "2026-10-08" }),
            CHANGE_ORDER_NOT_FOUND,
        ),
    ] {
        let refused = decide(&w.open, decision.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{decision}");
        assert_eq!(refused.to_string(), sentence, "{decision}");
    }
    assert_eq!(
        work_get_with(&w.open).unwrap().change_orders[0].decision,
        None
    );

    decide(
        &w.open,
        json!({ "id": id, "outcome": "declined", "decidedOn": "2026-10-06" }),
    )
    .unwrap();
    let before = work_get_with(&w.open).unwrap();
    for outcome in ["approved", "declined", "withdrawn"] {
        let refused = decide(
            &w.open,
            json!({ "id": id, "outcome": outcome, "decidedOn": "2026-10-09" }),
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "Change order #1 was already declined on 2026-10-06: a change order is decided once."
        );
    }
    assert_eq!(work_get_with(&w.open).unwrap(), before);
    work_close_with(&w.open);
}

#[test]
fn what_does_not_fit_is_refused_with_a_sentence_and_nothing_is_raised() {
    let w = approved();
    // A range on the grout: 1 to 2 working days.
    activity_update_with(
        &w.open,
        &w.grout,
        &from(json!({ "durationMinDays": 1, "durationMaxDays": 2 })),
    )
    .unwrap();
    let base = extra_socket(&w);
    let with = |patch: serde_json::Value| {
        let mut draft = base.clone();
        for (key, value) in patch.as_object().unwrap() {
            draft[key] = value.clone();
        }
        draft
    };
    let effects = |effects: serde_json::Value| with(json!({ "effects": effects }));
    let many: Vec<_> = (0..51)
        .map(|i| json!({ "kind": "add", "name": format!("Socket {i}"), "durationDays": 1 }))
        .collect();
    let unknown = "00000000-0000-7000-8000-0000000000ff";

    let cases: Vec<(serde_json::Value, String)> = vec![
        (
            with(json!({ "raisedOn": "2026-10-10" })),
            "2026-10-10 has not happened yet: a change order is raised on a day that has.".into(),
        ),
        (
            with(json!({ "raisedOn": "6 Oct" })),
            "A change order's day is a date written YYYY-MM-DD, on a day that exists.".into(),
        ),
        (
            with(json!({ "title": "   " })),
            "A change order needs a title: say what changes.".into(),
        ),
        (
            with(json!({ "title": "t".repeat(201) })),
            "A change order's title is at most 200 characters.".into(),
        ),
        (
            with(json!({ "title": "Two\nlines" })),
            "A change order's title is one line, with no control character.".into(),
        ),
        (
            with(json!({ "description": "d".repeat(2001) })),
            "A change's description is at most 2000 characters.".into(),
        ),
        (
            with(json!({ "askedBy": "architect" })),
            ASKED_BY_UNKNOWN.into(),
        ),
        (
            with(json!({ "askedBy": "person" })),
            ASKED_BY_PERSON_NEEDED.into(),
        ),
        (
            with(json!({ "askedBy": "person", "askedByPersonId": unknown })),
            PERSON_NOT_FOUND.into(),
        ),
        (
            with(json!({ "askedBy": "other", "askedByName": "  " })),
            ASKED_BY_NAME_NEEDED.into(),
        ),
        (
            with(json!({ "askedBy": "other", "askedByName": "n".repeat(121) })),
            "The name of who asked is at most 120 characters.".into(),
        ),
        (with(json!({ "stageId": unknown })), STAGE_NOT_FOUND.into()),
        (with(json!({ "costCents": 12.5 })), COST_NOT_WHOLE.into()),
        (with(json!({ "costCents": 1e19 })), COST_NOT_WHOLE.into()),
        (
            effects(json!([{ "kind": "move" }])),
            EFFECT_KIND_UNKNOWN.into(),
        ),
        (
            effects(json!([{ "kind": "add", "durationDays": 2 }])),
            "An activity needs a name.".into(),
        ),
        (
            effects(json!([{ "kind": "add", "name": "n".repeat(121), "durationDays": 2 }])),
            "An activity's name is at most 120 characters.".into(),
        ),
        (
            effects(json!([{ "kind": "add", "name": "Socket", "durationDays": 0 }])),
            "A duration is a whole number of working days, from 1 to 3650.".into(),
        ),
        (
            effects(json!([{ "kind": "duration", "activityId": w.grout }])),
            "A duration is a whole number of working days, from 1 to 3650.".into(),
        ),
        (
            effects(json!([{ "kind": "remove" }])),
            EFFECT_ACTIVITY_NEEDED.into(),
        ),
        (
            effects(
                json!([{ "kind": "add", "name": "Socket", "durationDays": 1, "after": unknown }]),
            ),
            AFTER_NOT_FOUND.into(),
        ),
        (
            effects(json!([{ "kind": "duration", "activityId": unknown, "durationDays": 2 }])),
            ACTIVITY_NOT_FOUND.into(),
        ),
        (
            effects(json!([{ "kind": "remove", "activityId": unknown }])),
            ACTIVITY_NOT_FOUND.into(),
        ),
        (
            effects(json!([
                { "kind": "remove", "activityId": w.grout },
                { "kind": "remove", "activityId": w.grout }
            ])),
            NAMED_TWICE.into(),
        ),
        (
            effects(json!([
                { "kind": "duration", "activityId": w.paint, "durationDays": 2 },
                { "kind": "remove", "activityId": w.paint }
            ])),
            REMOVED_AND_NAMED.into(),
        ),
        (
            effects(json!([
                { "kind": "add", "name": "Sealant", "durationDays": 1, "after": w.grout },
                { "kind": "remove", "activityId": w.grout }
            ])),
            REMOVED_AND_NAMED.into(),
        ),
        (
            effects(json!([{ "kind": "duration", "activityId": w.grout, "durationDays": 5 }])),
            "A duration of 5 working days is outside the range of 1 to 2 working days: \
             the duration lies between the optimistic and the pessimistic ends."
                .into(),
        ),
        (
            effects(json!(many)),
            "A change order does at most 50 things to the plan; raise another for the rest.".into(),
        ),
    ];
    for (draft, sentence) in cases {
        let refused = raise(&w.open, draft.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    assert!(work_get_with(&w.open).unwrap().change_orders.is_empty());
    work_close_with(&w.open);
}

#[test]
fn a_closed_stage_takes_no_change_and_no_change_to_its_activities() {
    let w = approved();
    stage_start_with(&w.open, &w.finishes).unwrap();
    stage_close_with(&w.open, &w.finishes).unwrap();

    for draft in [
        json!({
            "raisedOn": "2026-10-06", "title": "Window sill", "askedBy": "owner",
            "stageId": w.finishes, "costCents": 1500
        }),
        json!({
            "raisedOn": "2026-10-06", "title": "Longer paint", "askedBy": "owner",
            "stageId": w.bathroom,
            "effects": [{ "kind": "duration", "activityId": w.paint, "durationDays": 4 }]
        }),
    ] {
        let refused = raise(&w.open, draft.clone()).unwrap_err();
        assert_eq!(refused.kind(), "stage_closed", "{draft}");
        assert_eq!(
            refused.to_string(),
            "“Finishes” is closed. Reopen it to change it."
        );
    }
    assert!(work_get_with(&w.open).unwrap().change_orders.is_empty());
    work_close_with(&w.open);
}

#[test]
fn the_person_who_asked_stays_on_the_record_after_they_leave_the_plan() {
    let w = approved();
    raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-06", "title": "Niche in the shower", "askedBy": "person",
            "askedByPersonId": w.tiler, "stageId": w.bathroom, "costCents": 8000
        }),
    )
    .unwrap();

    let plan = person_remove_with(&w.open, &w.tiler).unwrap();

    assert!(plan.people.is_empty());
    assert_eq!(
        plan.change_orders[0].asked_by_person_id.as_deref(),
        Some(w.tiler.as_str())
    );
    work_close_with(&w.open);
}

#[test]
fn change_order_commands_with_no_work_open_are_no_work_open() {
    let (_db, open) = host();
    let draft: ChangeOrderDraft = from(json!({
        "raisedOn": "2026-10-06", "title": "Extra socket", "askedBy": "owner",
        "stageId": "s"
    }));
    assert_eq!(
        change_order_raise_with(&open, &draft, today(), OWNER)
            .unwrap_err()
            .kind(),
        "no_work_open"
    );
    let decision: ChangeOrderDecisionDraft =
        from(json!({ "id": "x", "outcome": "declined", "decidedOn": "2026-10-06" }));
    assert_eq!(
        change_order_decide_with(&open, &decision, today(), AUTHOR)
            .unwrap_err()
            .kind(),
        "no_work_open"
    );
}
