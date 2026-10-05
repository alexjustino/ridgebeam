//! Site meetings walked through the commands the interface calls (slice G1).
//!
//! Closing a meeting writes its minutes whole — who was there, each item with
//! what was said and done, the actions raised, the earlier actions closed at
//! it — or, on any refusal, nothing. An action is closed once, at a later
//! meeting or between meetings. Every refusal is a sentence, and changes
//! nothing. The minutes print as a PDF through the report writer.

use chrono::NaiveDate;
use serde_json::json;

use crate::commands::meetings::{
    action_on_both, action_text_needed, attendee_one_of, item_kind_unknown, item_title_needed,
    meeting_action_close_with, meeting_close_with, OUTCOME_UNKNOWN,
};
use crate::commands::plan::{person_add_with, person_remove_with};
use crate::commands::reports::{report_html_write_with, report_pdf_write_with, Written};
use crate::commands::work::tests::{host, host_with_a_work};
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{ActionClosureDraft, MinutesDraft, WorkSnapshot};
use crate::db::meetings::{
    already_closed, attends_twice, closed_before_raised, due_before_meeting, named_twice,
    ACTION_NOT_FOUND,
};
use crate::db::testing::Scratch;
use crate::db::work::PERSON_NOT_FOUND;
use crate::db::Db;
use crate::error::Result;
use crate::folder::OpenWork;
use crate::report::model::ReportDocument;
use crate::report::reader_tests::read;

const AUTHOR: &str = "A. Engineer (synthetic)";

/// Friday.
fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

/// A work with a tiler and an electrician. Synthetic.
struct Work {
    _db: Db,
    open: OpenWork,
    _scratch: Scratch,
    tiler: String,
    electrician: String,
}

fn work() -> Work {
    let (db, open, scratch) = host_with_a_work();
    person_add_with(&open, "A. Tiler").unwrap();
    let plan = person_add_with(&open, "An electrician").unwrap();
    let id = |name: &str| {
        plan.people
            .iter()
            .find(|p| p.name == name)
            .unwrap()
            .id
            .clone()
    };
    Work {
        tiler: id("A. Tiler"),
        electrician: id("An electrician"),
        _db: db,
        open,
        _scratch: scratch,
    }
}

fn from<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("a shape the interface could send")
}

fn close(open: &OpenWork, minutes: serde_json::Value) -> Result<WorkSnapshot> {
    let minutes: MinutesDraft = from(minutes);
    meeting_close_with(open, &minutes, today(), AUTHOR)
}

fn close_action(open: &OpenWork, closure: serde_json::Value) -> Result<WorkSnapshot> {
    let closure: ActionClosureDraft = from(closure);
    meeting_action_close_with(open, &closure, today(), AUTHOR)
}

/// The e2e's first meeting, on Monday: the tiler and the electrician there;
/// a decision made and a change order approved in the meeting, a snag talked
/// about; an action on the tiler due Friday, and one on the neighbour.
fn monday(w: &Work) -> serde_json::Value {
    json!({
        "heldOn": "2026-10-05",
        "notes": "On site, twenty minutes.",
        "attendees": [ { "personId": w.tiler }, { "personId": w.electrician, "name": "" } ],
        "items": [
            { "kind": "decision", "refId": "00000000-0000-7000-8000-0000000000d1",
              "title": "Floor finish", "note": "The owner chose the oak.",
              "outcome": "Decision made: White oak" },
            { "kind": "change", "refId": "00000000-0000-7000-8000-0000000000c1",
              "title": "Change #1 — Extra socket", "outcome": "Approved" },
            { "kind": "snag", "title": "Snag #1 — Cracked tile by the drain" }
        ],
        "actions": [
            { "text": "Order the oak boards", "personId": w.tiler, "dueOn": "2026-10-09" },
            { "text": "Ask about the skip permit", "name": "The neighbour" }
        ]
    })
}

/// The e2e in the host: minutes #1 with two attendees, three items and two
/// actions; one action dropped between meetings; minutes #2 open with the
/// other and close it as done; the minutes printed.
#[test]
fn a_meeting_is_closed_into_minutes_and_the_next_one_closes_its_action() {
    let w = work();
    let plan = close(&w.open, monday(&w)).expect("minutes #1");
    let one = &plan.meetings[0];
    let wire = serde_json::to_value(&plan).unwrap();
    assert_eq!(
        wire["meetings"],
        json!([{
            "id": one.id,
            "number": 1,
            "heldOn": "2026-10-05",
            "notes": "On site, twenty minutes.",
            "attendees": [
                { "position": 1, "personId": w.tiler, "name": null },
                { "position": 2, "personId": w.electrician, "name": null }
            ],
            "items": [
                { "position": 1, "kind": "decision",
                  "refId": "00000000-0000-7000-8000-0000000000d1", "title": "Floor finish",
                  "note": "The owner chose the oak.", "outcome": "Decision made: White oak" },
                { "position": 2, "kind": "change",
                  "refId": "00000000-0000-7000-8000-0000000000c1",
                  "title": "Change #1 — Extra socket", "note": null, "outcome": "Approved" },
                { "position": 3, "kind": "snag", "refId": null,
                  "title": "Snag #1 — Cracked tile by the drain", "note": null, "outcome": null }
            ],
            "actions": [
                { "id": one.actions[0].id, "meetingId": one.id, "position": 1, "text": "Order the oak boards",
                  "personId": w.tiler, "name": null, "dueOn": "2026-10-09",
                  "createdAt": one.actions[0].created_at, "closure": null },
                { "id": one.actions[1].id, "meetingId": one.id, "position": 2, "text": "Ask about the skip permit",
                  "personId": null, "name": "The neighbour", "dueOn": null,
                  "createdAt": one.actions[1].created_at, "closure": null }
            ],
            "authorName": AUTHOR,
            "createdAt": one.created_at
        }]),
        "camelCase, nested, and null never absent"
    );
    let (order, permit) = (one.actions[0].id.clone(), one.actions[1].id.clone());

    let plan = close_action(
        &w.open,
        json!({ "actionId": permit, "outcome": "dropped", "closedOn": "2026-10-07",
                "note": "  The skip was moved.  " }),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&plan.meetings[0].actions[1]).unwrap()["closure"],
        json!({
            "meetingId": null, "outcome": "dropped", "closedOn": "2026-10-07",
            "note": "The skip was moved.", "authorName": AUTHOR,
            "createdAt": plan.meetings[0].actions[1].closure.as_ref().unwrap().created_at
        }),
        "between meetings: no meeting"
    );

    let plan = close(
        &w.open,
        json!({
            "heldOn": "2026-10-09",
            "attendees": [ { "personId": w.tiler }, { "name": "  The architect " } ],
            "items": [ { "kind": "action-carried", "refId": order,
                         "title": "Order the oak boards", "outcome": "Done" } ],
            "closures": [ { "actionId": order, "outcome": "done" } ]
        }),
    )
    .expect("minutes #2");
    let two = &plan.meetings[1];
    assert_eq!(
        (two.number, two.notes.clone(), two.actions.len()),
        (2, None, 0)
    );
    assert_eq!(two.attendees[1].name.as_deref(), Some("The architect"));
    let closure = plan.meetings[0].actions[0].closure.as_ref().unwrap();
    assert_eq!(
        (
            closure.meeting_id.as_deref(),
            closure.outcome.as_str(),
            closure.closed_on.as_str(),
            closure.note.as_deref()
        ),
        (Some(two.id.as_str()), "done", "2026-10-09", None),
        "closed at meeting #2, on its day"
    );

    // The minutes, printed: a report of kind `minutes`, through the writer.
    let out = Scratch::create();
    let path = out.path().join("minutes-1.pdf");
    let document: ReportDocument = from(json!({
        "kind": "minutes", "title": "Meeting minutes #1", "subtitle": "Monday 5 October 2026",
        "pageSize": "a4", "language": "en",
        "blocks": [
            { "type": "heading", "level": 2, "text": "Who was there" },
            { "type": "paragraph", "text": "A. Tiler, An electrician" },
            { "type": "table",
              "columns": [ { "text": "Item", "align": "left", "width": 0.5 },
                           { "text": "Done", "align": "left", "width": 0.5 } ],
              "rows": [ [ "Floor finish", "Decision made: White oak" ] ] },
            { "type": "paragraph", "text": "Order the oak boards — A. Tiler, by 9 October." },
            { "type": "paragraph", "tone": "muted",
              "text": "Minutes are a record, not a signature." }
        ]
    }));
    let written = Written::default();
    let file = report_pdf_write_with(
        &w.open,
        &written,
        &path.to_string_lossy(),
        &document,
        false,
        "2026-10-09T14:05:30-03:00",
    )
    .expect("the minutes kind is a report");
    let text = read(&std::fs::read(&path).unwrap()).text();
    for words in [
        "Meeting minutes #1",
        "Decision made: White oak",
        "Order the oak boards",
        "Minutes are a record, not a signature.",
    ] {
        assert!(text.contains(words), "{words} in {text}");
    }
    assert_eq!(file.pages, Some(1));
    assert_eq!(
        report_html_write_with(
            &w.open,
            &written,
            &out.path().join("minutes.html").to_string_lossy(),
            &document,
            false,
            "2026-10-09T14:05:30-03:00",
        )
        .unwrap_err()
        .to_string(),
        crate::commands::reports::NOT_THE_SNAPSHOT,
        "the page writer still takes only the snapshot"
    );
    work_close_with(&w.open);
}

/// Minutes with nobody ticked, nothing on the agenda and no action are taken:
/// who attended is what the person ticked.
#[test]
fn minutes_with_nobody_ticked_and_nothing_in_them_are_taken() {
    let w = work();
    let plan = close(&w.open, json!({ "heldOn": "2026-10-09" })).unwrap();
    let one = &plan.meetings[0];
    assert_eq!(
        (
            one.number,
            one.attendees.len(),
            one.items.len(),
            one.actions.len()
        ),
        (1, 0, 0, 0)
    );
    let wire = serde_json::to_value(one).unwrap();
    assert_eq!(
        (&wire["notes"], &wire["attendees"]),
        (&json!(null), &json!([]))
    );
    work_close_with(&w.open);
}

#[test]
fn minutes_that_do_not_fit_are_refused_with_a_sentence_and_nothing_is_written() {
    let w = work();
    let nobody = crate::db::new_id();
    let with = |change: serde_json::Value| {
        let mut draft = monday(&w);
        for (key, value) in change.as_object().unwrap() {
            draft[key] = value.clone();
        }
        draft
    };
    let item = |fields: serde_json::Value| {
        let mut item = json!({ "kind": "other", "title": "X" });
        for (key, value) in fields.as_object().unwrap() {
            item[key] = value.clone();
        }
        with(json!({ "items": [ { "kind": "other", "title": "First" }, item ] }))
    };
    let crowd: Vec<serde_json::Value> = (0..101)
        .map(|n| json!({ "name": format!("P{n}") }))
        .collect();
    let action = |fields: serde_json::Value| {
        let mut action = json!({ "text": "X" });
        for (key, value) in fields.as_object().unwrap() {
            action[key] = value.clone();
        }
        with(json!({ "actions": [ action ] }))
    };
    for (draft, sentence) in [
        // The day.
        (
            with(json!({ "heldOn": "2026-10-10" })),
            "2026-10-10 has not happened yet: a meeting is held on a day that has.".to_string(),
        ),
        (
            with(json!({ "heldOn": "5 Oct" })),
            "A meeting's day is a date written YYYY-MM-DD, on a day that exists.".to_string(),
        ),
        (
            with(json!({ "notes": "n".repeat(4001) })),
            "A meeting's notes are at most 4000 characters.".to_string(),
        ),
        // Who was there.
        (
            with(json!({ "attendees": [ { "personId": w.tiler, "name": "Also a name" } ] })),
            attendee_one_of(1),
        ),
        (
            with(json!({ "attendees": [ { "personId": w.tiler }, {} ] })),
            attendee_one_of(2),
        ),
        (
            with(json!({ "attendees": [ { "personId": " ", "name": " " } ] })),
            attendee_one_of(1),
        ),
        (
            with(json!({ "attendees": [ { "name": "a".repeat(121) } ] })),
            "Attendee 1's name is at most 120 characters.".to_string(),
        ),
        (
            with(json!({ "attendees": [ { "name": "Two\nlines" } ] })),
            "Attendee 1's name is one line, with no control character.".to_string(),
        ),
        (
            with(json!({ "attendees": [ { "personId": nobody } ] })),
            PERSON_NOT_FOUND.to_string(),
        ),
        (
            with(json!({ "attendees": [ { "personId": w.tiler }, { "personId": w.tiler } ] })),
            attends_twice(2),
        ),
        (
            with(
                json!({ "attendees": [ { "name": "The neighbour" }, { "personId": w.tiler },
                                        { "name": "  the NEIGHBOUR " } ] }),
            ),
            named_twice(3),
        ),
        // The items.
        (item(json!({ "kind": "minutes" })), item_kind_unknown(2)),
        (item(json!({ "kind": "Decision" })), item_kind_unknown(2)),
        (item(json!({ "title": "  " })), item_title_needed(2)),
        (
            item(json!({ "title": "t".repeat(201) })),
            "Item 2's title is at most 200 characters.".to_string(),
        ),
        (
            item(json!({ "title": "Two\nlines" })),
            "Item 2's title is one line, with no control character.".to_string(),
        ),
        (
            item(json!({ "note": "n".repeat(2001) })),
            "Item 2's note is at most 2000 characters.".to_string(),
        ),
        (
            item(json!({ "outcome": "o".repeat(201) })),
            "Item 2's outcome is at most 200 characters.".to_string(),
        ),
        (
            item(json!({ "refId": "r".repeat(65) })),
            "Item 2's reference is at most 64 characters.".to_string(),
        ),
        // The actions.
        (action(json!({ "text": "" })), action_text_needed(1)),
        (
            action(json!({ "text": "a".repeat(201) })),
            "Action 1 is at most 200 characters.".to_string(),
        ),
        (
            action(json!({ "personId": w.tiler, "name": "The neighbour" })),
            action_on_both(1),
        ),
        (
            action(json!({ "name": "n".repeat(121) })),
            "The name on action 1 is at most 120 characters.".to_string(),
        ),
        (
            action(json!({ "personId": nobody })),
            PERSON_NOT_FOUND.to_string(),
        ),
        (
            action(json!({ "dueOn": "2026-02-30" })),
            "Action 1's due day is a date written YYYY-MM-DD, on a day that exists.".to_string(),
        ),
        (
            action(json!({ "dueOn": "2026-10-04" })),
            due_before_meeting(1, "2026-10-05"),
        ),
        // A closure of an action that is not there — past everything else.
        (
            with(json!({ "closures": [ { "actionId": nobody, "outcome": "done" } ] })),
            ACTION_NOT_FOUND.to_string(),
        ),
        (
            with(json!({ "closures": [ { "actionId": nobody, "outcome": "finished" } ] })),
            OUTCOME_UNKNOWN.to_string(),
        ),
        (
            with(json!({ "closures": [
                { "actionId": nobody, "outcome": "done", "note": "n".repeat(501) } ] })),
            "A closing note is at most 500 characters.".to_string(),
        ),
        (
            with(json!({ "attendees": crowd })),
            "Minutes hold at most 100 attendees; these have 101.".to_string(),
        ),
    ] {
        let refused = close(&w.open, draft.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft}");
        assert_eq!(refused.to_string(), sentence, "{draft}");
    }
    assert!(
        work_get_with(&w.open).unwrap().meetings.is_empty(),
        "nothing written"
    );

    // Once #1 is there: a meeting written down late, held the day before, is
    // taken — but #1's action is not closed at it, and nothing of it is
    // written.
    let order = close(&w.open, monday(&w)).unwrap().meetings[0].actions[0]
        .id
        .clone();
    assert_eq!(
        close(
            &w.open,
            json!({ "heldOn": "2026-10-04",
                    "closures": [ { "actionId": order, "outcome": "done" } ] })
        )
        .unwrap_err()
        .to_string(),
        closed_before_raised(1, "2026-10-05")
    );
    assert_eq!(work_get_with(&w.open).unwrap().meetings.len(), 1);
    let plan = close(&w.open, json!({ "heldOn": "2026-10-04" })).expect("written down late");
    assert_eq!(
        plan.meetings
            .iter()
            .map(|m| (m.number, m.held_on.as_str()))
            .collect::<Vec<_>>(),
        vec![(1, "2026-10-05"), (2, "2026-10-04")],
        "by number, as written"
    );
    work_close_with(&w.open);
}

#[test]
fn an_action_closed_twice_or_out_of_turn_is_refused_with_a_sentence() {
    let w = work();
    let plan = close(&w.open, monday(&w)).unwrap();
    let order = plan.meetings[0].actions[0].id.clone();
    let closing = |change: serde_json::Value| {
        let mut closure = json!({ "actionId": order, "outcome": "done", "closedOn": "2026-10-08" });
        for (key, value) in change.as_object().unwrap() {
            closure[key] = value.clone();
        }
        closure
    };
    for (closure, sentence) in [
        (
            closing(json!({ "outcome": "Done" })),
            OUTCOME_UNKNOWN.to_string(),
        ),
        (
            closing(json!({ "outcome": "fixed" })),
            OUTCOME_UNKNOWN.to_string(),
        ),
        (
            closing(json!({ "closedOn": "2026-10-10" })),
            "2026-10-10 has not happened yet: an action is closed on a day that has.".to_string(),
        ),
        (
            closing(json!({ "closedOn": "" })),
            "An action's closing day is a date written YYYY-MM-DD, on a day that exists."
                .to_string(),
        ),
        (
            closing(json!({ "closedOn": "2026-10-04" })),
            closed_before_raised(1, "2026-10-05"),
        ),
        (
            closing(json!({ "note": "n".repeat(501) })),
            "A closing note is at most 500 characters.".to_string(),
        ),
        (
            closing(json!({ "actionId": crate::db::new_id() })),
            ACTION_NOT_FOUND.to_string(),
        ),
    ] {
        let refused = close_action(&w.open, closure.clone()).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{closure}");
        assert_eq!(refused.to_string(), sentence, "{closure}");
    }
    assert!(work_get_with(&w.open).unwrap().meetings[0].actions[0]
        .closure
        .is_none());

    close_action(&w.open, closing(json!({}))).unwrap();
    assert_eq!(
        close_action(&w.open, closing(json!({ "outcome": "dropped" })))
            .unwrap_err()
            .to_string(),
        already_closed("done", "2026-10-08")
    );
    // Closed between meetings, it cannot be closed again at the next one —
    // and the whole of that meeting is refused with it.
    assert_eq!(
        close(
            &w.open,
            json!({
                "heldOn": "2026-10-09", "attendees": [ { "personId": w.tiler } ],
                "closures": [ { "actionId": order, "outcome": "done" } ]
            })
        )
        .unwrap_err()
        .to_string(),
        already_closed("done", "2026-10-08")
    );
    assert_eq!(work_get_with(&w.open).unwrap().meetings.len(), 1);
    work_close_with(&w.open);
}

/// The minutes name a person by id, not by a tie: a person removed from the
/// plan later leaves them as they were.
#[test]
fn a_person_removed_later_leaves_the_minutes_as_they_were() {
    let w = work();
    close(&w.open, monday(&w)).unwrap();
    let plan = person_remove_with(&w.open, &w.tiler).unwrap();
    assert_eq!(plan.people.len(), 1);
    assert_eq!(
        plan.meetings[0].attendees[0].person_id.as_deref(),
        Some(w.tiler.as_str())
    );
    assert_eq!(
        plan.meetings[0].actions[0].person_id.as_deref(),
        Some(w.tiler.as_str()),
        "the record as it was"
    );
    work_close_with(&w.open);
}

#[test]
fn meeting_commands_with_no_work_open_are_no_work_open() {
    let (_db, open) = host();
    let minutes = json!({ "heldOn": "2026-10-06" });
    let closure = json!({ "actionId": "a", "outcome": "done", "closedOn": "2026-10-06" });
    for refused in [close(&open, minutes), close_action(&open, closure)] {
        assert_eq!(refused.unwrap_err().kind(), "no_work_open");
    }
}
