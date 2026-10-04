//! Snags walked through the commands the interface calls (slice E4).
//!
//! A snag is raised on record — where, who must fix it, by when, a photo of
//! it — on a stage already closed as readily as on one still open. It is
//! closed once: fixed with a photo of it fixed, or withdrawn with a reason.
//! A photo is the hash of an image document of the work. Every refusal is a
//! sentence, and changes nothing. The payment plan's last part may be held
//! back as retention.

use chrono::NaiveDate;
use serde_json::json;

use crate::commands::checks::{stage_close_with, stage_start_with};
use crate::commands::documents::document_add_with;
use crate::commands::documents::tests::minimal_pdf;
use crate::commands::milestones::milestone_add_with;
use crate::commands::money::{commitment_add_with, CommitmentDraft};
use crate::commands::plan::{
    activity_add_with, person_add_with, person_remove_with, stage_add_with,
};
use crate::commands::snags::{
    due_before_raised, snag_close_with, snag_raise_with, OUTCOME_UNKNOWN, TITLE_NEEDED,
};
use crate::commands::work::tests::{host, host_with_a_work};
use crate::commands::work::{with_work, work_close_with, work_get_with};
use crate::contract::{SnagClosureDraft, SnagDraft, WorkSnapshot};
use crate::db::money::ACTIVITY_OF_ANOTHER_STAGE;
use crate::db::snags::{
    already_closed, closed_before_raised, FIXED_NEEDS_PHOTO, PHOTO_NOT_AN_IMAGE, SNAG_NOT_FOUND,
    WITHDRAWN_NEEDS_NOTE,
};
use crate::db::testing::Scratch;
use crate::db::work::{ACTIVITY_NOT_FOUND, PERSON_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::Db;
use crate::error::Result;
use crate::files::intake::{self, tests::jpeg, tests::png, NOT_A_PHOTO};
use crate::folder::OpenWork;
use crate::validate::TRIGGER_UNKNOWN;

const AUTHOR: &str = "A. Engineer (synthetic)";
const OWNER: &str = "An owner (synthetic)";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

/// The e2e's work: a stage Tiling with "Lay the tiles", a stage Painting with
/// "Paint the walls", a tiler, and three documents of the work — the crack,
/// the crack fixed, and a permit (a PDF). Synthetic.
struct Work {
    _db: Db,
    open: OpenWork,
    _scratch: Scratch,
    _source: Scratch,
    tiling: String,
    painting: String,
    lay: String,
    paint: String,
    tiler: String,
    crack: String,
    mended: String,
    corner: String,
    permit: String,
}

fn work() -> Work {
    let (db, open, scratch) = host_with_a_work();
    stage_add_with(&open, "Tiling").unwrap();
    let plan = stage_add_with(&open, "Painting").unwrap();
    let (tiling, painting) = (plan.stages[0].id.clone(), plan.stages[1].id.clone());
    activity_add_with(&open, &tiling, "Lay the tiles").unwrap();
    let plan = activity_add_with(&open, &painting, "Paint the walls").unwrap();
    let (lay, paint) = (plan.activities[0].id.clone(), plan.activities[1].id.clone());
    let tiler = person_add_with(&open, "A. Tiler").unwrap().people[0]
        .id
        .clone();

    let source = Scratch::create();
    let put = |name: &str, bytes: &[u8]| -> String {
        let path = source.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    };
    let files = [
        ("crack.jpg", jpeg(64, 48)),
        ("mended.png", png(40, 30)),
        ("corner.jpg", jpeg(32, 24)),
        ("permit.pdf", minimal_pdf()),
    ];
    let paths: Vec<String> = files.iter().map(|(name, bytes)| put(name, bytes)).collect();
    document_add_with(&open, &paths, "photo", None, today(), AUTHOR).unwrap();
    let [crack, mended, corner, permit] = files.map(|(_, bytes)| intake::sha256_hex(&bytes));
    Work {
        _db: db,
        open,
        _scratch: scratch,
        _source: source,
        tiling,
        painting,
        lay,
        paint,
        tiler,
        crack,
        mended,
        corner,
        permit,
    }
}

fn from<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("a shape the interface could send")
}

fn raise(open: &OpenWork, draft: serde_json::Value) -> Result<WorkSnapshot> {
    let draft: SnagDraft = from(draft);
    snag_raise_with(open, &draft, today(), OWNER)
}

fn close(open: &OpenWork, closure: serde_json::Value) -> Result<WorkSnapshot> {
    let closure: SnagClosureDraft = from(closure);
    snag_close_with(open, &closure, today(), AUTHOR)
}

/// The snag of the e2e: a cracked tile by the drain, on the tiler, due in two
/// days, with its photo.
fn cracked_tile(w: &Work) -> serde_json::Value {
    json!({
        "raisedOn": "2026-10-06",
        "title": "Cracked tile by the drain",
        "description": "The second row from the wall.",
        "stageId": w.tiling,
        "activityId": w.lay,
        "personId": w.tiler,
        "dueOn": "2026-10-08",
        "photoHash": w.crack
    })
}

/// The e2e in the host: a closed stage, a payment plan whose last part is
/// retention, two snags on the tiler; one fixed with its photo; the other
/// refused a fix with no photo, then withdrawn with its reason.
#[test]
fn snags_are_raised_on_a_closed_stage_fixed_with_a_photo_and_withdrawn_with_a_reason() {
    let w = work();
    let quote = commitment_add_with(
        &w.open,
        &w.tiling,
        &CommitmentDraft {
            person_id: Some(&w.tiler),
            label: "Tiler's quote",
            amount_cents: 1_000_000.0,
            agreed_on: "2026-10-01",
            document_path: None,
            document_hash: None,
        },
    )
    .unwrap()
    .commitments[0]
        .id
        .clone();
    for (label, share, trigger, activity) in [
        ("Start", 3_000.0, "stage_started", None),
        (
            "Tiles laid",
            4_000.0,
            "activity_finished",
            Some(w.lay.as_str()),
        ),
        ("Closed", 2_500.0, "stage_closed", None),
        ("Retention", 500.0, "retention", None),
    ] {
        milestone_add_with(&w.open, &quote, label, share, trigger, activity).unwrap();
    }
    stage_start_with(&w.open, &w.tiling).unwrap();
    stage_close_with(&w.open, &w.tiling).unwrap();

    let plan = raise(&w.open, cracked_tile(&w)).expect("a closed stage takes a snag");
    let plan_wire = serde_json::to_value(&plan.commitments[0].milestones[3]).unwrap();
    assert_eq!(
        plan_wire,
        json!({
            "id": plan.commitments[0].milestones[3].id, "position": 4, "label": "Retention",
            "shareBp": 500, "trigger": "retention", "activityId": null
        })
    );
    let wire = serde_json::to_value(&plan).unwrap();
    assert_eq!(
        wire["snags"],
        json!([{
            "id": plan.snags[0].id,
            "number": 1,
            "title": "Cracked tile by the drain",
            "description": "The second row from the wall.",
            "stageId": w.tiling,
            "activityId": w.lay,
            "personId": w.tiler,
            "raisedOn": "2026-10-06",
            "dueOn": "2026-10-08",
            "photoHash": w.crack,
            "authorName": OWNER,
            "createdAt": plan.snags[0].created_at,
            "closure": null
        }]),
        "camelCase, and null never absent"
    );

    let plan = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-07", "title": "  Grout missing in the corner  ",
            "stageId": w.tiling, "activityId": "", "personId": w.tiler, "dueOn": "",
            "photoHash": w.corner
        }),
    )
    .unwrap();
    let second = &plan.snags[1];
    assert_eq!(
        (
            second.number,
            second.title.as_str(),
            second.activity_id.as_deref(),
            second.due_on.as_deref(),
            second.description.as_deref()
        ),
        (2, "Grout missing in the corner", None, None, None),
        "trimmed; an empty field is none"
    );
    let (first, second) = (plan.snags[0].id.clone(), second.id.clone());

    let plan = close(
        &w.open,
        json!({
            "snagId": first, "outcome": "fixed", "closedOn": "2026-10-08",
            "photoHash": w.mended, "note": "Replaced the tile."
        }),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&plan.snags[0]).unwrap()["closure"],
        json!({
            "outcome": "fixed", "closedOn": "2026-10-08", "photoHash": w.mended,
            "note": "Replaced the tile.", "authorName": AUTHOR,
            "createdAt": plan.snags[0].closure.as_ref().unwrap().created_at
        })
    );

    let refused = close(
        &w.open,
        json!({ "snagId": second, "outcome": "fixed", "closedOn": "2026-10-08" }),
    )
    .unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), FIXED_NEEDS_PHOTO);
    assert!(work_get_with(&w.open).unwrap().snags[1].closure.is_none());

    let plan = close(
        &w.open,
        json!({
            "snagId": second, "outcome": "withdrawn", "closedOn": "2026-10-09",
            "note": "Grouted the same day; raised by mistake."
        }),
    )
    .unwrap();
    let closure = plan.snags[1].closure.as_ref().unwrap();
    assert_eq!(
        (
            closure.outcome.as_str(),
            closure.photo_hash.as_deref(),
            closure.note.as_deref()
        ),
        (
            "withdrawn",
            None,
            Some("Grouted the same day; raised by mistake.")
        )
    );
    assert_eq!(
        serde_json::to_value(&plan.snags[1]).unwrap()["closure"]["photoHash"],
        json!(null)
    );
    work_close_with(&w.open);
}

#[test]
fn a_snag_that_does_not_fit_is_refused_with_a_sentence_and_nothing_is_written() {
    let w = work();
    let nobody = crate::db::new_id();
    let with = |change: serde_json::Value| {
        let mut draft = cracked_tile(&w);
        for (key, value) in change.as_object().unwrap() {
            draft[key] = value.clone();
        }
        draft
    };
    for (draft, sentence) in [
        (with(json!({ "title": "  " })), TITLE_NEEDED.to_string()),
        (
            with(json!({ "title": "t".repeat(201) })),
            "A snag's title is at most 200 characters.".to_string(),
        ),
        (
            with(json!({ "title": "Two\nlines" })),
            "A snag's title is one line, with no control character.".to_string(),
        ),
        (
            with(json!({ "description": "d".repeat(2001) })),
            "A snag's description is at most 2000 characters.".to_string(),
        ),
        (
            with(json!({ "raisedOn": "2026-10-10" })),
            "2026-10-10 has not happened yet: a snag is raised on a day that has.".to_string(),
        ),
        (
            with(json!({ "raisedOn": "6 Oct" })),
            "A snag's day is a date written YYYY-MM-DD, on a day that exists.".to_string(),
        ),
        (
            with(json!({ "dueOn": "2026-02-30" })),
            "A snag's due day is a date written YYYY-MM-DD, on a day that exists.".to_string(),
        ),
        (
            with(json!({ "dueOn": "2026-10-05" })),
            due_before_raised("2026-10-06"),
        ),
        (
            with(json!({ "photoHash": "../crack.jpg" })),
            NOT_A_PHOTO.to_string(),
        ),
        (
            with(json!({ "photoHash": "ab".repeat(32) })),
            NOT_A_PHOTO.to_string(),
        ),
        (
            with(json!({ "photoHash": w.permit })),
            PHOTO_NOT_AN_IMAGE.to_string(),
        ),
        (
            with(json!({ "stageId": nobody })),
            STAGE_NOT_FOUND.to_string(),
        ),
        (
            with(json!({ "activityId": nobody })),
            ACTIVITY_NOT_FOUND.to_string(),
        ),
        (
            with(json!({ "activityId": w.paint })),
            ACTIVITY_OF_ANOTHER_STAGE.to_string(),
        ),
        (
            with(json!({ "personId": nobody })),
            PERSON_NOT_FOUND.to_string(),
        ),
    ] {
        let refused = raise(&w.open, draft.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    assert!(work_get_with(&w.open).unwrap().snags.is_empty());

    // The photo's document is there, its file is not: refused, as a check's
    // answer is.
    with_work(&w.open, |state| {
        let path = intake::original(&state.folder, &w.crack).unwrap();
        std::fs::remove_file(path).unwrap();
        Ok(())
    })
    .unwrap();
    assert_eq!(
        raise(&w.open, cracked_tile(&w)).unwrap_err().to_string(),
        NOT_A_PHOTO
    );
    let plan = raise(&w.open, with(json!({ "photoHash": null }))).expect("with no photo");
    assert_eq!(plan.snags[0].photo_hash, None);
    work_close_with(&w.open);
}

#[test]
fn a_closure_that_does_not_fit_or_comes_twice_is_refused_with_a_sentence() {
    let w = work();
    let id = raise(&w.open, cracked_tile(&w)).unwrap().snags[0]
        .id
        .clone();
    let fix = |change: serde_json::Value| {
        let mut closure = json!({
            "snagId": id, "outcome": "fixed", "closedOn": "2026-10-08", "photoHash": w.mended
        });
        for (key, value) in change.as_object().unwrap() {
            closure[key] = value.clone();
        }
        closure
    };
    for (closure, sentence) in [
        (
            fix(json!({ "outcome": "done" })),
            OUTCOME_UNKNOWN.to_string(),
        ),
        (
            fix(json!({ "outcome": "Fixed" })),
            OUTCOME_UNKNOWN.to_string(),
        ),
        (
            fix(json!({ "closedOn": "2026-10-10" })),
            "2026-10-10 has not happened yet: a snag is closed on a day that has.".to_string(),
        ),
        (
            fix(json!({ "closedOn": "" })),
            "A snag's closing day is a date written YYYY-MM-DD, on a day that exists.".to_string(),
        ),
        (
            fix(json!({ "closedOn": "2026-10-05" })),
            closed_before_raised(1, "2026-10-06"),
        ),
        (
            fix(json!({ "photoHash": null })),
            FIXED_NEEDS_PHOTO.to_string(),
        ),
        (
            fix(json!({ "photoHash": " " })),
            FIXED_NEEDS_PHOTO.to_string(),
        ),
        (
            fix(json!({ "outcome": "withdrawn", "photoHash": null, "note": "  " })),
            WITHDRAWN_NEEDS_NOTE.to_string(),
        ),
        (
            fix(json!({ "note": "n".repeat(2001) })),
            "A closing note is at most 2000 characters.".to_string(),
        ),
        (
            fix(json!({ "photoHash": w.permit })),
            PHOTO_NOT_AN_IMAGE.to_string(),
        ),
        (
            fix(json!({ "photoHash": "cd".repeat(32) })),
            NOT_A_PHOTO.to_string(),
        ),
        (
            fix(json!({ "snagId": crate::db::new_id() })),
            SNAG_NOT_FOUND.to_string(),
        ),
    ] {
        let refused = close(&w.open, closure.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{closure}");
        assert_eq!(refused.to_string(), sentence, "{closure}");
    }
    assert!(work_get_with(&w.open).unwrap().snags[0].closure.is_none());

    close(&w.open, fix(json!({}))).unwrap();
    for again in [
        fix(json!({ "closedOn": "2026-10-09" })),
        fix(json!({ "outcome": "withdrawn", "note": "Never mind." })),
    ] {
        assert_eq!(
            close(&w.open, again).unwrap_err().to_string(),
            already_closed(1, "fixed", "2026-10-08")
        );
    }
    work_close_with(&w.open);
}

/// A snag names a person, a stage and an activity by id, not by a tie: a
/// person removed from the plan leaves the record as it was.
#[test]
fn a_person_removed_later_leaves_the_snag_as_it_was_and_another_stage_takes_its_own() {
    let w = work();
    raise(&w.open, cracked_tile(&w)).unwrap();
    let plan = raise(
        &w.open,
        json!({
            "raisedOn": "2026-10-06", "title": "Paint drip on the door",
            "stageId": w.painting, "activityId": w.paint
        }),
    )
    .unwrap();
    assert_eq!(
        (
            plan.snags[1].person_id.clone(),
            plan.snags[1].due_on.clone()
        ),
        (None, None),
        "a snag on nobody, due on no day"
    );
    let plan = person_remove_with(&w.open, &w.tiler).unwrap();
    assert!(plan.people.is_empty());
    assert_eq!(
        plan.snags[0].person_id.as_deref(),
        Some(w.tiler.as_str()),
        "the record as it was"
    );
    work_close_with(&w.open);
}

#[test]
fn the_payment_plan_takes_retention_and_still_refuses_a_trigger_that_is_not_one() {
    let w = work();
    let quote = commitment_add_with(
        &w.open,
        &w.tiling,
        &CommitmentDraft {
            person_id: None,
            label: "Tiler's quote",
            amount_cents: 100_000.0,
            agreed_on: "2026-10-01",
            document_path: None,
            document_hash: None,
        },
    )
    .unwrap()
    .commitments[0]
        .id
        .clone();
    for trigger in ["held", "Retention", "retention "] {
        let refused =
            milestone_add_with(&w.open, &quote, "Held", 500.0, trigger, None).unwrap_err();
        assert_eq!(refused.to_string(), TRIGGER_UNKNOWN, "{trigger}");
    }
    assert_eq!(
        milestone_add_with(&w.open, &quote, "Held", 500.0, "retention", Some(&w.lay))
            .unwrap_err()
            .to_string(),
        crate::db::milestones::ACTIVITY_NOT_WANTED
    );
    let plan = milestone_add_with(&w.open, &quote, "Held", 500.0, "retention", None).unwrap();
    assert_eq!(plan.commitments[0].milestones[0].trigger, "retention");
    work_close_with(&w.open);
}

#[test]
fn snag_commands_with_no_work_open_are_no_work_open() {
    let (_db, open) = host();
    let draft = json!({ "raisedOn": "2026-10-06", "title": "X", "stageId": "s" });
    let closure = json!({ "snagId": "s", "outcome": "withdrawn", "closedOn": "2026-10-06",
                          "note": "x" });
    for refused in [raise(&open, draft), close(&open, closure)] {
        assert_eq!(refused.unwrap_err().kind(), "no_work_open");
    }
}
