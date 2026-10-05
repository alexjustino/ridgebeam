//! The commands for after the handover (G4) as the interface calls them: the
//! wire in camelCase with `null` never absent, every refusal a sentence,
//! nothing written on any of them, a closed stage that still takes a warranty
//! and a task, and the calendar file written whole by the path rules every
//! saved file follows. Every name is synthetic.

use chrono::NaiveDate;
use serde_json::json;

use crate::commands::aftercare::*;
use crate::commands::checks::{
    check_add_with, check_answer_with, stage_close_with, stage_start_with, AnswerDraft,
};
use crate::commands::documents::document_add_with;
use crate::commands::documents::tests::minimal_pdf;
use crate::commands::plan::{stage_add_with, stage_remove_with};
use crate::commands::rooms::{room_add_with, room_remove_with};
use crate::commands::work::tests::{host, host_with_a_work};
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{MaintenanceDoneDraft, MaintenanceDraft, WarrantyDraft};
use crate::db::maintenance::{
    MAINTENANCE_NOT_FOUND, MAINTENANCE_ON_RECORD, ROOM_HAS_MAINTENANCE_DONE,
    STAGE_HAS_MAINTENANCE_DONE,
};
use crate::db::testing::Scratch;
use crate::db::warranties::{WARRANTY_DOCUMENT_KIND, WARRANTY_TARGET_KIND};
use crate::error::Error;
use crate::folder::OpenWork;

const AUTHOR: &str = "A. Owner (synthetic)";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

fn warranty(value: serde_json::Value) -> WarrantyDraft {
    serde_json::from_value(value).unwrap()
}

fn task(value: serde_json::Value) -> MaintenanceDraft {
    serde_json::from_value(value).unwrap()
}

fn record(value: serde_json::Value) -> MaintenanceDoneDraft {
    serde_json::from_value(value).unwrap()
}

/// A stage Bathroom, closed — its one check answered — and a room Bathroom.
struct Finished {
    stage: String,
    room: String,
}

fn finished(open: &OpenWork) -> Finished {
    let stage = stage_add_with(open, "Bathroom").unwrap().stages[0]
        .id
        .clone();
    let room = room_add_with(open, "Bathroom").unwrap().rooms[0].id.clone();
    let check = check_add_with(open, &stage, "close", "Inspected")
        .unwrap()
        .checks[0]
        .id
        .clone();
    stage_start_with(open, &stage).unwrap();
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
    stage_close_with(open, &stage).unwrap();
    Finished { stage, room }
}

/// The e2e's shape in the host: a closed stage takes a warranty for its
/// shower valve and a task to reseal the shower; the task is marked done
/// today; the wire as the interface reads it.
#[test]
fn a_warranty_and_a_task_are_added_and_done_on_a_closed_stage_and_cross_the_wire_in_camel_case() {
    let (_db, open, _scratch) = host_with_a_work();
    let f = finished(&open);

    let plan = warranty_add_with(
        &open,
        &warranty(json!({
            "targetKind": "stage", "targetId": f.stage, "title": "  Shower valve ",
            "givenBy": "The plumber", "startsOn": "2024-11-09", "months": 24,
            "note": "Register within 30 days.\nKeep the box."
        })),
    )
    .expect("a closed stage takes a warranty");
    let valve = plan.warranties[0].id.clone();
    let plan = warranty_add_with(
        &open,
        &warranty(json!({
            "targetKind": "work", "targetId": plan.work.work_id, "title": "The whole work",
            "startsOn": "2026-10-09", "months": 60
        })),
    )
    .unwrap();
    let whole = plan.warranties[0].id.clone();
    let wire = serde_json::to_value(&plan).unwrap();
    let created = |at: usize| wire["warranties"][at]["createdAt"].clone();
    assert!(created(0).is_string() && created(1).is_string());
    assert_eq!(
        wire["warranties"][1],
        json!({
            "id": valve, "position": 1, "targetKind": "stage", "targetId": f.stage,
            "title": "Shower valve", "givenBy": "The plumber", "startsOn": "2024-11-09",
            "months": 24, "documentId": null, "note": "Register within 30 days.\nKeep the box.",
            "createdAt": created(1)
        })
    );
    assert_eq!(
        wire["warranties"][0],
        json!({
            "id": whole, "position": 1, "targetKind": "work", "targetId": plan.work.work_id,
            "title": "The whole work", "givenBy": null, "startsOn": "2026-10-09", "months": 60,
            "documentId": null, "note": null, "createdAt": created(0)
        }),
        "null, never absent"
    );

    let plan = maintenance_add_with(
        &open,
        &task(json!({
            "targetKind": "room", "targetId": f.room, "title": "Reseal the shower",
            "everyMonths": 12, "firstDueOn": "2025-09-09"
        })),
    )
    .unwrap();
    let reseal = plan.maintenance[0].id.clone();
    let wire = serde_json::to_value(&plan).unwrap();
    assert_eq!(
        wire["maintenance"][0],
        json!({
            "id": reseal, "position": 1, "targetKind": "room", "targetId": f.room,
            "title": "Reseal the shower", "everyMonths": 12, "firstDueOn": "2025-09-09",
            "note": null, "createdAt": wire["maintenance"][0]["createdAt"], "done": []
        })
    );

    let plan = maintenance_done_add_with(
        &open,
        &record(json!({ "taskId": reseal, "doneOn": "2026-10-09", "note": " Silicone. " })),
        today(),
        AUTHOR,
    )
    .expect("done today");
    maintenance_done_add_with(
        &open,
        &record(json!({ "taskId": reseal, "doneOn": "2026-10-09" })),
        today(),
        AUTHOR,
    )
    .expect("the same day again");
    let wire = serde_json::to_value(&plan).unwrap();
    assert_eq!(
        wire["maintenance"][0]["done"],
        json!([{
            "taskId": reseal, "seq": 1, "doneOn": "2026-10-09", "note": "Silicone.",
            "authorName": AUTHOR,
            "createdAt": wire["maintenance"][0]["done"][0]["createdAt"]
        }])
    );
    let plan = work_get_with(&open).unwrap();
    assert_eq!(
        plan.maintenance[0]
            .done
            .iter()
            .map(|d| (d.seq, d.note.clone()))
            .collect::<Vec<_>>(),
        vec![(1, Some("Silicone.".into())), (2, None)]
    );
    work_close_with(&open);
}

/// Every value past a limit, and every draft that names nothing, refused with
/// its sentence; nothing written on any of them.
#[test]
fn every_value_that_does_not_fit_is_refused_with_a_sentence_and_nothing_is_written() {
    let (_db, open, _scratch) = host_with_a_work();
    let f = finished(&open);
    let ok_warranty = json!({
        "targetKind": "room", "targetId": f.room, "title": "Tiles", "startsOn": "2026-10-09",
        "months": 24
    });
    let ok_task = json!({
        "targetKind": "room", "targetId": f.room, "title": "Reseal", "everyMonths": 12,
        "firstDueOn": "2027-10-09"
    });
    let with = |base: &serde_json::Value, field: &str, value: serde_json::Value| {
        let mut changed = base.clone();
        changed[field] = value;
        changed
    };
    let plan = maintenance_add_with(&open, &task(ok_task.clone())).unwrap();
    let reseal = plan.maintenance[0].id.clone();
    maintenance_done_add_with(
        &open,
        &record(json!({ "taskId": reseal, "doneOn": "2026-10-01" })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let before = work_get_with(&open).unwrap();

    let long = |n: usize| json!("x".repeat(n));
    let warranty_cases = [
        (
            with(&ok_warranty, "title", json!("   ")),
            WARRANTY_TITLE_NEEDED.to_string(),
        ),
        (
            with(&ok_warranty, "title", long(201)),
            "A warranty's title is at most 200 characters.".into(),
        ),
        (
            with(&ok_warranty, "title", json!("Two\nlines")),
            "A warranty's title is one line, with no control character.".into(),
        ),
        (
            with(&ok_warranty, "givenBy", long(121)),
            "Who gives a warranty is at most 120 characters.".into(),
        ),
        (
            with(&ok_warranty, "note", long(1001)),
            "A warranty's note is at most 1000 characters.".into(),
        ),
        (
            with(&ok_warranty, "note", json!("a\u{7}b")),
            "A warranty's note holds a control character that cannot be kept.".into(),
        ),
        (
            with(&ok_warranty, "startsOn", json!("2026-02-30")),
            "The day a warranty starts is a date written YYYY-MM-DD, on a day that exists.".into(),
        ),
        (
            with(&ok_warranty, "startsOn", json!("2026-2-3")),
            "The day a warranty starts is a date written YYYY-MM-DD, on a day that exists.".into(),
        ),
        (
            with(&ok_warranty, "months", json!(0)),
            WARRANTY_MONTHS.into(),
        ),
        (
            with(&ok_warranty, "months", json!(601)),
            WARRANTY_MONTHS.into(),
        ),
        (
            with(&ok_warranty, "months", json!(1.5)),
            WARRANTY_MONTHS.into(),
        ),
        (
            with(&ok_warranty, "months", json!(-12)),
            WARRANTY_MONTHS.into(),
        ),
        (
            with(&ok_warranty, "targetKind", json!("activity")),
            WARRANTY_TARGET_KIND.into(),
        ),
    ];
    for (draft, sentence) in warranty_cases {
        let refused = warranty_add_with(&open, &warranty(draft.clone())).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    let refused = warranty_update_with(&open, &warranty(ok_warranty.clone())).unwrap_err();
    assert_eq!(refused.to_string(), WARRANTY_ID_NEEDED);

    let task_cases = [
        (
            with(&ok_task, "title", json!("")),
            TASK_TITLE_NEEDED.to_string(),
        ),
        (
            with(&ok_task, "title", long(201)),
            "A maintenance task's title is at most 200 characters.".into(),
        ),
        (
            with(&ok_task, "note", long(1001)),
            "A maintenance task's note is at most 1000 characters.".into(),
        ),
        (with(&ok_task, "everyMonths", json!(0)), EVERY_MONTHS.into()),
        (
            with(&ok_task, "everyMonths", json!(121)),
            EVERY_MONTHS.into(),
        ),
        (
            with(&ok_task, "everyMonths", json!(6.5)),
            EVERY_MONTHS.into(),
        ),
        (
            with(&ok_task, "firstDueOn", json!("someday")),
            "The day a task is first due is a date written YYYY-MM-DD, on a day that exists."
                .into(),
        ),
    ];
    for (draft, sentence) in task_cases {
        let refused = maintenance_add_with(&open, &task(draft.clone())).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    let refused = maintenance_update_with(&open, &task(ok_task.clone())).unwrap_err();
    assert_eq!(refused.to_string(), TASK_ID_NEEDED);

    for (draft, sentence) in [
        (
            json!({ "taskId": reseal, "doneOn": "2026-10-10" }),
            "2026-10-10 has not happened yet: a task is recorded as done on a day that has."
                .to_string(),
        ),
        (
            json!({ "taskId": reseal, "doneOn": "2026-09-30" }),
            "“Reseal” was last done on 2026-10-01: the next time is on that day or later.".into(),
        ),
        (
            json!({ "taskId": reseal, "doneOn": "9 October" }),
            "The day a task was done is a date written YYYY-MM-DD, on a day that exists.".into(),
        ),
        (
            json!({ "taskId": reseal, "doneOn": "2026-10-09", "note": "x".repeat(501) }),
            "A note on the time it was done is at most 500 characters.".into(),
        ),
        (
            json!({ "taskId": "  ", "doneOn": "2026-10-09" }),
            DONE_TASK_NEEDED.into(),
        ),
        (
            json!({ "taskId": "nobody", "doneOn": "2026-10-09" }),
            MAINTENANCE_NOT_FOUND.into(),
        ),
    ] {
        let refused =
            maintenance_done_add_with(&open, &record(draft.clone()), today(), AUTHOR).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    for (refused, sentence) in [
        (
            maintenance_remove_with(&open, &reseal),
            MAINTENANCE_ON_RECORD,
        ),
        (room_remove_with(&open, &f.room), ROOM_HAS_MAINTENANCE_DONE),
        (
            maintenance_move_with(&open, &reseal, "sideways"),
            "A move is up or down.",
        ),
        (
            warranty_move_with(&open, &reseal, "up"),
            "That warranty is not in this work.",
        ),
    ] {
        let refused = refused.unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
    assert_eq!(work_get_with(&open).unwrap(), before, "nothing written");

    warranty_add_with(&open, &warranty(with(&ok_warranty, "months", json!(600))))
        .expect("fifty years");
    warranty_add_with(
        &open,
        &warranty(with(&ok_warranty, "title", json!("é".repeat(200)))),
    )
    .expect("200 characters, not bytes");
    maintenance_add_with(&open, &task(with(&ok_task, "everyMonths", json!(120))))
        .expect("ten years");
    work_close_with(&open);
}

/// The paper of a warranty is a document of the work filed as a warranty.
#[test]
fn a_warranty_names_its_paper_only_when_it_is_filed_as_a_warranty() {
    let (_db, open, _scratch) = host_with_a_work();
    let f = finished(&open);
    let source = Scratch::create();
    let put = |name: &str, extra: &[u8]| {
        let path = source.path().join(name);
        let mut bytes = minimal_pdf();
        bytes.extend_from_slice(extra);
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    };
    let paper = document_add_with(
        &open,
        &[put("valve-warranty.pdf", b"% valve\n")],
        "warranty",
        None,
        today(),
        AUTHOR,
    )
    .unwrap()
    .snapshot
    .documents[0]
        .id
        .clone();
    let plan = document_add_with(
        &open,
        &[put("valve-receipt.pdf", b"% receipt\n")],
        "receipt",
        None,
        today(),
        AUTHOR,
    )
    .unwrap()
    .snapshot;
    let receipt = plan
        .documents
        .iter()
        .find(|d| d.kind == "receipt")
        .unwrap()
        .id
        .clone();

    let draft = |document: &str| {
        warranty(json!({
            "targetKind": "stage", "targetId": f.stage, "title": "Shower valve",
            "startsOn": "2024-11-09", "months": 24, "documentId": document
        }))
    };
    let refused = warranty_add_with(&open, &draft(&receipt)).unwrap_err();
    assert_eq!(refused.to_string(), WARRANTY_DOCUMENT_KIND);
    let refused = warranty_add_with(&open, &draft("nobody")).unwrap_err();
    assert_eq!(refused.to_string(), "That document is not in this work.");
    let plan = warranty_add_with(&open, &draft(&paper)).unwrap();
    assert_eq!(
        plan.warranties[0].document_id.as_deref(),
        Some(paper.as_str())
    );

    let mut cleared = draft(&paper);
    cleared.id = Some(plan.warranties[0].id.clone());
    cleared.document_id = Some("  ".into());
    let plan = warranty_update_with(&open, &cleared).unwrap();
    assert_eq!(plan.warranties[0].document_id, None, "empty is none");
    work_close_with(&open);
}

/// A room or a stage removed takes its warranties and tasks never done; one
/// with a task done is kept, with the sentence.
#[test]
fn a_removed_room_or_stage_takes_its_warranties_and_tasks_unless_a_task_was_done() {
    let (_db, open, _scratch) = host_with_a_work();
    let roof = stage_add_with(&open, "Roof").unwrap().stages[0].id.clone();
    let hall = stage_add_with(&open, "Hall").unwrap().stages[1].id.clone();
    let kitchen = room_add_with(&open, "Kitchen").unwrap().rooms[0].id.clone();
    for (kind, target, title) in [
        ("stage", &roof, "Roof membrane"),
        ("stage", &hall, "Front door"),
        ("room", &kitchen, "Oven"),
    ] {
        warranty_add_with(
            &open,
            &warranty(json!({
                "targetKind": kind, "targetId": target, "title": title,
                "startsOn": "2026-10-09", "months": 12
            })),
        )
        .unwrap();
        maintenance_add_with(
            &open,
            &task(json!({
                "targetKind": kind, "targetId": target, "title": format!("Look after: {title}"),
                "everyMonths": 6, "firstDueOn": "2027-04-09"
            })),
        )
        .unwrap();
    }
    let gutters = work_get_with(&open).unwrap().maintenance[1].id.clone();
    maintenance_done_add_with(
        &open,
        &record(json!({ "taskId": gutters, "doneOn": "2026-10-09" })),
        today(),
        AUTHOR,
    )
    .unwrap();

    let refused = stage_remove_with(&open, &roof).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), STAGE_HAS_MAINTENANCE_DONE);
    let plan = room_remove_with(&open, &kitchen).unwrap();
    assert_eq!(plan.warranties.len(), 2);
    let plan = stage_remove_with(&open, &hall).unwrap();
    let titles = |plan: &crate::contract::WorkSnapshot| -> (Vec<String>, Vec<String>) {
        (
            plan.warranties.iter().map(|w| w.title.clone()).collect(),
            plan.maintenance.iter().map(|t| t.title.clone()).collect(),
        )
    };
    assert_eq!(
        titles(&plan),
        (
            vec!["Roof membrane".to_string()],
            vec!["Look after: Roof membrane".to_string()]
        )
    );
    work_close_with(&open);
}

#[test]
fn moves_keep_each_target_one_to_n() {
    let (_db, open, _scratch) = host_with_a_work();
    let room = room_add_with(&open, "Bathroom").unwrap().rooms[0]
        .id
        .clone();
    for title in ["Tiles", "Grout", "Mirror"] {
        warranty_add_with(
            &open,
            &warranty(json!({
                "targetKind": "room", "targetId": room, "title": title,
                "startsOn": "2026-10-09", "months": 12
            })),
        )
        .unwrap();
        maintenance_add_with(
            &open,
            &task(json!({
                "targetKind": "room", "targetId": room, "title": title,
                "everyMonths": 12, "firstDueOn": "2027-10-09"
            })),
        )
        .unwrap();
    }
    let plan = work_get_with(&open).unwrap();
    let mirror = plan.warranties[2].id.clone();
    let grout = plan.maintenance[1].id.clone();
    warranty_move_with(&open, &mirror, "up").unwrap();
    let plan = maintenance_move_with(&open, &grout, "down").unwrap();
    let order = |titles: Vec<(i64, String)>| titles;
    assert_eq!(
        order(
            plan.warranties
                .iter()
                .map(|w| (w.position, w.title.clone()))
                .collect()
        ),
        vec![
            (1, "Tiles".into()),
            (2, "Mirror".into()),
            (3, "Grout".into())
        ]
    );
    assert_eq!(
        plan.maintenance
            .iter()
            .map(|t| (t.position, t.title.clone()))
            .collect::<Vec<_>>(),
        vec![
            (1, "Tiles".into()),
            (2, "Mirror".into()),
            (3, "Grout".into())
        ]
    );
    let plan = warranty_remove_with(&open, &mirror).unwrap();
    assert_eq!(
        plan.warranties
            .iter()
            .map(|w| w.position)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    let plan = maintenance_remove_with(&open, &grout).unwrap();
    assert_eq!(plan.maintenance.len(), 2);
    work_close_with(&open);
}

/// The calendar file: written whole, as the domain's text, by the rules every
/// saved file follows — and no work needs to be open.
#[test]
fn the_calendar_file_is_written_whole_by_the_path_rules_of_every_saved_file() {
    let (_db, open) = host();
    assert!(work_get_with(&open).is_err(), "no work open");
    let scratch = Scratch::create();
    let at = |name: &str| scratch.path().join(name).to_string_lossy().into_owned();
    let text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Ridgebeam//Aftercare//EN\r\n\
                BEGIN:VEVENT\r\nUID:x@ridgebeam\r\nSUMMARY:Válvula do chuveiro\r\nEND:VEVENT\r\n\
                END:VCALENDAR\r\n";

    let written = aftercare_ics_write_with(&at("aftercare.ics"), text, false).unwrap();
    assert_eq!(written.path, at("aftercare.ics"));
    assert_eq!(written.bytes, text.len() as u64);
    assert_eq!(
        serde_json::to_value(&written).unwrap(),
        json!({ "path": at("aftercare.ics"), "bytes": text.len() }),
        "no pages"
    );
    assert_eq!(
        std::fs::read(at("aftercare.ics")).unwrap(),
        text.as_bytes(),
        "UTF-8, CRLF kept, no mark added"
    );
    aftercare_ics_write_with(&at("CALENDAR.ICS"), text, false).expect("any case of .ics");

    let cap = MAX_ICS_BYTES as usize;
    aftercare_ics_write_with(&at("exactly.ics"), &"x".repeat(cap), false)
        .expect("1 MiB is inside the cap");
    std::fs::create_dir(scratch.path().join("folder.ics")).unwrap();
    let refusals = [
        (
            "aftercare.ics".to_string(),
            ICS_FULL_PATH.to_string(),
            "x".to_string(),
            false,
        ),
        (
            at("aftercare.txt"),
            "“aftercare.txt” was not saved: a calendar file is a .ics file.".into(),
            "x".into(),
            false,
        ),
        (
            at("aftercare.ics.exe"),
            "“aftercare.ics.exe” was not saved: a calendar file is a .ics file.".into(),
            "x".into(),
            false,
        ),
        (
            at("large.ics"),
            "“large.ics” was not saved: it would be larger than 1 MiB.".into(),
            "x".repeat(cap + 1),
            false,
        ),
        (
            scratch
                .path()
                .join("missing")
                .join("aftercare.ics")
                .to_string_lossy()
                .into_owned(),
            "“aftercare.ics” was not saved: the folder it would go in is not there.".into(),
            "x".into(),
            false,
        ),
        (
            at("folder.ics"),
            "“folder.ics” was not saved: a folder of that name is already there.".into(),
            "x".into(),
            true,
        ),
        (
            at("aftercare.ics"),
            "“aftercare.ics” was not saved: a file of that name is already there; choose it in the save dialog to replace it.".into(),
            "replaced?".into(),
            false,
        ),
    ];
    for (path, sentence, text, overwrite) in refusals {
        let refused = aftercare_ics_write_with(&path, &text, overwrite).unwrap_err();
        assert!(matches!(refused, Error::InvalidInput(_)), "{path}");
        assert_eq!(refused.to_string(), sentence, "{path}");
    }
    assert!(
        !scratch.path().join("large.ics").exists(),
        "nothing half-written"
    );
    assert_eq!(
        std::fs::read(at("aftercare.ics")).unwrap(),
        text.as_bytes(),
        "kept as it was"
    );

    let again = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    aftercare_ics_write_with(&at("aftercare.ics"), again, true)
        .expect("replaced when the save dialog chose it");
    assert_eq!(
        std::fs::read(at("aftercare.ics")).unwrap(),
        again.as_bytes()
    );
    let mut names: Vec<String> = std::fs::read_dir(scratch.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec!["CALENDAR.ICS", "aftercare.ics", "exactly.ics", "folder.ics"],
        "no temporary file left behind"
    );
}
