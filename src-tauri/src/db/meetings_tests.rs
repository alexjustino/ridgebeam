//! Minutes are facts: the tests that try to rewrite them (slice G1).
//!
//! These live apart from `db::meetings` on purpose. That module holds no
//! statement that edits or removes a row, by rule, and a test here reads its
//! source to prove it — so the statements that *attack* the minutes cannot
//! live inside it.
//!
//! Every attack is tried twice: with `recursive_triggers` on, as the product
//! opens every file, and off, as SQLite's default and any other tool would open
//! it. Each must be refused with `meeting: append-only`, and after all of them
//! the minutes must read exactly as they did before. The rules the host says
//! first with a sentence are then tried past the host, on the schema alone.

use rusqlite::Connection;

use crate::db::meetings::{
    self, already_closed, attends_twice, closed_before_raised, due_before_meeting, named_twice,
    Attendee, CarriedClosure, NewAction, NewActionClosure, NewItem, NewMinutes, Outcome,
    ACTION_NOT_FOUND,
};
use crate::db::new_id;
use crate::db::work::tests::a_work;
use crate::db::work::{add_person, snapshot, PERSON_NOT_FOUND};

const REFUSAL: &str = "meeting: append-only";

/// A work with a tiler and an electrician. Synthetic.
struct Fixture {
    conn: Connection,
    tiler: String,
    electrician: String,
}

fn fixture() -> Fixture {
    let conn = a_work();
    let tiler = add_person(&conn, "A. Tiler (synthetic)").unwrap();
    let electrician = add_person(&conn, "An electrician (synthetic)").unwrap();
    Fixture {
        conn,
        tiler,
        electrician,
    }
}

fn item(kind: &str, title: &str) -> NewItem {
    NewItem {
        kind: kind.into(),
        ref_id: None,
        title: title.into(),
        note: None,
        outcome: None,
    }
}

/// The first meeting: the tiler and the neighbour there, three items, two
/// actions — one on the tiler due Friday, one on nobody.
fn first(f: &Fixture) -> NewMinutes {
    NewMinutes {
        held_on: "2026-10-05".into(),
        notes: Some("Short meeting on site.".into()),
        attendees: vec![
            Attendee::Person(f.tiler.clone()),
            Attendee::Named("The neighbour".into()),
        ],
        items: vec![
            NewItem {
                ref_id: Some(new_id()),
                note: Some("The owner chose the oak.".into()),
                outcome: Some("Decision made: White oak".into()),
                ..item("decision", "Floor finish")
            },
            item("snag", "Cracked tile by the drain"),
            item("other", "Parking for the skip"),
        ],
        actions: vec![
            NewAction {
                text: "Order the oak boards".into(),
                on: Some(Attendee::Person(f.tiler.clone())),
                due_on: Some("2026-10-09".into()),
            },
            NewAction {
                text: "Ask the council about the skip".into(),
                on: None,
                due_on: None,
            },
        ],
        closures: Vec::new(),
        author_name: "Synthetic author".into(),
    }
}

/// The second meeting, with nothing in it.
fn bare(held_on: &str) -> NewMinutes {
    NewMinutes {
        held_on: held_on.into(),
        notes: None,
        attendees: Vec::new(),
        items: Vec::new(),
        actions: Vec::new(),
        closures: Vec::new(),
        author_name: "Synthetic author".into(),
    }
}

/// Two meetings: the first raises two actions; the second closes the first
/// action as done; the other is dropped between meetings.
fn two_meetings(f: &Fixture) -> (String, String) {
    meetings::record(&f.conn, &first(f)).unwrap();
    let actions = meetings::list(&f.conn).unwrap()[0].actions.clone();
    let (order, ask) = (actions[0].id.clone(), actions[1].id.clone());
    meetings::close_action(
        &f.conn,
        &NewActionClosure {
            action_id: ask.clone(),
            outcome: Outcome::Dropped,
            closed_on: "2026-10-07".into(),
            note: Some("The skip went.".into()),
            author_name: "Synthetic author".into(),
        },
    )
    .unwrap();
    meetings::record(
        &f.conn,
        &NewMinutes {
            closures: vec![CarriedClosure {
                action_id: order.clone(),
                outcome: Outcome::Done,
                note: None,
            }],
            ..bare("2026-10-12")
        },
    )
    .unwrap();
    (order, ask)
}

#[test]
fn the_minutes_are_written_whole_numbered_and_read_back_in_their_order() {
    let f = fixture();
    assert_eq!(meetings::record(&f.conn, &first(&f)).unwrap(), 1);

    let list = meetings::list(&f.conn).unwrap();
    assert_eq!(list.len(), 1);
    let one = &list[0];
    assert_eq!(
        (
            one.number,
            one.held_on.as_str(),
            one.notes.as_deref(),
            one.author_name.as_str()
        ),
        (
            1,
            "2026-10-05",
            Some("Short meeting on site."),
            "Synthetic author"
        )
    );
    assert_eq!(
        one.attendees
            .iter()
            .map(|a| (a.position, a.person_id.as_deref(), a.name.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            (1, Some(f.tiler.as_str()), None),
            (2, None, Some("The neighbour"))
        ]
    );
    assert_eq!(
        one.items
            .iter()
            .map(|i| (i.position, i.kind.as_str(), i.title.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (1, "decision", "Floor finish"),
            (2, "snag", "Cracked tile by the drain"),
            (3, "other", "Parking for the skip")
        ]
    );
    assert_eq!(
        (
            one.items[0].note.as_deref(),
            one.items[0].outcome.as_deref()
        ),
        (
            Some("The owner chose the oak."),
            Some("Decision made: White oak")
        )
    );
    assert_eq!(
        one.actions
            .iter()
            .map(|a| (
                a.position,
                a.text.as_str(),
                a.person_id.as_deref(),
                a.due_on.as_deref(),
                a.closure.is_none()
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                1,
                "Order the oak boards",
                Some(f.tiler.as_str()),
                Some("2026-10-09"),
                true
            ),
            (2, "Ask the council about the skip", None, None, true)
        ]
    );
    assert_eq!(snapshot(&f.conn).unwrap().meetings, list, "in the snapshot");
}

#[test]
fn an_action_is_closed_once_at_a_later_meeting_or_between_meetings() {
    let f = fixture();
    let (order, ask) = two_meetings(&f);
    let list = meetings::list(&f.conn).unwrap();
    assert_eq!(
        list.iter()
            .map(|m| (m.number, m.held_on.as_str()))
            .collect::<Vec<_>>(),
        vec![(1, "2026-10-05"), (2, "2026-10-12")]
    );
    let actions = &list[0].actions;
    let done = actions[0].closure.as_ref().unwrap();
    assert_eq!(
        (
            done.meeting_id.as_deref(),
            done.outcome.as_str(),
            done.closed_on.as_str(),
            done.note.as_deref()
        ),
        (Some(list[1].id.as_str()), "done", "2026-10-12", None),
        "closed at meeting #2, on its day"
    );
    let dropped = actions[1].closure.as_ref().unwrap();
    assert_eq!(
        (
            dropped.meeting_id.as_deref(),
            dropped.outcome.as_str(),
            dropped.closed_on.as_str(),
            dropped.note.as_deref()
        ),
        (None, "dropped", "2026-10-07", Some("The skip went.")),
        "closed between meetings"
    );
    assert!(list[1].actions.is_empty());

    for id in [&order, &ask] {
        let refused = meetings::close_action(
            &f.conn,
            &NewActionClosure {
                action_id: id.clone(),
                outcome: Outcome::Done,
                closed_on: "2026-10-13".into(),
                note: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert!(refused.to_string().starts_with("That action was already "));
    }
    assert_eq!(
        meetings::close_action(
            &f.conn,
            &NewActionClosure {
                action_id: order.clone(),
                outcome: Outcome::Dropped,
                closed_on: "2026-10-13".into(),
                note: None,
                author_name: "x".into(),
            },
        )
        .unwrap_err()
        .to_string(),
        already_closed("done", "2026-10-12")
    );
    assert_eq!(meetings::list(&f.conn).unwrap(), list, "nothing changed");
}

/// The host's own refusals, at the repository, each writing nothing — even
/// when the refusal comes after the meeting, its attendees, items and actions
/// were already inserted inside the transaction.
#[test]
fn the_repository_refuses_and_a_failure_anywhere_writes_nothing() {
    let f = fixture();
    let nobody = new_id();
    for (minutes, sentence) in [
        (
            NewMinutes {
                attendees: vec![Attendee::Person(nobody.clone())],
                ..first(&f)
            },
            PERSON_NOT_FOUND.to_string(),
        ),
        (
            NewMinutes {
                actions: vec![NewAction {
                    text: "X".into(),
                    on: Some(Attendee::Person(nobody.clone())),
                    due_on: None,
                }],
                ..first(&f)
            },
            PERSON_NOT_FOUND.to_string(),
        ),
        (
            NewMinutes {
                attendees: vec![
                    Attendee::Person(f.tiler.clone()),
                    Attendee::Person(f.electrician.clone()),
                    Attendee::Person(f.tiler.clone()),
                ],
                ..first(&f)
            },
            attends_twice(3),
        ),
        (
            NewMinutes {
                attendees: vec![
                    Attendee::Named("The neighbour".into()),
                    Attendee::Person(f.tiler.clone()),
                    Attendee::Named("  THE Neighbour ".into()),
                ],
                ..first(&f)
            },
            named_twice(3),
        ),
        (
            NewMinutes {
                actions: vec![
                    NewAction {
                        text: "X".into(),
                        on: None,
                        due_on: None,
                    },
                    NewAction {
                        text: "Y".into(),
                        on: None,
                        due_on: Some("2026-10-04".into()),
                    },
                ],
                ..first(&f)
            },
            due_before_meeting(2, "2026-10-05"),
        ),
        // Past every insert of the meeting: a closure of an unknown action.
        (
            NewMinutes {
                closures: vec![CarriedClosure {
                    action_id: nobody.clone(),
                    outcome: Outcome::Done,
                    note: None,
                }],
                ..first(&f)
            },
            ACTION_NOT_FOUND.to_string(),
        ),
    ] {
        let refused = meetings::record(&f.conn, &minutes).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{minutes:?}");
        assert_eq!(refused.to_string(), sentence, "{minutes:?}");
    }
    for table in [
        "meeting",
        "meeting_attendee",
        "meeting_item",
        "meeting_action",
        "meeting_action_closure",
    ] {
        let rows: i64 = f
            .conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0, "nothing written to `{table}`");
    }

    // The same action closed twice in one set of minutes: the second finds
    // the first, and neither is written — nor the meeting.
    meetings::record(&f.conn, &first(&f)).unwrap();
    let action = meetings::list(&f.conn).unwrap()[0].actions[0].id.clone();
    let twice = CarriedClosure {
        action_id: action.clone(),
        outcome: Outcome::Done,
        note: None,
    };
    assert_eq!(
        meetings::record(
            &f.conn,
            &NewMinutes {
                closures: vec![twice.clone(), twice],
                ..bare("2026-10-12")
            },
        )
        .unwrap_err()
        .to_string(),
        already_closed("done", "2026-10-12")
    );
    assert_eq!(meetings::list(&f.conn).unwrap().len(), 1);

    // A meeting written down late, held before the last one's day, is taken;
    // the earlier meeting's action cannot be closed at it.
    assert_eq!(
        meetings::record(
            &f.conn,
            &NewMinutes {
                closures: vec![CarriedClosure {
                    action_id: action.clone(),
                    outcome: Outcome::Done,
                    note: None,
                }],
                ..bare("2026-10-04")
            },
        )
        .unwrap_err()
        .to_string(),
        closed_before_raised(1, "2026-10-05")
    );
    assert_eq!(
        meetings::record(&f.conn, &bare("2026-10-04")).unwrap(),
        2,
        "held before #1, written after it"
    );
    // An action closed before its meeting; an unknown action between
    // meetings.
    let between = |id: &str, day: &str| NewActionClosure {
        action_id: id.into(),
        outcome: Outcome::Dropped,
        closed_on: day.into(),
        note: None,
        author_name: "Synthetic author".into(),
    };
    assert_eq!(
        meetings::close_action(&f.conn, &between(&action, "2026-10-04"))
            .unwrap_err()
            .to_string(),
        closed_before_raised(1, "2026-10-05")
    );
    assert_eq!(
        meetings::close_action(&f.conn, &between(&nobody, "2026-10-06"))
            .unwrap_err()
            .to_string(),
        ACTION_NOT_FOUND
    );
    assert!(meetings::list(&f.conn).unwrap()[0].actions[0]
        .closure
        .is_none());
    meetings::close_action(&f.conn, &between(&action, "2026-10-05"))
        .expect("closed on the day of its meeting");
    meetings::record(&f.conn, &bare("2026-10-05")).expect("two meetings on one day");
    assert_eq!(meetings::list(&f.conn).unwrap()[2].number, 3);
}

/// Every way SQL can rewrite the minutes, with `recursive_triggers` on and
/// off — including adding a row to a meeting already closed.
#[test]
fn every_update_delete_and_replace_of_the_minutes_is_refused_whatever_the_pragmas() {
    let f = fixture();
    let (order, ask) = two_meetings(&f);
    let before = meetings::list(&f.conn).unwrap();
    let (one, two) = (before[0].id.clone(), before[1].id.clone());
    let tiler = &f.tiler;
    let electrician = &f.electrician;

    let attacks = [
        // The meeting.
        format!("UPDATE meeting SET held_on = '2026-10-06' WHERE id = '{one}'"),
        "UPDATE meeting SET notes = NULL".to_string(),
        "UPDATE meeting SET attendee_count = 9".to_string(),
        format!("UPDATE OR REPLACE meeting SET number = 1 WHERE id = '{two}'"),
        format!("DELETE FROM meeting WHERE id = '{two}'"),
        "DELETE FROM meeting".to_string(),
        format!(
            "INSERT OR REPLACE INTO meeting (id, number, held_on, attendee_count, item_count,
                                            action_count, author_name, created_at)
             VALUES ('{one}', 1, '2026-10-05', 0, 0, 0, 'Somebody', 't')"
        ),
        format!(
            "REPLACE INTO meeting (id, number, held_on, attendee_count, item_count, action_count,
                                  author_name, created_at)
             VALUES ('{}', 2, '2026-10-12', 0, 0, 0, 'Somebody', 't')",
            new_id()
        ),
        format!(
            "INSERT INTO meeting (id, number, held_on, attendee_count, item_count, action_count,
                                 author_name, created_at)
             VALUES ('{one}', 3, '2026-10-12', 0, 0, 0, 'Somebody', 't')
             ON CONFLICT (id) DO UPDATE SET notes = 'Rewritten'"
        ),
        // A number that does not continue.
        format!(
            "INSERT INTO meeting (id, number, held_on, attendee_count, item_count, action_count,
                                 author_name, created_at)
             VALUES ('{}', 7, '2026-10-12', 0, 0, 0, 'Somebody', 't')",
            new_id()
        ),
        // Who was there: rewritten, removed, or added after the close.
        format!("UPDATE meeting_attendee SET name = 'Somebody else' WHERE meeting_id = '{one}'"),
        "DELETE FROM meeting_attendee".to_string(),
        format!(
            "INSERT INTO meeting_attendee (meeting_id, position, person_id)
             VALUES ('{one}', 3, '{electrician}')"
        ),
        format!(
            "INSERT OR REPLACE INTO meeting_attendee (meeting_id, position, name)
             VALUES ('{one}', 2, 'Not the neighbour')"
        ),
        format!(
            "INSERT OR REPLACE INTO meeting_attendee (meeting_id, position, person_id)
             VALUES ('{one}', 2, '{tiler}')"
        ),
        format!(
            "INSERT INTO meeting_attendee (meeting_id, position, person_id)
             VALUES ('{two}', 1, '{tiler}')"
        ),
        // The items.
        "UPDATE meeting_item SET outcome = 'Decision made: Pine'".to_string(),
        format!("DELETE FROM meeting_item WHERE meeting_id = '{one}' AND position = 3"),
        format!(
            "REPLACE INTO meeting_item (meeting_id, position, kind, title)
             VALUES ('{one}', 1, 'decision', 'Floor finish')"
        ),
        format!(
            "INSERT INTO meeting_item (meeting_id, position, kind, title)
             VALUES ('{one}', 4, 'other', 'Added later')"
        ),
        format!(
            "INSERT INTO meeting_item (meeting_id, position, kind, title)
             VALUES ('{one}', 1, 'other', 'Twice')
             ON CONFLICT DO UPDATE SET title = 'Rewritten'"
        ),
        // The actions.
        "UPDATE meeting_action SET due_on = '2026-12-31'".to_string(),
        format!("UPDATE meeting_action SET person_id = NULL WHERE id = '{order}'"),
        format!("DELETE FROM meeting_action WHERE id = '{ask}'"),
        format!(
            "INSERT OR REPLACE INTO meeting_action (id, meeting_id, position, text, created_at)
             VALUES ('{order}', '{one}', 1, 'Rewritten', 't')"
        ),
        format!(
            "INSERT INTO meeting_action (id, meeting_id, position, text, created_at)
             VALUES ('{}', '{one}', 3, 'Added later', 't')",
            new_id()
        ),
        format!(
            "INSERT INTO meeting_action (id, meeting_id, position, text, created_at)
             VALUES ('{}', '{two}', 1, 'Added later', 't')",
            new_id()
        ),
        // The closures.
        format!(
            "UPDATE meeting_action_closure SET outcome = 'dropped' WHERE action_id = '{order}'"
        ),
        "UPDATE meeting_action_closure SET closed_on = '2026-12-01'".to_string(),
        format!("DELETE FROM meeting_action_closure WHERE action_id = '{ask}'"),
        "DELETE FROM meeting_action_closure".to_string(),
        format!(
            "INSERT OR REPLACE INTO meeting_action_closure
               (action_id, closed_on, outcome, author_name, created_at)
             VALUES ('{order}', '2026-10-12', 'dropped', 'Somebody', 't')"
        ),
        format!(
            "REPLACE INTO meeting_action_closure
               (action_id, meeting_id, closed_on, outcome, author_name, created_at)
             VALUES ('{ask}', '{two}', '2026-10-12', 'done', 'Somebody', 't')"
        ),
        format!(
            "INSERT INTO meeting_action_closure
               (action_id, closed_on, outcome, author_name, created_at)
             VALUES ('{ask}', '2026-10-12', 'done', 'Somebody', 't')
             ON CONFLICT DO UPDATE SET outcome = 'done'"
        ),
    ];

    for recursive in ["ON", "OFF"] {
        f.conn
            .pragma_update(None, "recursive_triggers", recursive)
            .unwrap();
        for attack in &attacks {
            let refused = f
                .conn
                .execute(attack, [])
                .expect_err(&format!("recursive_triggers {recursive}: {attack}"));
            assert!(
                refused.to_string().contains(REFUSAL),
                "recursive_triggers {recursive}: `{attack}` was refused for the wrong reason: {refused}"
            );
        }
    }

    assert_eq!(
        meetings::list(&f.conn).unwrap(),
        before,
        "every meeting, attendee, item, action and closure reads as it did"
    );
}

/// Why each table carries a `BEFORE INSERT` guard as well as its `BEFORE
/// DELETE` trigger: with `recursive_triggers` off, a `REPLACE` removes the row
/// it replaces without firing a DELETE trigger. The guard is taken away here,
/// on this connection only, to show the hole it closes.
#[test]
fn without_the_insert_guard_a_replace_would_rewrite_a_closure_when_recursive_triggers_are_off() {
    let f = fixture();
    let (order, _) = two_meetings(&f);
    f.conn
        .execute_batch("DROP TRIGGER meeting_action_closure_no_replace;")
        .unwrap();
    f.conn
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();

    f.conn
        .execute(
            "INSERT OR REPLACE INTO meeting_action_closure
               (action_id, closed_on, outcome, note, author_name, created_at)
             VALUES (?1, '2026-10-12', 'dropped', 'Never done', 'Somebody', 't')",
            [&order],
        )
        .expect("the hole: the closure is replaced and no trigger saw it go");
    let outcome: String = f
        .conn
        .query_row(
            "SELECT outcome FROM meeting_action_closure WHERE action_id = ?1",
            [&order],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(outcome, "dropped");
}

/// What the host refuses first with a sentence, refused again by the schema
/// alone — a file written by something else holds the same rules.
#[test]
fn the_schema_refuses_what_the_host_refuses_first() {
    let f = fixture();
    let meeting = |id: &str, number: i64, held_on: &str, notes: &str, counts: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO meeting (id, number, held_on, notes, attendee_count, item_count,
                                     action_count, author_name, created_at)
                 VALUES ('{id}', {number}, '{held_on}', {notes}, {counts}, 'Somebody', 't')"
            ),
            [],
        )
    };
    for (held_on, notes, counts) in [
        ("2026-02-30", "NULL", "1, 1, 1"),
        ("5 Oct 2026", "NULL", "1, 1, 1"),
        ("2026-10-05", "''", "1, 1, 1"),
        (
            "2026-10-05",
            "replace(hex(zeroblob(4001)), '00', 'x')",
            "1, 1, 1",
        ),
        ("2026-10-05", "NULL", "101, 1, 1"),
        ("2026-10-05", "NULL", "1, 501, 1"),
        ("2026-10-05", "NULL", "1, 1, 201"),
        ("2026-10-05", "NULL", "-1, 1, 1"),
    ] {
        let refused = meeting(&new_id(), 1, held_on, notes, counts).expect_err(held_on);
        assert!(
            refused.to_string().contains("CHECK"),
            "{held_on}: {refused}"
        );
    }
    let one = new_id();
    meeting(&one, 1, "2026-10-05", "NULL", "4, 3, 3").expect("by the schema alone");

    let attendee = |position: i64, columns: &str, values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO meeting_attendee (meeting_id, position, {columns})
                 VALUES ('{one}', {position}, {values})"
            ),
            [],
        )
    };
    let tiler = &f.tiler;
    for (columns, values) in [
        // Both, or neither.
        ("person_id, name", format!("'{tiler}', 'Also a name'")),
        ("person_id, name", "NULL, NULL".to_string()),
        // A name that is blank or too long; an id that is not one.
        ("name", "'  '".to_string()),
        ("name", "replace(hex(zeroblob(121)), '00', 'x')".to_string()),
        ("person_id", "'Ana'".to_string()),
    ] {
        let refused = attendee(1, columns, &values).expect_err(&values);
        assert!(refused.to_string().contains("CHECK"), "{values}: {refused}");
    }
    attendee(1, "person_id", &format!("'{tiler}'")).unwrap();
    attendee(2, "name", "'The neighbour'").unwrap();
    let refused = attendee(3, "person_id", &format!("'{tiler}'")).unwrap_err();
    assert!(
        refused.to_string().contains(REFUSAL),
        "a person attends once: {refused}"
    );
    let refused = attendee(3, "name", "' the NEIGHBOUR  '").unwrap_err();
    assert!(
        refused.to_string().contains("meeting: attendee"),
        "a name is written once: {refused}"
    );
    attendee(3, "name", "'The neighbour''s son'").expect("another name");

    let item = |position: i64, values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO meeting_item (meeting_id, position, kind, ref_id, title, note,
                                          outcome)
                 VALUES ('{one}', {position}, {values})"
            ),
            [],
        )
    };
    for values in [
        "'minutes', NULL, 'X', NULL, NULL",
        "'Decision', NULL, 'X', NULL, NULL",
        "'other', '', 'X', NULL, NULL",
        "'other', replace(hex(zeroblob(65)), '00', 'x'), 'X', NULL, NULL",
        "'other', NULL, '', NULL, NULL",
        "'other', NULL, replace(hex(zeroblob(201)), '00', 'x'), NULL, NULL",
        "'other', NULL, 'X', replace(hex(zeroblob(2001)), '00', 'x'), NULL",
        "'other', NULL, 'X', NULL, replace(hex(zeroblob(201)), '00', 'x')",
        "'other', NULL, 'X', NULL, ' '",
    ] {
        let refused = item(1, values).expect_err(values);
        assert!(refused.to_string().contains("CHECK"), "{values}: {refused}");
    }
    item(1, "'action-carried', 'x', 'Carried', NULL, NULL").unwrap();

    let action = |id: &str, position: i64, columns: &str, values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO meeting_action (id, meeting_id, position, created_at, {columns})
                 VALUES ('{id}', '{one}', {position}, 't', {values})"
            ),
            [],
        )
    };
    for (columns, values) in [
        ("text", "''".to_string()),
        ("text", "replace(hex(zeroblob(201)), '00', 'x')".to_string()),
        ("text, person_id, name", format!("'X', '{tiler}', 'Ana'")),
        ("text, due_on", "'X', '2026-12-32'".to_string()),
    ] {
        let refused = action(&new_id(), 1, columns, &values).expect_err(&values);
        assert!(refused.to_string().contains("CHECK"), "{values}: {refused}");
    }
    let refused = action(&new_id(), 1, "text, due_on", "'X', '2026-10-04'").unwrap_err();
    assert!(
        refused.to_string().contains("meeting: action"),
        "due before the meeting: {refused}"
    );
    let raised = new_id();
    action(&raised, 1, "text, due_on", "'X', '2026-10-05'").expect("due on its day");

    let closure = |values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO meeting_action_closure
                   (action_id, meeting_id, closed_on, outcome, note, author_name, created_at)
                 VALUES ({values}, 'Somebody', 't')"
            ),
            [],
        )
    };
    let two = new_id();
    meeting(&two, 2, "2026-10-12", "NULL", "0, 0, 0").unwrap();
    for (values, refusal) in [
        // An outcome that is not one; a note too long.
        (
            format!("'{raised}', NULL, '2026-10-06', 'fixed', NULL"),
            "CHECK",
        ),
        (
            format!(
                "'{raised}', NULL, '2026-10-06', 'done', replace(hex(zeroblob(501)), '00', 'x')"
            ),
            "CHECK",
        ),
        // An action that is not there; before its meeting.
        (
            format!("'{}', NULL, '2026-10-06', 'done', NULL", new_id()),
            "meeting: closure",
        ),
        (
            format!("'{raised}', NULL, '2026-10-04', 'done', NULL"),
            "meeting: closure",
        ),
        // At a meeting, not on its day; at its own meeting; at a meeting that
        // is not there.
        (
            format!("'{raised}', '{two}', '2026-10-11', 'done', NULL"),
            "meeting: closure",
        ),
        (
            format!("'{raised}', '{one}', '2026-10-05', 'done', NULL"),
            "meeting: closure",
        ),
        (
            format!("'{raised}', '{}', '2026-10-12', 'done', NULL", new_id()),
            "meeting: closure",
        ),
    ] {
        let refused = closure(&values).expect_err(&values);
        assert!(refused.to_string().contains(refusal), "{values}: {refused}");
    }
    closure(&format!("'{raised}', '{two}', '2026-10-12', 'done', NULL"))
        .expect("at a later meeting, on its day, by the schema alone");
    let refused = closure(&format!("'{raised}', NULL, '2026-10-13', 'dropped', NULL")).unwrap_err();
    assert!(refused.to_string().contains(REFUSAL), "{refused}");

    // A meeting written down late, on a day before the last one's, is taken;
    // the earlier meeting's action is not closed at it.
    let late = new_id();
    meeting(&late, 3, "2026-10-04", "NULL", "0, 0, 0").expect("written down late");
    let earlier = new_id();
    action(&earlier, 2, "text", "'Y'").unwrap();
    let refused = closure(&format!(
        "'{earlier}', '{late}', '2026-10-04', 'done', NULL"
    ))
    .unwrap_err();
    assert!(
        refused.to_string().contains("meeting: closure"),
        "{refused}"
    );
}

/// The rule in `db::meetings`' header, checked against its source: no line of
/// code in it names an UPDATE, a DELETE or a REPLACE. Comments may.
#[test]
fn the_module_that_writes_the_minutes_holds_no_update_delete_or_replace() {
    let source = include_str!("meetings.rs");
    let forbidden = ["update", "delete", "replace"];
    let offending: Vec<(usize, &str)> = source
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("//"))
        .filter(|(_, line)| {
            line.split(|c: char| !c.is_ascii_alphanumeric())
                .any(|word| forbidden.contains(&word.to_ascii_lowercase().as_str()))
        })
        .map(|(number, line)| (number + 1, line))
        .collect();
    assert!(
        offending.is_empty(),
        "db/meetings.rs must write by INSERT only: {offending:?}"
    );
    for table in [
        "INSERT INTO meeting\n",
        "INSERT INTO meeting_attendee",
        "INSERT INTO meeting_item",
        "INSERT INTO meeting_action\n",
        "INSERT INTO meeting_action_closure",
    ] {
        assert!(source.contains(table), "`{table}` is written here");
    }
}

/// No module but `db::meetings` names a meeting table in a statement that
/// writes.
#[test]
fn no_other_module_writes_a_meeting_table() {
    let sources = [
        ("work.rs", include_str!("work.rs")),
        ("decisions.rs", include_str!("decisions.rs")),
        ("change_orders.rs", include_str!("change_orders.rs")),
        ("snags.rs", include_str!("snags.rs")),
        ("diary.rs", include_str!("diary.rs")),
        ("documents.rs", include_str!("documents.rs")),
        ("money.rs", include_str!("money.rs")),
        ("checks.rs", include_str!("checks.rs")),
        ("templates.rs", include_str!("templates.rs")),
        ("replanning.rs", include_str!("replanning.rs")),
    ];
    for (file, source) in sources {
        let product = source.split("#[cfg(test)]").next().unwrap_or(source);
        let lower = product.to_ascii_lowercase();
        for verb in ["insert into ", "update ", "delete from ", "replace into "] {
            assert!(
                !lower.contains(&format!("{verb}meeting")),
                "{file} writes a meeting table"
            );
        }
    }
}
