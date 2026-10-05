//! The purchase commands (G2) as the interface calls them: the wire in
//! camelCase with `null` never absent, every refusal a sentence, nothing
//! written on any of them, and a plan's approval that does not lock a
//! purchase. Every name is synthetic.

use chrono::NaiveDate;
use serde_json::json;

use crate::commands::plan::{activity_add_with, stage_add_with};
use crate::commands::purchases::*;
use crate::commands::schedule::baseline_take_with;
use crate::commands::work::tests::{host, host_with_a_work};
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{BaselineRowDraft, PurchaseDraft, PurchaseEventDraft};
use crate::db::money::ACTIVITY_OF_ANOTHER_STAGE;
use crate::db::purchases::{PURCHASE_NOT_FOUND, PURCHASE_ON_RECORD};
use crate::db::work::{ACTIVITY_NOT_FOUND, STAGE_NOT_FOUND};
use crate::folder::OpenWork;

const AUTHOR: &str = "A. Owner (synthetic)";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

fn purchase(value: serde_json::Value) -> PurchaseDraft {
    serde_json::from_value(value).unwrap()
}

fn event(value: serde_json::Value) -> PurchaseEventDraft {
    serde_json::from_value(value).unwrap()
}

/// A kitchen with two activities and a bathroom with one.
struct Site {
    kitchen: String,
    cabinets: String,
    worktop_fit: String,
    tiling: String,
}

fn site(open: &OpenWork) -> Site {
    let kitchen = stage_add_with(open, "Kitchen").unwrap().stages[0]
        .id
        .clone();
    let cabinets = activity_add_with(open, &kitchen, "Fit the cabinets")
        .unwrap()
        .activities[0]
        .id
        .clone();
    let worktop_fit = activity_add_with(open, &kitchen, "Fit the worktop")
        .unwrap()
        .activities[1]
        .id
        .clone();
    let bathroom = stage_add_with(open, "Bathroom").unwrap().stages[1]
        .id
        .clone();
    let tiling = activity_add_with(open, &bathroom, "Tiling")
        .unwrap()
        .activities[2]
        .id
        .clone();
    Site {
        kitchen,
        cabinets,
        worktop_fit,
        tiling,
    }
}

/// The e2e's shape in the host: a worktop and cabinet handles; the worktop
/// ordered and delivered, the handles' order falling through; the wire as the
/// interface reads it.
#[test]
fn purchases_are_added_ordered_delivered_and_fall_through_and_cross_the_wire_in_camel_case() {
    let (_db, open, _scratch) = host_with_a_work();
    let s = site(&open);

    let plan = purchase_add_with(
        &open,
        &purchase(json!({
            "stageId": s.kitchen, "activityId": s.worktop_fit, "name": "  Worktop  ",
            "quantity": "3.2 m", "supplier": "The stone yard", "leadDays": 21,
            "note": "Oak.\nOiled."
        })),
    )
    .unwrap();
    let worktop = plan.purchases[0].id.clone();
    let plan = purchase_add_with(
        &open,
        &purchase(json!({ "stageId": s.kitchen, "name": "Cabinet handles", "leadDays": 3 })),
    )
    .unwrap();
    let handles = plan.purchases[1].id.clone();
    let wire = serde_json::to_value(&plan).unwrap();
    let written = |at: usize| wire["purchases"][at]["createdAt"].clone();
    assert!(written(0).is_string() && written(1).is_string());
    assert_eq!(
        wire["purchases"][0],
        json!({
            "id": worktop, "position": 1, "stageId": s.kitchen, "activityId": s.worktop_fit,
            "name": "Worktop", "quantity": "3.2 m", "supplier": "The stone yard",
            "leadDays": 21, "note": "Oak.\nOiled.", "createdAt": written(0), "events": []
        })
    );
    assert_eq!(
        wire["purchases"][1],
        json!({
            "id": handles, "position": 2, "stageId": s.kitchen, "activityId": null,
            "name": "Cabinet handles", "quantity": null, "supplier": null, "leadDays": 3,
            "note": null, "createdAt": written(1), "events": []
        }),
        "null, never absent"
    );

    purchase_event_add_with(
        &open,
        &event(json!({ "purchaseId": worktop, "kind": "ordered", "day": "2026-10-09" })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let plan = purchase_event_add_with(
        &open,
        &event(json!({
            "purchaseId": worktop, "kind": "delivered", "day": "2026-10-09",
            "note": "Two men, one van."
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let wire = serde_json::to_value(&plan.purchases[0].events).unwrap();
    let created = wire[1]["createdAt"].clone();
    assert!(created.is_string());
    assert_eq!(
        wire[1],
        json!({
            "purchaseId": worktop, "seq": 2, "kind": "delivered", "day": "2026-10-09",
            "note": "Two men, one van.", "authorName": AUTHOR, "createdAt": created
        })
    );
    assert_eq!(wire[0]["note"], json!(null));

    purchase_event_add_with(
        &open,
        &event(json!({ "purchaseId": handles, "kind": "ordered", "day": "2026-10-06" })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let plan = purchase_event_add_with(
        &open,
        &event(json!({
            "purchaseId": handles, "kind": "cancelled", "day": "2026-10-08",
            "note": "Out of stock."
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let kinds: Vec<_> = plan.purchases[1]
        .events
        .iter()
        .map(|e| (e.seq, e.kind.as_str()))
        .collect();
    assert_eq!(kinds, vec![(1, "ordered"), (2, "cancelled")]);

    // Written whole on a purchase already delivered: its words change, `null`
    // clears the quantity, supplier and note — but the lead time, the stage
    // and the activity it was ordered with are fixed.
    for (key, value) in [
        ("leadDays", json!(28)),
        ("activityId", json!(null)),
        ("activityId", json!(s.cabinets)),
    ] {
        let mut draft = json!({
            "id": worktop, "stageId": s.kitchen, "activityId": s.worktop_fit,
            "name": "Worktop, oak", "leadDays": 21
        });
        draft[key] = value;
        let refused = purchase_update_with(&open, &purchase(draft.clone())).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(
            refused.to_string(),
            "The lead time, the stage and the activity of a purchase are fixed once it has been ordered: an order keeps the lead time it was placed with.",
            "{draft}"
        );
    }
    let plan = purchase_update_with(
        &open,
        &purchase(json!({
            "id": worktop, "stageId": s.kitchen, "activityId": s.worktop_fit,
            "name": "Worktop, oak", "quantity": null, "supplier": null, "leadDays": 21,
            "note": null
        })),
    )
    .unwrap();
    let w = &plan.purchases[0];
    assert_eq!(
        (
            w.name.as_str(),
            w.lead_days,
            w.activity_id.as_deref(),
            &w.quantity,
            &w.supplier,
            &w.note,
            w.events.len()
        ),
        (
            "Worktop, oak",
            21,
            Some(s.worktop_fit.as_str()),
            &None,
            &None,
            &None,
            2
        )
    );
    work_close_with(&open);
}

#[test]
fn a_purchase_that_does_not_fit_is_refused_with_its_sentence_and_nothing_is_written() {
    let (_db, open, _scratch) = host_with_a_work();
    let s = site(&open);
    let base = json!({ "stageId": s.kitchen, "name": "Worktop", "leadDays": 21 });
    let with = |key: &str, value: serde_json::Value| {
        let mut draft = base.clone();
        draft[key] = value;
        purchase(draft)
    };
    for (draft, sentence) in [
        (with("name", json!("   ")), NAME_NEEDED.to_string()),
        (
            with("name", json!("x".repeat(201))),
            "A purchase's name is at most 200 characters.".into(),
        ),
        (
            with("name", json!("Two\nlines")),
            "A purchase's name is one line, with no control character.".into(),
        ),
        (
            with("quantity", json!("q".repeat(61))),
            "A purchase's quantity is at most 60 characters.".into(),
        ),
        (
            with("supplier", json!("s".repeat(121))),
            "A purchase's supplier is at most 120 characters.".into(),
        ),
        (
            with("note", json!("n".repeat(2001))),
            "A purchase's note is at most 2000 characters.".into(),
        ),
        (with("leadDays", json!(366)), LEAD_DAYS.into()),
        (with("leadDays", json!(-1)), LEAD_DAYS.into()),
        (with("leadDays", json!(2.5)), LEAD_DAYS.into()),
        (
            with("stageId", json!(crate::db::new_id())),
            STAGE_NOT_FOUND.into(),
        ),
        (
            with("activityId", json!(crate::db::new_id())),
            ACTIVITY_NOT_FOUND.into(),
        ),
        (
            with("activityId", json!(s.tiling)),
            ACTIVITY_OF_ANOTHER_STAGE.into(),
        ),
    ] {
        let refused = purchase_add_with(&open, &draft).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft:?}");
        assert_eq!(refused.to_string(), sentence, "{draft:?}");
    }
    assert_eq!(
        LEAD_DAYS,
        "A lead time is a whole number of calendar days, from 0 to 365."
    );
    assert!(work_get_with(&open).unwrap().purchases.is_empty());

    purchase_add_with(&open, &with("leadDays", json!(0))).expect("0: it is on the shelf");
    purchase_add_with(&open, &with("activityId", json!(s.cabinets)))
        .expect("an activity of the stage");
    assert_eq!(
        purchase_update_with(&open, &purchase(base.clone()))
            .unwrap_err()
            .to_string(),
        PURCHASE_ID_NEEDED
    );
    assert_eq!(
        purchase_update_with(&open, &with("id", json!(crate::db::new_id())))
            .unwrap_err()
            .to_string(),
        PURCHASE_NOT_FOUND
    );
    assert_eq!(
        purchase_remove_with(&open, &crate::db::new_id())
            .unwrap_err()
            .to_string(),
        PURCHASE_NOT_FOUND
    );
    assert_eq!(work_get_with(&open).unwrap().purchases.len(), 2);
    work_close_with(&open);
}

#[test]
fn an_event_out_of_order_on_a_day_not_yet_happened_or_of_no_kind_is_refused_and_nothing_is_written()
{
    let (_db, open, _scratch) = host_with_a_work();
    let s = site(&open);
    let id = |plan: crate::contract::WorkSnapshot, at: usize| plan.purchases[at].id.clone();
    let worktop = id(
        purchase_add_with(
            &open,
            &purchase(json!({ "stageId": s.kitchen, "name": "Worktop", "leadDays": 21 })),
        )
        .unwrap(),
        0,
    );
    let handles = id(
        purchase_add_with(
            &open,
            &purchase(json!({ "stageId": s.kitchen, "name": "Handles", "leadDays": 3 })),
        )
        .unwrap(),
        1,
    );
    let mark = |purchase: &str, kind: &str, day: &str| {
        purchase_event_add_with(
            &open,
            &event(json!({ "purchaseId": purchase, "kind": kind, "day": day })),
            today(),
            AUTHOR,
        )
    };
    mark(&worktop, "ordered", "2026-10-05").unwrap();
    mark(&worktop, "delivered", "2026-10-08").unwrap();
    mark(&handles, "ordered", "2026-10-07").unwrap();
    let before = work_get_with(&open).unwrap().purchases;

    let long = "n".repeat(501);
    for (draft, sentence) in [
        (
            json!({ "purchaseId": handles, "kind": "lost", "day": "2026-10-09" }),
            KIND_UNKNOWN.to_string(),
        ),
        (
            json!({ "purchaseId": "  ", "kind": "ordered", "day": "2026-10-09" }),
            EVENT_PURCHASE_NEEDED.into(),
        ),
        (
            json!({ "purchaseId": handles, "kind": "delivered", "day": "2026-10-10" }),
            "2026-10-10 has not happened yet: a purchase is marked on a day that has.".into(),
        ),
        (
            json!({ "purchaseId": handles, "kind": "delivered", "day": "9 Oct" }),
            "The day of an order, a delivery or a cancellation is a date written YYYY-MM-DD, on a day that exists.".into(),
        ),
        (
            json!({ "purchaseId": handles, "kind": "delivered", "day": "2026-10-09", "note": long }),
            "A note on what happened is at most 500 characters.".into(),
        ),
        (
            json!({ "purchaseId": crate::db::new_id(), "kind": "ordered", "day": "2026-10-09" }),
            PURCHASE_NOT_FOUND.into(),
        ),
        (
            json!({ "purchaseId": handles, "kind": "ordered", "day": "2026-10-09" }),
            "“Handles” was already ordered on 2026-10-07: it is ordered again only if that order falls through.".into(),
        ),
        (
            json!({ "purchaseId": worktop, "kind": "cancelled", "day": "2026-10-09" }),
            "“Worktop” was delivered on 2026-10-08: nothing more happens to a purchase once it is delivered.".into(),
        ),
        (
            json!({ "purchaseId": handles, "kind": "delivered", "day": "2026-10-06" }),
            "“Handles” was ordered on 2026-10-07: what happens next is on that day or later.".into(),
        ),
    ] {
        let refused =
            purchase_event_add_with(&open, &event(draft.clone()), today(), AUTHOR).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    assert_eq!(work_get_with(&open).unwrap().purchases, before);

    // The handles' order falls through: to order again, and nothing else.
    mark(&handles, "cancelled", "2026-10-09").unwrap();
    for (kind, sentence) in [
        (
            "delivered",
            "“Handles” has no open order: it is marked as delivered only once it has been ordered.",
        ),
        (
            "cancelled",
            "“Handles” has no open order to fall through: only an order not yet delivered falls through.",
        ),
    ] {
        assert_eq!(
            mark(&handles, kind, "2026-10-09").unwrap_err().to_string(),
            sentence
        );
    }
    let plan = mark(&handles, "ordered", "2026-10-09").expect("ordered again");
    assert_eq!(plan.purchases[1].events.len(), 3);
    work_close_with(&open);
}

/// Buying is the work, not its scope: an approved plan with no replanning
/// open still takes, changes and loses purchases — but not one ordered.
#[test]
fn purchases_are_not_locked_by_the_plans_approval_and_one_ordered_is_not_removed() {
    let (_db, open, _scratch) = host_with_a_work();
    let s = site(&open);
    let rows: Vec<BaselineRowDraft> = [&s.cabinets, &s.worktop_fit, &s.tiling]
        .iter()
        .map(|id| serde_json::from_value(json!({ "activityId": id })).unwrap())
        .collect();
    baseline_take_with(&open, &rows, None).unwrap();
    assert!(work_get_with(&open).unwrap().work.approved_at.is_some());

    let draft = json!({ "stageId": s.kitchen, "name": "Worktop", "leadDays": 21 });
    let worktop = purchase_add_with(&open, &purchase(draft.clone()))
        .expect("approved, and still added")
        .purchases[0]
        .id
        .clone();
    let spare = purchase_add_with(&open, &purchase(draft.clone()))
        .unwrap()
        .purchases[1]
        .id
        .clone();
    let mut whole = draft.clone();
    whole["id"] = json!(worktop);
    whole["leadDays"] = json!(30);
    purchase_update_with(&open, &purchase(whole)).expect("approved, and still changed");

    purchase_event_add_with(
        &open,
        &event(json!({ "purchaseId": worktop, "kind": "ordered", "day": "2026-10-09" })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let refused = purchase_remove_with(&open, &worktop).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), PURCHASE_ON_RECORD);
    assert_eq!(
        PURCHASE_ON_RECORD,
        "That purchase has been ordered, and what happened to it is on record: it cannot be removed."
    );

    let plan = purchase_remove_with(&open, &spare).expect("nothing has happened to it");
    assert_eq!(plan.purchases.len(), 1);
    assert_eq!(plan.purchases[0].position, 1);
    assert_eq!(plan.purchases[0].lead_days, 30);
    work_close_with(&open);
}

#[test]
fn purchase_commands_with_no_work_open_are_no_work_open() {
    let (_db, open) = host();
    assert_eq!(
        purchase_remove_with(&open, "x").unwrap_err().kind(),
        "no_work_open"
    );
    assert_eq!(
        purchase_event_add_with(
            &open,
            &event(json!({ "purchaseId": "x", "kind": "ordered", "day": "2026-10-09" })),
            today(),
            AUTHOR
        )
        .unwrap_err()
        .kind(),
        "no_work_open"
    );
}
