//! A plan applied whole, ranges taken, and a line not priced yet, walked
//! through the commands the interface calls (slice F9).
//!
//! A template's plan is written onto an empty, unapproved work in one
//! transaction — every row, or none: a row that does not fit, a key that names
//! nothing, a loop in the links, or a work that already has a plan leaves the
//! work as it was. `work_create` with a plan that is refused leaves nothing:
//! no folder the call created, no file, no recent row. Every fixture is
//! synthetic.

use serde_json::{json, Value};

use crate::commands::checks::{stage_close_with, stage_start_with};
use crate::commands::money::{cost_line_add_with, cost_line_update_with};
use crate::commands::plan::{activity_add_with, activity_update_with, stage_add_with};
use crate::commands::schedule::{baseline_take_with, replan_open_with};
use crate::commands::templates::{plan_apply_with, ranges_take_with, NOTHING_TO_START, WHICH_END};
use crate::commands::work::tests::{draft, host, host_with_a_work};
use crate::commands::work::{
    recent_works_with, with_work, work_close_with, work_create_from, work_current_with,
    work_get_with,
};
use crate::contract::{BaselineRowDraft, PlanDraft, PlanStart, Provenance, WorkSnapshot};
use crate::db::dependencies::{DUPLICATE_DEPENDENCY, SELF_DEPENDENCY};
use crate::db::replanning::PLAN_APPROVED;
use crate::db::templates::PLAN_ALREADY;
use crate::db::testing::Scratch;
use crate::error::{Error, Result};
use crate::folder::{self, OpenWork};

fn from<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("a shape the interface could send")
}

/// What the domain would send for a small bathroom template: two rooms; a
/// strip-out stage (a range, a point applied as a duration, a start check, a
/// priced line and an unpriced one on an activity, a decision with a lead
/// range); a tiling stage (a range, two checks, a decision needing its second
/// activity); and two links — an activity to an activity with a lag, and a
/// stage to a stage.
fn bathroom() -> Value {
    json!({
        "rooms": [
            { "key": "bathroom", "name": "Bathroom" },
            { "key": "hall", "name": "Hall" }
        ],
        "stages": [
            {
                "key": "strip-out", "name": "Strip out",
                "activities": [
                    { "key": "remove-tiles", "name": "Remove the tiles", "durationDays": null,
                      "durationMinDays": 1, "durationMaxDays": 3, "rooms": ["bathroom"] },
                    { "key": "skip", "name": "Skip out", "durationDays": 1,
                      "durationMinDays": 1, "durationMaxDays": 1, "rooms": ["hall", "bathroom", "hall"] }
                ],
                "checks": [ { "gate": "start", "name": "Is the water off?" } ],
                "costLines": [
                    { "label": "Skip hire", "activityKey": "skip", "amountCents": 45000 },
                    { "label": "Labour", "activityKey": null, "amountCents": null }
                ],
                "decisions": [
                    { "name": "Which skip", "leadTimeDays": 5, "leadMinDays": 2, "leadMaxDays": 5,
                      "needsKey": null }
                ]
            },
            {
                "key": "tiling", "name": "Tiling",
                "activities": [
                    { "key": "walls", "name": "Tile the walls", "durationDays": null,
                      "durationMinDays": 3, "durationMaxDays": 5, "rooms": [] },
                    { "key": "grout", "name": "Grout", "durationDays": null,
                      "durationMinDays": null, "durationMaxDays": null, "rooms": [] }
                ],
                "checks": [
                    { "gate": "close", "name": "Is the grout sealed?" },
                    { "gate": "start", "name": "Are the tiles on site?" }
                ],
                "costLines": [ { "label": "Tiles", "activityKey": "walls", "amountCents": null } ],
                "decisions": [
                    { "name": "Which tile", "leadTimeDays": 15, "leadMinDays": 5, "leadMaxDays": 15,
                      "needsKey": "grout" }
                ]
            }
        ],
        "links": [
            { "blocker": { "kind": "activity", "stageKey": "strip-out", "activityKey": "remove-tiles" },
              "blocked": { "kind": "activity", "stageKey": "strip-out", "activityKey": "skip" },
              "lagDays": 2 },
            { "blocker": { "kind": "stage", "stageKey": "strip-out", "activityKey": null },
              "blocked": { "kind": "stage", "stageKey": "tiling", "activityKey": null },
              "lagDays": 0 }
        ]
    })
}

fn provenance() -> Provenance {
    from(json!({
        "templateId": "bathroom-renovation", "templateVersion": 1,
        "templateTitle": "Bathroom renovation"
    }))
}

fn apply(open: &OpenWork, draft: Value) -> Result<WorkSnapshot> {
    plan_apply_with(open, &from::<PlanDraft>(draft), &provenance())
}

/// The part of a plan a refused apply must leave as it found it.
fn plan_rows(plan: &WorkSnapshot) -> Value {
    json!({
        "work": plan.work,
        "rooms": plan.rooms,
        "stages": plan.stages,
        "activities": plan.activities,
        "dependencies": plan.dependencies,
        "decisions": plan.decisions,
        "checks": plan.checks,
        "costLines": plan.cost_lines,
    })
}

/// Apply a draft that must be refused with `kind` (and, when given, exactly
/// `sentence`), and prove nothing moved.
fn refused(open: &OpenWork, draft: Value, kind: &str, sentence: Option<&str>) -> Error {
    let before = plan_rows(&work_get_with(open).unwrap());
    let error = apply(open, draft).expect_err("refused");
    assert_eq!(error.kind(), kind, "{error}");
    if let Some(sentence) = sentence {
        assert_eq!(error.to_string(), sentence);
    }
    assert_eq!(
        plan_rows(&work_get_with(open).unwrap()),
        before,
        "nothing written"
    );
    error
}

#[test]
fn a_template_applied_to_an_empty_work_writes_every_row_with_new_ids_and_its_provenance() {
    let (_db, open, _scratch) = host_with_a_work();

    let plan = apply(&open, bathroom()).expect("an empty work takes a plan");

    let rooms: Vec<&str> = plan.rooms.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(rooms, vec!["Bathroom", "Hall"]);
    let (bathroom, hall) = (plan.rooms[0].id.clone(), plan.rooms[1].id.clone());
    let stages: Vec<(i64, &str)> = plan
        .stages
        .iter()
        .map(|s| (s.position, s.name.as_str()))
        .collect();
    assert_eq!(stages, vec![(1, "Strip out"), (2, "Tiling")]);
    let (strip, tiling) = (plan.stages[0].id.clone(), plan.stages[1].id.clone());

    let wire = serde_json::to_value(&plan.activities).unwrap();
    let activity = |i: usize, key: &str| wire[i][key].clone();
    assert_eq!(activity(0, "name"), "Remove the tiles");
    assert_eq!(
        (
            activity(0, "durationDays"),
            activity(0, "durationMinDays"),
            activity(0, "durationMaxDays")
        ),
        (Value::Null, json!(1), json!(3)),
        "a range is a range: no duration invented"
    );
    assert_eq!(activity(0, "roomIds"), json!([bathroom]));
    assert_eq!(
        (activity(1, "durationDays"), activity(1, "durationMinDays")),
        (json!(1), json!(1)),
        "a point is that activity's duration"
    );
    assert_eq!(
        activity(1, "roomIds"),
        json!([bathroom, hall]),
        "each room once, in the rooms' order"
    );
    assert_eq!(activity(2, "stageId"), json!(tiling));
    assert_eq!(
        (
            activity(3, "durationMinDays"),
            activity(3, "durationMaxDays")
        ),
        (Value::Null, Value::Null)
    );
    let ids: Vec<&str> = plan.activities.iter().map(|a| a.id.as_str()).collect();
    assert!(
        ids.iter().all(|id| id.len() == 36),
        "new ids, never the keys"
    );

    let checks: Vec<(&str, &str, i64, &str)> = plan
        .checks
        .iter()
        .map(|c| {
            (
                c.stage_id.as_str(),
                c.gate.as_str(),
                c.position,
                c.name.as_str(),
            )
        })
        .collect();
    assert_eq!(
        checks,
        vec![
            (strip.as_str(), "start", 1, "Is the water off?"),
            (tiling.as_str(), "start", 1, "Are the tiles on site?"),
            (tiling.as_str(), "close", 1, "Is the grout sealed?"),
        ]
    );

    let lines = serde_json::to_value(&plan.cost_lines).unwrap();
    assert_eq!(lines[0]["label"], "Skip hire");
    assert_eq!(lines[0]["activityId"], json!(ids[1]));
    assert_eq!(lines[0]["amountCents"], 45_000);
    assert_eq!(lines[1]["label"], "Labour");
    assert_eq!(
        (
            lines[1]["activityId"].clone(),
            lines[1]["amountCents"].clone()
        ),
        (Value::Null, Value::Null),
        "not priced yet: null, not 0"
    );
    assert_eq!(lines[2]["activityId"], json!(ids[2]));
    assert_eq!(lines[2]["amountCents"], Value::Null);

    let decisions = serde_json::to_value(&plan.decisions).unwrap();
    assert_eq!(decisions[0]["stageId"], json!(strip));
    assert_eq!(
        (
            decisions[0]["leadTimeDays"].clone(),
            decisions[0]["leadMinDays"].clone(),
            decisions[0]["leadMaxDays"].clone()
        ),
        (json!(5), json!(2), json!(5))
    );
    assert_eq!(decisions[1]["name"], "Which tile");
    assert_eq!(decisions[1]["leadTimeDays"], 15);

    let links: Vec<(&str, &str, &str, &str, i64)> = plan
        .dependencies
        .iter()
        .map(|d| {
            (
                d.blocker.kind.as_str(),
                d.blocker.id.as_str(),
                d.blocked.kind.as_str(),
                d.blocked.id.as_str(),
                d.lag_days,
            )
        })
        .collect();
    assert_eq!(
        links,
        vec![
            ("activity", ids[0], "activity", ids[1], 2),
            ("stage", strip.as_str(), "stage", tiling.as_str(), 0),
        ]
    );

    let work = serde_json::to_value(&plan.work).unwrap();
    assert_eq!(work["templateId"], "bathroom-renovation");
    assert_eq!(work["templateVersion"], 1);
    assert_eq!(work["templateTitle"], "Bathroom renovation");
    assert_eq!(work["approvedAt"], Value::Null);
    work_close_with(&open);
}

#[test]
fn a_work_started_empty_has_no_provenance_on_the_wire() {
    let (_db, open, _scratch) = host_with_a_work();
    let work = serde_json::to_value(work_get_with(&open).unwrap().work).unwrap();
    for key in ["templateId", "templateVersion", "templateTitle"] {
        assert_eq!(work[key], Value::Null, "`{key}` is null, and present");
    }
    work_close_with(&open);
}

#[test]
fn a_template_is_refused_on_a_work_that_has_a_stage_or_is_approved() {
    let (_db, open, _scratch) = host_with_a_work();
    stage_add_with(&open, "Somebody's own stage").unwrap();
    refused(&open, bathroom(), "invalid_input", Some(PLAN_ALREADY));
    work_close_with(&open);

    // Approved, with no stage left: a plan was approved here, so it is not
    // empty.
    let (_db, open, _scratch) = host_with_a_work();
    with_work(&open, |state| {
        state
            .conn
            .execute(
                "UPDATE work SET approved_at = '2026-09-25T12:00:00.000Z'",
                [],
            )
            .map(|_| ())
            .map_err(Error::from)
    })
    .unwrap();
    refused(&open, bathroom(), "invalid_input", Some(PLAN_ALREADY));
    work_close_with(&open);
}

#[test]
fn a_template_applied_twice_is_refused_the_second_time() {
    let (_db, open, _scratch) = host_with_a_work();
    apply(&open, bathroom()).unwrap();
    refused(&open, bathroom(), "invalid_input", Some(PLAN_ALREADY));
    work_close_with(&open);
}

/// The negative case of SPEC §6: a template with a cycle. Every one refused
/// with the loop by name, and nothing written — not the rooms, not the
/// stages, not the provenance.
#[test]
fn a_template_whose_links_close_a_loop_is_refused_by_name_and_writes_nothing() {
    let (_db, open, _scratch) = host_with_a_work();
    let end = |kind: &str, stage: &str, activity: Option<&str>| json!({ "kind": kind, "stageKey": stage, "activityKey": activity });
    let with_links = |links: Value| {
        let mut draft = bathroom();
        draft["links"] = links;
        draft
    };

    // Across stages: Tile the walls → Remove the tiles, while strip-out
    // waits for nothing and tiling waits for strip-out.
    let error = refused(
        &open,
        with_links(json!([
            { "blocker": end("stage", "strip-out", None), "blocked": end("stage", "tiling", None),
              "lagDays": 0 },
            { "blocker": end("activity", "tiling", Some("walls")),
              "blocked": end("activity", "strip-out", Some("remove-tiles")), "lagDays": 1 }
        ])),
        "dependency_cycle",
        None,
    );
    assert!(error.to_string().contains(" → "), "{error}");
    assert!(error.to_string().contains("Tile the walls"), "{error}");

    // A stage waiting on an activity inside it.
    refused(
        &open,
        with_links(json!([
            { "blocker": end("activity", "tiling", Some("grout")),
              "blocked": end("stage", "tiling", None), "lagDays": 0 }
        ])),
        "dependency_cycle",
        Some("Grout → Grout"),
    );

    // Two activities waiting on each other.
    refused(
        &open,
        with_links(json!([
            { "blocker": end("activity", "tiling", Some("walls")),
              "blocked": end("activity", "tiling", Some("grout")), "lagDays": 0 },
            { "blocker": end("activity", "tiling", Some("grout")),
              "blocked": end("activity", "tiling", Some("walls")), "lagDays": 0 }
        ])),
        "dependency_cycle",
        Some("Grout → Tile the walls → Grout"),
    );

    // A link to itself, and the same link twice, as `dependency_add` says.
    refused(
        &open,
        with_links(json!([
            { "blocker": end("stage", "tiling", None), "blocked": end("stage", "tiling", None),
              "lagDays": 0 }
        ])),
        "invalid_input",
        Some(SELF_DEPENDENCY),
    );
    refused(
        &open,
        with_links(json!([
            { "blocker": end("stage", "strip-out", None), "blocked": end("stage", "tiling", None),
              "lagDays": 0 },
            { "blocker": end("stage", "strip-out", None), "blocked": end("stage", "tiling", None),
              "lagDays": 3 }
        ])),
        "invalid_input",
        Some(DUPLICATE_DEPENDENCY),
    );

    assert_eq!(work_get_with(&open).unwrap().work.template_id, None);
    apply(&open, bathroom()).expect("and the same work still takes a good plan");
    work_close_with(&open);
}

#[test]
fn a_key_that_does_not_resolve_or_is_named_twice_is_refused_with_a_sentence() {
    let (_db, open, _scratch) = host_with_a_work();
    let changed = |change: &dyn Fn(&mut Value)| {
        let mut draft = bathroom();
        change(&mut draft);
        draft
    };

    for (draft, sentence) in [
        (
            changed(&|d| d["stages"][0]["activities"][0]["rooms"] = json!(["kitchen"])),
            "The activity “Remove the tiles” names a room “kitchen” that is not in the plan.",
        ),
        (
            changed(&|d| d["stages"][0]["costLines"][0]["activityKey"] = json!("walls")),
            "The cost line “Skip hire” names an activity “walls” that is not in its stage.",
        ),
        (
            changed(&|d| d["stages"][1]["decisions"][0]["needsKey"] = json!("skip")),
            "The decision “Which tile” names an activity “skip” that is not in its stage.",
        ),
        (
            changed(&|d| d["links"][0]["blocker"]["stageKey"] = json!("plumbing")),
            "A dependency names a stage “plumbing” that is not in the plan.",
        ),
        (
            changed(&|d| d["links"][0]["blocked"]["activityKey"] = json!("walls")),
            "A dependency names an activity “strip-out/walls” that is not in the plan.",
        ),
        (
            changed(&|d| d["links"][1]["blocker"]["activityKey"] = json!("skip")),
            "A dependency on the stage “strip-out” names no activity, and this one names “skip”.",
        ),
        (
            changed(&|d| d["links"][0]["blocker"]["activityKey"] = Value::Null),
            "A dependency on an activity says which one of the stage “strip-out”.",
        ),
        (
            changed(&|d| d["links"][0]["blocker"]["kind"] = json!("room")),
            "A dependency joins an activity or a stage.",
        ),
        (
            changed(&|d| d["stages"][1]["key"] = json!("strip-out")),
            "Two stages of the plan share the key “strip-out”.",
        ),
        (
            changed(&|d| d["stages"][1]["activities"][1]["key"] = json!("walls")),
            "Two activities of the stage “Tiling” share the key “walls”.",
        ),
        (
            changed(&|d| d["rooms"][1]["key"] = json!("bathroom")),
            "Two rooms of the plan share the key “bathroom”.",
        ),
        (
            changed(&|d| d["stages"][0]["key"] = json!("")),
            "A stage's key is 1 to 64 characters, with no space around it.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["key"] = json!("k".repeat(65))),
            "An activity's key is 1 to 64 characters, with no space around it.",
        ),
        (
            json!({ "rooms": [], "stages": [], "links": [] }),
            NOTHING_TO_START,
        ),
    ] {
        refused(&open, draft, "invalid_input", Some(sentence));
    }
    // The same key in two stages is two activities.
    apply(
        &open,
        changed(&|d| {
            d["stages"][1]["activities"][1]["key"] = json!("skip");
            d["stages"][1]["decisions"][0]["needsKey"] = json!("skip");
        }),
    )
    .expect("an activity's key is unique inside its stage, not across stages");
    work_close_with(&open);
}

/// Every row is held to the limits of the command that adds one of its kind.
#[test]
fn a_row_past_the_limits_of_its_own_command_is_refused_and_nothing_is_written() {
    let (_db, open, _scratch) = host_with_a_work();
    let changed = |change: &dyn Fn(&mut Value)| {
        let mut draft = bathroom();
        change(&mut draft);
        draft
    };
    let long = "x".repeat(121);

    for (draft, sentence) in [
        (
            changed(&|d| d["stages"][0]["name"] = json!(long)),
            "A stage's name is at most 120 characters.",
        ),
        (
            changed(&|d| d["rooms"][0]["name"] = json!("  ")),
            "A room needs a name.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["name"] = json!(long)),
            "An activity's name is at most 120 characters.",
        ),
        (
            changed(&|d| d["stages"][0]["checks"][0]["name"] = json!("q".repeat(201))),
            "A check's question is at most 200 characters.",
        ),
        (
            changed(&|d| d["stages"][0]["checks"][0]["gate"] = json!("middle")),
            "A check belongs to the start gate or the close gate.",
        ),
        (
            changed(&|d| d["stages"][0]["costLines"][0]["label"] = json!(long)),
            "A cost line's label is at most 120 characters.",
        ),
        (
            changed(&|d| d["stages"][0]["costLines"][0]["amountCents"] = json!(-1)),
            "An amount is zero or more, in whole cents.",
        ),
        (
            changed(&|d| d["stages"][0]["costLines"][0]["amountCents"] = json!(10.5)),
            "An amount is zero or more, in whole cents.",
        ),
        (
            changed(&|d| d["stages"][0]["decisions"][0]["name"] = json!(long)),
            "A decision's name is at most 120 characters.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["durationDays"] = json!(0)),
            "A duration is a whole number of working days, from 1 to 3650.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["durationDays"] = json!(2.5)),
            "A duration is a whole number of working days, from 1 to 3650.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["durationMaxDays"] = json!(3651)),
            "A duration is a whole number of working days, from 1 to 3650.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["durationMinDays"] = json!(4)),
            "The range of the activity “Remove the tiles” runs from its lower end to its upper end: 4 is above 3.",
        ),
        (
            changed(&|d| d["stages"][0]["activities"][0]["durationMaxDays"] = Value::Null),
            "The range of the activity “Remove the tiles” needs both of its ends, or neither.",
        ),
        (
            changed(&|d| d["stages"][0]["decisions"][0]["leadTimeDays"] = json!(3651)),
            "A lead time is a whole number of working days, from 0 to 3650.",
        ),
        (
            changed(&|d| d["stages"][0]["decisions"][0]["leadMinDays"] = json!(-1)),
            "A lead time is a whole number of working days, from 0 to 3650.",
        ),
        (
            changed(&|d| d["stages"][0]["decisions"][0]["leadMinDays"] = json!(9)),
            "The range of the decision “Which skip” runs from its lower end to its upper end: 9 is above 5.",
        ),
        (
            changed(&|d| d["links"][0]["lagDays"] = json!(-1)),
            "A lag is a whole number of working days, from 0 to 3650.",
        ),
    ] {
        refused(&open, draft, "invalid_input", Some(sentence));
    }

    for (provenance, sentence) in [
        (
            json!({ "templateId": "Bathroom Renovation", "templateVersion": 1, "templateTitle": "B" }),
            "A template's id is kebab-case, 1 to 64 characters — such as bathroom-renovation.",
        ),
        (
            json!({ "templateId": "bathroom--renovation", "templateVersion": 1, "templateTitle": "B" }),
            "A template's id is kebab-case, 1 to 64 characters — such as bathroom-renovation.",
        ),
        (
            json!({ "templateId": "bathroom", "templateVersion": 0, "templateTitle": "B" }),
            "A template's version is a whole number, from 1 to 1000000.",
        ),
        (
            json!({ "templateId": "bathroom", "templateVersion": 1.5, "templateTitle": "B" }),
            "A template's version is a whole number, from 1 to 1000000.",
        ),
        (
            json!({ "templateId": "bathroom", "templateVersion": 1, "templateTitle": " " }),
            "A template needs a title.",
        ),
        (
            json!({ "templateId": "bathroom", "templateVersion": 1, "templateTitle": long }),
            "A template's title is at most 120 characters.",
        ),
    ] {
        let error = plan_apply_with(&open, &from(bathroom()), &from(provenance)).unwrap_err();
        assert_eq!(error.to_string(), sentence);
    }
    let plan = work_get_with(&open).unwrap();
    assert!(plan.stages.is_empty() && plan.rooms.is_empty());
    work_close_with(&open);
}

fn start(plan: Value) -> PlanStart {
    PlanStart {
        draft: from(plan),
        provenance: provenance(),
    }
}

fn files_in(folder: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn a_work_created_with_a_plan_opens_with_it_and_is_first_in_the_recent_list() {
    let (db, open) = host();
    let scratch = Scratch::create();
    let folder = scratch.path().join("Bathroom");

    let summary = work_create_from(
        &db,
        &open,
        &folder.to_string_lossy(),
        &draft("Synthetic bathroom"),
        Some(&start(bathroom())),
    )
    .expect("created with its plan");

    let plan = work_get_with(&open).unwrap();
    assert_eq!(plan.work.work_id, summary.work_id);
    assert_eq!(plan.stages.len(), 2);
    assert_eq!(plan.activities.len(), 4);
    assert_eq!(
        plan.work.template_title.as_deref(),
        Some("Bathroom renovation")
    );
    assert_eq!(recent_works_with(&db).unwrap()[0].work_id, summary.work_id);
    work_close_with(&open);
    assert_eq!(files_in(&folder), vec![folder::WORK_FILE]);
}

/// The negative case of SPEC §6 at the Start screen: a template refused leaves
/// no work behind — not the folder the call created, not a file, not a recent
/// row — whether the plan is refused before the disk is touched (a row past
/// its limits) or by the file (a loop), and a folder that was there and empty
/// before stays there, empty.
#[test]
fn a_work_created_with_a_refused_plan_leaves_no_folder_no_file_and_no_recent_row() {
    let (db, open) = host();
    let scratch = Scratch::create();
    let mut looped = bathroom();
    looped["links"] = json!([
        { "blocker": { "kind": "activity", "stageKey": "tiling", "activityKey": "walls" },
          "blocked": { "kind": "stage", "stageKey": "tiling", "activityKey": null }, "lagDays": 0 }
    ]);
    let mut too_long = bathroom();
    too_long["stages"][0]["name"] = json!("x".repeat(121));

    for (plan, kind) in [
        (looped.clone(), "dependency_cycle"),
        (too_long, "invalid_input"),
    ] {
        let folder = scratch.path().join("Never");
        let error = work_create_from(
            &db,
            &open,
            &folder.to_string_lossy(),
            &draft("Synthetic bathroom"),
            Some(&start(plan)),
        )
        .unwrap_err();
        assert_eq!(error.kind(), kind, "{error}");
        assert!(!folder.exists(), "the folder the call created is gone");
    }

    let empty = scratch.path().join("Empty already");
    std::fs::create_dir(&empty).unwrap();
    let error = work_create_from(
        &db,
        &open,
        &empty.to_string_lossy(),
        &draft("Synthetic bathroom"),
        Some(&start(looped)),
    )
    .unwrap_err();
    assert_eq!(error.kind(), "dependency_cycle");
    assert!(empty.is_dir(), "a folder that was there stays there");
    assert!(files_in(&empty).is_empty(), "and empty, as it was");

    assert!(recent_works_with(&db).unwrap().is_empty(), "no recent row");
    assert_eq!(work_current_with(&open).unwrap(), None, "and nothing open");
    assert_eq!(files_in(scratch.path()), vec!["Empty already"]);
}

/// A work already open stays open when a new one with a refused plan is not
/// created.
#[test]
fn a_refused_plan_at_create_leaves_the_open_work_open() {
    let (db, open, scratch) = host_with_a_work();
    let mut looped = bathroom();
    looped["links"][0]["blocked"] = looped["links"][0]["blocker"].clone();

    work_create_from(
        &db,
        &open,
        &scratch.path().join("Kitchen").to_string_lossy(),
        &draft("Synthetic kitchen"),
        Some(&start(looped)),
    )
    .unwrap_err();

    assert_eq!(
        work_current_with(&open).unwrap().unwrap().name,
        "Synthetic bathroom"
    );
    assert_eq!(recent_works_with(&db).unwrap().len(), 1);
    work_close_with(&open);
}

fn durations(plan: &WorkSnapshot) -> Vec<(String, Option<i64>)> {
    plan.activities
        .iter()
        .map(|a| (a.name.clone(), a.duration_days))
        .collect()
}

fn named(pairs: &[(&str, Option<i64>)]) -> Vec<(String, Option<i64>)> {
    pairs.iter().map(|(n, d)| (n.to_string(), *d)).collect()
}

#[test]
fn taking_the_ranges_writes_only_activities_with_a_range_and_no_duration() {
    for (which, tiles) in [("low", 1), ("high", 3)] {
        let (_db, open, _scratch) = host_with_a_work();
        let plan = apply(&open, bathroom()).unwrap();
        // A person typed a duration on one ranged activity: it is kept.
        let walls_id = plan.activities[2].id.clone();
        activity_update_with(&open, &walls_id, &from(json!({ "durationDays": 4 }))).unwrap();
        let plan = activity_add_with(&open, &plan.stages[1].id, "Clean up").unwrap();
        assert_eq!(
            durations(&plan),
            named(&[
                ("Remove the tiles", None),
                ("Skip out", Some(1)),
                ("Tile the walls", Some(4)),
                ("Grout", None),
                ("Clean up", None),
            ])
        );

        let plan = ranges_take_with(&open, which).unwrap();

        assert_eq!(
            durations(&plan),
            named(&[
                ("Remove the tiles", Some(tiles)),
                ("Skip out", Some(1)),
                ("Tile the walls", Some(4)),
                ("Grout", None),
                ("Clean up", None),
            ]),
            "{which}: only a range with no duration; no range, no number"
        );
        assert_eq!(
            (
                plan.activities[0].duration_min_days,
                plan.activities[0].duration_max_days
            ),
            (Some(1), Some(3)),
            "the range stays"
        );
        work_close_with(&open);
    }

    let (_db, open, _scratch) = host_with_a_work();
    apply(&open, bathroom()).unwrap();
    let plan = ranges_take_with(&open, "high").unwrap();
    assert_eq!(plan.activities[2].duration_days, Some(5), "the upper end");
    assert_eq!(
        ranges_take_with(&open, "middle").unwrap_err().to_string(),
        WHICH_END
    );
    work_close_with(&open);
}

#[test]
fn taking_the_ranges_leaves_a_closed_stage_alone() {
    let (_db, open, _scratch) = host_with_a_work();
    let plan = apply(&open, bathroom()).unwrap();
    let strip = plan.stages[0].id.clone();
    let tiling = plan.stages[1].id.clone();
    // Answer strip-out's start check, start it and close it.
    let check = plan.checks[0].id.clone();
    crate::commands::checks::check_answer_with(
        &open,
        &crate::commands::checks::AnswerDraft {
            check_id: &check,
            answer: "yes",
            reason: None,
            photo_path: None,
            photo_hash: None,
        },
        "A. Engineer (synthetic)",
    )
    .unwrap();
    stage_start_with(&open, &strip).unwrap();
    stage_close_with(&open, &strip).unwrap();

    let plan = ranges_take_with(&open, "high").unwrap();

    assert_eq!(
        plan.activities[0].duration_days, None,
        "a closed stage is read-only"
    );
    assert_eq!(plan.activities[2].stage_id, tiling);
    assert_eq!(plan.activities[2].duration_days, Some(5));
    work_close_with(&open);
}

fn approve(open: &OpenWork) -> Result<WorkSnapshot> {
    let rows: Vec<BaselineRowDraft> = work_get_with(open)
        .unwrap()
        .activities
        .iter()
        .map(|a| from(json!({ "activityId": a.id })))
        .collect();
    baseline_take_with(open, &rows, None)
}

/// "Use the upper end of each range" is a change to the durations: locked once
/// the plan is approved, like any duration edit, and free again while a
/// replanning is open. With nothing to take, it changes nothing and is not
/// refused.
#[test]
fn taking_the_ranges_is_locked_after_approval_unless_replanning() {
    let (_db, open, _scratch) = host_with_a_work();
    apply(&open, bathroom()).unwrap();
    approve(&open).unwrap();
    let before = plan_rows(&work_get_with(&open).unwrap());

    let error = ranges_take_with(&open, "high").unwrap_err();

    assert_eq!(error.kind(), "plan_approved");
    assert_eq!(error.to_string(), PLAN_APPROVED);
    assert_eq!(plan_rows(&work_get_with(&open).unwrap()), before);

    replan_open_with(&open, "Tiles take longer", "A. Engineer (synthetic)").unwrap();
    let plan = ranges_take_with(&open, "high").unwrap();
    assert_eq!(plan.activities[0].duration_days, Some(3));
    approve(&open).expect("baseline 2 closes the replanning");
    ranges_take_with(&open, "low").expect("nothing left to take: not a change, not refused");
    work_close_with(&open);
}

/// A cost line not priced yet: added with no amount, priced, unpriced again,
/// summed as nothing by a baseline — and never mistaken for 0.
#[test]
fn a_cost_line_not_priced_yet_is_accepted_and_summed_as_nothing() {
    let (_db, open, _scratch) = host_with_a_work();
    let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
        .id
        .clone();
    let plan = activity_add_with(&open, &stage, "Tiling").unwrap();
    let tiling = plan.activities[0].id.clone();

    let plan = cost_line_add_with(&open, &stage, Some(&tiling), "Tiles", None).unwrap();
    let tiles = plan.cost_lines[0].id.clone();
    assert_eq!(plan.cost_lines[0].amount_cents, None);
    let plan = cost_line_add_with(&open, &stage, None, "Labour", Some(30_000.0)).unwrap();
    assert_eq!(
        serde_json::to_value(&plan.cost_lines).unwrap()[0]["amountCents"],
        Value::Null
    );

    let plan =
        cost_line_update_with(&open, &tiles, &from(json!({ "amountCents": 120_000 }))).unwrap();
    assert_eq!(plan.cost_lines[0].amount_cents, Some(120_000));
    let plan =
        cost_line_update_with(&open, &tiles, &from(json!({ "label": "Wall tiles" }))).unwrap();
    assert_eq!(
        (
            plan.cost_lines[0].label.as_str(),
            plan.cost_lines[0].amount_cents
        ),
        ("Wall tiles", Some(120_000)),
        "a field left out is left alone"
    );
    let plan = cost_line_update_with(&open, &tiles, &from(json!({ "amountCents": null }))).unwrap();
    assert_eq!(
        plan.cost_lines[0].amount_cents, None,
        "the price taken away"
    );

    let plan = approve(&open).unwrap();
    let baseline = &plan.baselines[0];
    assert_eq!(baseline.planned_cents, Some(30_000), "only the priced line");
    assert_eq!(baseline.stages[0].planned_cents, Some(30_000));
    assert_eq!(
        baseline.rows[0].planned_cents,
        Some(0),
        "an unpriced line is not money"
    );

    // Unpricing a line that is not priced changes nothing: not refused after
    // approval. Pricing it is a change: refused.
    cost_line_update_with(&open, &tiles, &from(json!({ "amountCents": null }))).expect("no change");
    assert_eq!(
        cost_line_update_with(&open, &tiles, &from(json!({ "amountCents": 1 })))
            .unwrap_err()
            .kind(),
        "plan_approved"
    );
    work_close_with(&open);
}

/// The draft is read as the domain writes it (`src/domain/templates/format.ts`):
/// camelCase, `null` for what is not there, and a list left out is empty.
#[test]
fn a_plan_draft_and_a_cost_line_patch_are_read_as_the_interface_writes_them() {
    let draft: PlanDraft = from(json!({
        "stages": [ { "key": "s", "name": "S",
            "activities": [ { "key": "a", "name": "A", "durationDays": null,
                              "durationMinDays": 2, "durationMaxDays": 4, "rooms": [] } ],
            "costLines": [ { "label": "L", "activityKey": "a", "amountCents": null } ],
            "decisions": [ { "name": "D", "leadTimeDays": 5, "leadMinDays": 1, "leadMaxDays": 5,
                             "needsKey": null } ] } ]
    }));
    assert!(draft.rooms.is_empty() && draft.links.is_empty());
    let stage = &draft.stages[0];
    assert!(stage.checks.is_empty());
    assert_eq!(stage.activities[0].duration_min_days, Some(2.0));
    assert_eq!(stage.cost_lines[0].activity_key.as_deref(), Some("a"));
    assert_eq!(stage.decisions[0].lead_max_days, Some(5.0));

    let patch: crate::contract::CostLinePatch = from(json!({}));
    assert_eq!(patch.amount_cents, None, "left out: unchanged");
    let patch: crate::contract::CostLinePatch = from(json!({ "amountCents": null }));
    assert_eq!(patch.amount_cents, Some(None), "null: not priced yet");
    let patch: crate::contract::CostLinePatch = from(json!({ "amountCents": 5 }));
    assert_eq!(patch.amount_cents, Some(Some(5.0)));

    let start: PlanStart = from(json!({
        "draft": { "stages": [] },
        "provenance": { "templateId": "t", "templateVersion": 2, "templateTitle": "T" }
    }));
    assert_eq!(start.provenance.template_version, 2.0);
}

/// D3: a draft's check may need its photo; left out, it does not.
#[test]
fn a_draft_check_that_needs_its_photo_is_written_needing_it() {
    let (_db, open, _scratch) = host_with_a_work();
    let plan = apply(
        &open,
        json!({
            "stages": [{
                "key": "plumbing", "name": "Plumbing",
                "checks": [
                    { "gate": "start", "name": "Is the water off?" },
                    { "gate": "close",
                      "name": "Are the pipes and wiring photographed before the wall is closed?",
                      "needsPhoto": true },
                    { "gate": "close", "name": "Was it pressure-tested?", "needsPhoto": false }
                ]
            }]
        }),
    )
    .unwrap();
    let flags: Vec<(&str, bool)> = plan
        .checks
        .iter()
        .map(|c| (c.gate.as_str(), c.needs_photo))
        .collect();
    assert_eq!(
        flags,
        vec![("start", false), ("close", true), ("close", false)]
    );
    assert_eq!(
        serde_json::to_value(&plan.checks[1]).unwrap()["needsPhoto"],
        true
    );
    work_close_with(&open);
}
