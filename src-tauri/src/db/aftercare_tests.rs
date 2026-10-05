//! After the handover (slice G4): warranties and maintenance tasks are
//! editable; each time a task was done is a fact. The tests of all three, and
//! the ones that try to rewrite a time done.
//!
//! These live apart from `db::maintenance_done` on purpose. That module holds
//! no statement that edits or removes a row, by rule, and a test here reads
//! its source to prove it — so the statements that *attack* a record cannot
//! live inside it.
//!
//! Every attack is tried twice: with `recursive_triggers` on, as the product
//! opens every file, and off, as SQLite's default and any other tool would open
//! it. Each must be refused with `aftercare: append-only`, and after all of
//! them the tasks must read exactly as they did before. The rules the host says
//! first with a sentence are then tried past the host, on the schema alone.
//! Every name is synthetic.

use rusqlite::{params, Connection};

use crate::db::documents::{self, DOCUMENT_NOT_FOUND};
use crate::db::maintenance::{
    self, TaskFields, MAINTENANCE_NOT_FOUND, MAINTENANCE_ON_RECORD, MAINTENANCE_TARGET_KIND,
    ROOM_HAS_MAINTENANCE_DONE, STAGE_HAS_MAINTENANCE_DONE,
};
use crate::db::maintenance_done::{self, before_the_last, NewDone};
use crate::db::new_id;
use crate::db::order::Direction;
use crate::db::rooms::{add_room, remove_room};
use crate::db::warranties::{
    self, WarrantyFields, WARRANTY_DOCUMENT_KIND, WARRANTY_NOT_FOUND, WARRANTY_TARGET_KIND,
};
use crate::db::work::tests::a_work;
use crate::db::work::{add_stage, remove_stage, snapshot, ROOM_NOT_FOUND, STAGE_NOT_FOUND};

const REFUSAL: &str = "aftercare: append-only";

/// A work with a stage Bathroom and a stage Roof, and rooms Bathroom and
/// Kitchen. Synthetic.
struct Fixture {
    conn: Connection,
    work: String,
    bathroom_stage: String,
    roof: String,
    bathroom: String,
    kitchen: String,
}

fn fixture() -> Fixture {
    let conn = a_work();
    let work = snapshot(&conn).unwrap().work.work_id;
    let bathroom_stage = add_stage(&conn, "Bathroom").unwrap();
    let roof = add_stage(&conn, "Roof").unwrap();
    let bathroom = add_room(&conn, "Bathroom").unwrap();
    let kitchen = add_room(&conn, "Kitchen").unwrap();
    Fixture {
        conn,
        work,
        bathroom_stage,
        roof,
        bathroom,
        kitchen,
    }
}

fn warranty(kind: &str, target: &str, title: &str) -> WarrantyFields {
    WarrantyFields {
        target_kind: kind.into(),
        target_id: target.into(),
        title: title.into(),
        given_by: None,
        starts_on: "2026-03-15".into(),
        months: 24,
        document_id: None,
        note: None,
    }
}

fn task(kind: &str, target: &str, title: &str) -> TaskFields {
    TaskFields {
        target_kind: kind.into(),
        target_id: target.into(),
        title: title.into(),
        every_months: 12,
        first_due_on: "2027-03-15".into(),
        note: None,
    }
}

fn done(task: &str, day: &str) -> NewDone {
    NewDone {
        task_id: task.into(),
        done_on: day.into(),
        note: None,
        author_name: "Synthetic author".into(),
    }
}

/// A document of the work, filed as `kind`, inserted as the intake would
/// record it. The hash is synthetic.
fn a_document(conn: &Connection, kind: &str, n: u8) -> String {
    let id = new_id();
    conn.execute(
        "INSERT INTO document (id, file_hash, file_name, media_type, bytes, kind, title,
                               added_on, author_name, created_at)
         VALUES (?1, ?2, 'paper.pdf', 'application/pdf', 1000, ?3, 'Paper', '2026-03-15',
                 'Synthetic author', 't')",
        params![id, format!("{n:02x}").repeat(32), kind],
    )
    .unwrap();
    id
}

fn warranty_titles(conn: &Connection) -> Vec<(String, i64, String)> {
    snapshot(conn)
        .unwrap()
        .warranties
        .into_iter()
        .map(|w| (w.target_kind, w.position, w.title))
        .collect()
}

fn task_titles(conn: &Connection) -> Vec<(String, i64, String)> {
    snapshot(conn)
        .unwrap()
        .maintenance
        .into_iter()
        .map(|t| (t.target_kind, t.position, t.title))
        .collect()
}

#[test]
fn warranties_are_listed_by_target_and_position_written_whole_moved_and_removed() {
    let f = fixture();
    let valve = warranties::add(
        &f.conn,
        &warranty("stage", &f.bathroom_stage, "Shower valve"),
    )
    .unwrap();
    let tiles = warranties::add(&f.conn, &warranty("room", &f.bathroom, "Tiles")).unwrap();
    let grout = warranties::add(&f.conn, &warranty("room", &f.bathroom, "Grout")).unwrap();
    warranties::add(&f.conn, &warranty("room", &f.kitchen, "Oven")).unwrap();
    warranties::add(&f.conn, &warranty("work", &f.work, "The whole work")).unwrap();

    assert_eq!(
        warranty_titles(&f.conn),
        vec![
            ("work".into(), 1, "The whole work".into()),
            ("room".into(), 1, "Tiles".into()),
            ("room".into(), 2, "Grout".into()),
            ("room".into(), 1, "Oven".into()),
            ("stage".into(), 1, "Shower valve".into()),
        ],
        "the work's first, then the rooms in their order, then the stages"
    );

    warranties::update(
        &f.conn,
        &tiles,
        &WarrantyFields {
            given_by: Some("The tiler".into()),
            starts_on: "2026-04-01".into(),
            months: 600,
            note: Some("Register online.\nKeep the receipt.".into()),
            ..warranty("room", &f.bathroom, "Wall tiles")
        },
    )
    .unwrap();
    warranties::move_one(&f.conn, &grout, Direction::Up).unwrap();
    let plan = snapshot(&f.conn).unwrap();
    let written = plan.warranties.iter().find(|w| w.id == tiles).unwrap();
    assert_eq!(
        (
            written.position,
            written.title.as_str(),
            written.given_by.as_deref(),
            written.starts_on.as_str(),
            written.months,
            written.note.as_deref(),
            written.document_id.as_deref(),
        ),
        (
            2,
            "Wall tiles",
            Some("The tiler"),
            "2026-04-01",
            600,
            Some("Register online.\nKeep the receipt."),
            None
        )
    );
    assert_eq!(plan.warranties[1].id, grout, "moved up among its room's");

    // Moved to another target: the end of that target's, and the gap closes.
    warranties::update(&f.conn, &grout, &warranty("room", &f.kitchen, "Grout")).unwrap();
    assert_eq!(
        warranty_titles(&f.conn),
        vec![
            ("work".into(), 1, "The whole work".into()),
            ("room".into(), 1, "Wall tiles".into()),
            ("room".into(), 1, "Oven".into()),
            ("room".into(), 2, "Grout".into()),
            ("stage".into(), 1, "Shower valve".into()),
        ]
    );

    warranties::remove(&f.conn, &valve).unwrap();
    assert_eq!(snapshot(&f.conn).unwrap().warranties.len(), 4);

    let nobody = new_id();
    for (refused, sentence) in [
        (
            warranties::update(&f.conn, &nobody, &warranty("work", &f.work, "X")),
            WARRANTY_NOT_FOUND,
        ),
        (warranties::remove(&f.conn, &nobody), WARRANTY_NOT_FOUND),
        (
            warranties::move_one(&f.conn, &nobody, Direction::Down),
            WARRANTY_NOT_FOUND,
        ),
        (
            warranties::add(&f.conn, &warranty("activity", &f.roof, "X")).map(|_| ()),
            WARRANTY_TARGET_KIND,
        ),
        (
            warranties::add(&f.conn, &warranty("room", &f.roof, "X")).map(|_| ()),
            ROOM_NOT_FOUND,
        ),
        (
            warranties::add(&f.conn, &warranty("stage", &f.kitchen, "X")).map(|_| ()),
            STAGE_NOT_FOUND,
        ),
        (
            warranties::update(&f.conn, &tiles, &warranty("stage", &nobody, "X")),
            STAGE_NOT_FOUND,
        ),
    ] {
        let refused = refused.unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
    assert_eq!(snapshot(&f.conn).unwrap().warranties.len(), 4);
}

/// The paper is a document of the work filed as a warranty — refused
/// otherwise by the host and the schema; let go of when it is removed or filed
/// again as another kind.
#[test]
fn a_warranty_paper_is_a_document_filed_as_a_warranty_and_is_let_go_of_when_it_is_not() {
    let f = fixture();
    let paper = a_document(&f.conn, "warranty", 1);
    let photo = a_document(&f.conn, "photo", 2);
    let manual = a_document(&f.conn, "manual", 3);

    for (document, sentence) in [
        (&photo, WARRANTY_DOCUMENT_KIND),
        (&manual, WARRANTY_DOCUMENT_KIND),
        (&new_id(), DOCUMENT_NOT_FOUND),
    ] {
        let refused = warranties::add(
            &f.conn,
            &WarrantyFields {
                document_id: Some(document.clone()),
                ..warranty("room", &f.bathroom, "Tiles")
            },
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
    assert!(snapshot(&f.conn).unwrap().warranties.is_empty());
    assert_eq!(
        WARRANTY_DOCUMENT_KIND,
        "That document is not filed as a warranty: a warranty's paper is a document of the kind warranty."
    );

    let with_paper = WarrantyFields {
        document_id: Some(paper.clone()),
        ..warranty("room", &f.bathroom, "Tiles")
    };
    let tiles = warranties::add(&f.conn, &with_paper).unwrap();
    let boiler = warranties::add(
        &f.conn,
        &WarrantyFields {
            document_id: Some(paper.clone()),
            ..warranty("work", &f.work, "Boiler")
        },
    )
    .unwrap();
    let refused = warranties::update(
        &f.conn,
        &tiles,
        &WarrantyFields {
            document_id: Some(photo.clone()),
            ..warranty("room", &f.bathroom, "Tiles")
        },
    )
    .unwrap_err();
    assert_eq!(refused.to_string(), WARRANTY_DOCUMENT_KIND);

    // Past the host.
    for sql in [
        "UPDATE warranty SET document_id = ?1",
        "INSERT INTO warranty (id, target_kind, target_id, position, title, starts_on, months,
                               document_id, created_at)
         VALUES ('00000000-0000-7000-8000-0000000000f1', 'work', 'w', 9, 'X', '2026-01-01', 1,
                 ?1, 't')",
    ] {
        for document in [&photo, &new_id()] {
            let refused = f.conn.execute(sql, [document]).unwrap_err();
            assert!(
                refused.to_string().contains("aftercare: document"),
                "{sql}: {refused}"
            );
        }
    }
    let documents_of = |conn: &Connection| -> Vec<Option<String>> {
        snapshot(conn)
            .unwrap()
            .warranties
            .into_iter()
            .map(|w| w.document_id)
            .collect()
    };
    assert_eq!(
        documents_of(&f.conn),
        vec![Some(paper.clone()), Some(paper.clone())],
        "the work's Boiler, then the room's Tiles"
    );

    // Filed again as another kind: let go of. Filed as a warranty again: not
    // taken back — a warranty names its paper by a choice.
    documents::update(&f.conn, &paper, Some("Renamed"), None).unwrap();
    assert_eq!(documents_of(&f.conn), vec![Some(paper.clone()); 2]);
    documents::update(&f.conn, &paper, None, Some("receipt")).unwrap();
    assert_eq!(documents_of(&f.conn), vec![None, None]);
    documents::update(&f.conn, &paper, None, Some("warranty")).unwrap();
    assert_eq!(documents_of(&f.conn), vec![None, None]);

    // Removed: let go of, the warranty kept.
    warranties::update(&f.conn, &tiles, &with_paper).unwrap();
    assert_eq!(documents_of(&f.conn), vec![None, Some(paper.clone())]);
    documents::remove(&f.conn, &paper).unwrap();
    assert_eq!(documents_of(&f.conn), vec![None, None]);
    assert_eq!(
        snapshot(&f.conn)
            .unwrap()
            .warranties
            .iter()
            .map(|w| w.id.clone())
            .collect::<Vec<_>>(),
        vec![boiler, tiles]
    );
}

#[test]
fn tasks_are_listed_by_target_and_position_written_whole_moved_and_removed() {
    let f = fixture();
    let reseal =
        maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal the shower")).unwrap();
    let descale =
        maintenance::add(&f.conn, &task("room", &f.bathroom, "Descale the head")).unwrap();
    let gutters = maintenance::add(&f.conn, &task("stage", &f.roof, "Clean the gutters")).unwrap();
    maintenance::add(&f.conn, &task("work", &f.work, "Service the boiler")).unwrap();

    maintenance::update(
        &f.conn,
        &gutters,
        &TaskFields {
            every_months: 6,
            first_due_on: "2026-11-01".into(),
            note: Some("Before the autumn rain.".into()),
            ..task("stage", &f.roof, "Clean the gutters and downpipes")
        },
    )
    .unwrap();
    maintenance::move_one(&f.conn, &descale, Direction::Up).unwrap();
    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(
        plan.maintenance
            .iter()
            .map(|t| (t.target_kind.as_str(), t.position, t.title.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("work", 1, "Service the boiler"),
            ("room", 1, "Descale the head"),
            ("room", 2, "Reseal the shower"),
            ("stage", 1, "Clean the gutters and downpipes"),
        ]
    );
    let roof = &plan.maintenance[3];
    assert_eq!(
        (
            roof.every_months,
            roof.first_due_on.as_str(),
            roof.note.as_deref()
        ),
        (6, "2026-11-01", Some("Before the autumn rain."))
    );
    assert!(plan.maintenance.iter().all(|t| t.done.is_empty()));

    // Moved to the kitchen: the end of its tasks; the bathroom's close up.
    maintenance::update(
        &f.conn,
        &descale,
        &task("room", &f.kitchen, "Descale the head"),
    )
    .unwrap();
    assert_eq!(
        task_titles(&f.conn),
        vec![
            ("work".into(), 1, "Service the boiler".into()),
            ("room".into(), 1, "Reseal the shower".into()),
            ("room".into(), 1, "Descale the head".into()),
            ("stage".into(), 1, "Clean the gutters and downpipes".into()),
        ]
    );

    maintenance::remove(&f.conn, &reseal).expect("never done");
    assert_eq!(snapshot(&f.conn).unwrap().maintenance.len(), 3);

    let nobody = new_id();
    for (refused, sentence) in [
        (
            maintenance::update(&f.conn, &nobody, &task("work", &f.work, "X")),
            MAINTENANCE_NOT_FOUND,
        ),
        (maintenance::remove(&f.conn, &nobody), MAINTENANCE_NOT_FOUND),
        (
            maintenance::move_one(&f.conn, &nobody, Direction::Up),
            MAINTENANCE_NOT_FOUND,
        ),
        (
            maintenance::add(&f.conn, &task("decision", &f.roof, "X")).map(|_| ()),
            MAINTENANCE_TARGET_KIND,
        ),
        (
            maintenance::add(&f.conn, &task("room", &nobody, "X")).map(|_| ()),
            ROOM_NOT_FOUND,
        ),
    ] {
        let refused = refused.unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
}

/// A task done, then done again: each time recorded in order, one sequence per
/// task; its frequency still changes.
#[test]
fn each_time_a_task_is_done_is_recorded_in_order_with_its_own_sequence() {
    let f = fixture();
    let reseal =
        maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal the shower")).unwrap();
    let gutters = maintenance::add(&f.conn, &task("stage", &f.roof, "Clean the gutters")).unwrap();

    assert_eq!(
        maintenance_done::append(&f.conn, &done(&reseal, "2026-03-15")).unwrap(),
        1
    );
    assert_eq!(
        maintenance_done::append(&f.conn, &done(&gutters, "2026-04-01")).unwrap(),
        1
    );
    maintenance_done::append(
        &f.conn,
        &NewDone {
            note: Some("Silicone, white.".into()),
            ..done(&reseal, "2027-03-20")
        },
    )
    .unwrap();
    assert_eq!(
        maintenance_done::append(&f.conn, &done(&reseal, "2027-03-20")).unwrap(),
        3,
        "the same day as the time before is another time"
    );
    maintenance::update(
        &f.conn,
        &reseal,
        &TaskFields {
            every_months: 18,
            ..task("room", &f.bathroom, "Reseal the shower")
        },
    )
    .expect("a task done still changes its frequency");

    let plan = snapshot(&f.conn).unwrap();
    let records = |at: usize| -> Vec<(i64, String)> {
        plan.maintenance[at]
            .done
            .iter()
            .map(|d| (d.seq, d.done_on.clone()))
            .collect()
    };
    assert_eq!(plan.maintenance[0].id, reseal);
    assert_eq!(plan.maintenance[0].every_months, 18);
    assert_eq!(
        records(0),
        vec![
            (1, "2026-03-15".into()),
            (2, "2027-03-20".into()),
            (3, "2027-03-20".into())
        ]
    );
    assert_eq!(records(1), vec![(1, "2026-04-01".into())]);
    let second = &plan.maintenance[0].done[1];
    assert_eq!(
        (
            second.task_id.as_str(),
            second.note.as_deref(),
            second.author_name.as_str()
        ),
        (
            reseal.as_str(),
            Some("Silicone, white."),
            "Synthetic author"
        )
    );
}

#[test]
fn the_repository_refuses_a_time_before_the_last_with_a_sentence_naming_the_task() {
    let f = fixture();
    let reseal =
        maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal the shower")).unwrap();
    maintenance_done::append(&f.conn, &done(&reseal, "2026-10-01")).unwrap();
    let before = snapshot(&f.conn).unwrap().maintenance;

    let refused = maintenance_done::append(&f.conn, &done(&reseal, "2026-09-30")).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(
        refused.to_string(),
        "“Reseal the shower” was last done on 2026-10-01: the next time is on that day or later."
    );
    assert_eq!(
        refused.to_string(),
        before_the_last("Reseal the shower", "2026-10-01")
    );
    let refused = maintenance_done::append(&f.conn, &done(&new_id(), "2026-10-01")).unwrap_err();
    assert_eq!(refused.to_string(), MAINTENANCE_NOT_FOUND);
    assert_eq!(
        snapshot(&f.conn).unwrap().maintenance,
        before,
        "nothing written on a refusal"
    );
}

/// A task done is kept, and so is the room or the stage it is on — by the
/// host with a sentence, and by the schema after it.
#[test]
fn a_task_done_is_never_removed_and_neither_is_its_room_or_stage() {
    let f = fixture();
    let reseal =
        maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal the shower")).unwrap();
    let gutters = maintenance::add(&f.conn, &task("stage", &f.roof, "Clean the gutters")).unwrap();
    warranties::add(&f.conn, &warranty("room", &f.bathroom, "Tiles")).unwrap();
    maintenance_done::append(&f.conn, &done(&reseal, "2026-10-01")).unwrap();
    maintenance_done::append(&f.conn, &done(&gutters, "2026-10-02")).unwrap();

    for (refused, sentence) in [
        (maintenance::remove(&f.conn, &reseal), MAINTENANCE_ON_RECORD),
        (
            maintenance::remove(&f.conn, &gutters),
            MAINTENANCE_ON_RECORD,
        ),
        (remove_room(&f.conn, &f.bathroom), ROOM_HAS_MAINTENANCE_DONE),
        (remove_stage(&f.conn, &f.roof), STAGE_HAS_MAINTENANCE_DONE),
    ] {
        let refused = refused.unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
    assert_eq!(
        (
            MAINTENANCE_ON_RECORD,
            ROOM_HAS_MAINTENANCE_DONE,
            STAGE_HAS_MAINTENANCE_DONE
        ),
        (
            "That task has been done, and each time is on record: it cannot be removed.",
            "A maintenance task on this room has been done, and each time is on record: the room cannot be removed.",
            "A maintenance task on this stage has been done, and each time is on record: the stage cannot be removed."
        )
    );

    // Past the host.
    let refused = f
        .conn
        .execute("DELETE FROM maintenance_task WHERE id = ?1", [&reseal])
        .unwrap_err();
    assert!(refused.to_string().contains("FOREIGN KEY"), "{refused}");
    for (table, id) in [("room", &f.bathroom), ("stage", &f.roof)] {
        let refused = f
            .conn
            .execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
            .unwrap_err();
        assert!(
            refused.to_string().contains("aftercare: done on record"),
            "{table}: {refused}"
        );
    }
    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(plan.rooms.len(), 2);
    assert_eq!(plan.stages.len(), 2);
    assert_eq!(plan.maintenance.len(), 2);
    assert_eq!(plan.warranties.len(), 1);

    // The room and the stage without a task done still go.
    remove_room(&f.conn, &f.kitchen).unwrap();
    remove_stage(&f.conn, &f.bathroom_stage).unwrap();
}

/// A room or a stage removed takes its warranties and its tasks never done
/// with it; the others stay where they were.
#[test]
fn a_removed_room_or_stage_takes_its_warranties_and_tasks_and_leaves_the_others() {
    let f = fixture();
    warranties::add(&f.conn, &warranty("room", &f.bathroom, "Tiles")).unwrap();
    warranties::add(&f.conn, &warranty("room", &f.kitchen, "Oven")).unwrap();
    warranties::add(&f.conn, &warranty("stage", &f.roof, "Roof membrane")).unwrap();
    warranties::add(
        &f.conn,
        &warranty("stage", &f.bathroom_stage, "Shower valve"),
    )
    .unwrap();
    warranties::add(&f.conn, &warranty("work", &f.work, "The whole work")).unwrap();
    maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal the shower")).unwrap();
    maintenance::add(&f.conn, &task("room", &f.kitchen, "Clean the hood filter")).unwrap();
    maintenance::add(&f.conn, &task("stage", &f.roof, "Clean the gutters")).unwrap();
    maintenance::add(&f.conn, &task("work", &f.work, "Service the boiler")).unwrap();

    remove_room(&f.conn, &f.bathroom).unwrap();
    remove_stage(&f.conn, &f.roof).unwrap();

    let left = |rows: Vec<(String, i64, String)>| -> Vec<String> {
        rows.into_iter().map(|(_, _, title)| title).collect()
    };
    assert_eq!(
        left(warranty_titles(&f.conn)),
        vec!["The whole work", "Oven", "Shower valve"]
    );
    assert_eq!(
        left(task_titles(&f.conn)),
        vec!["Service the boiler", "Clean the hood filter"]
    );
    for table in ["warranty", "maintenance_task"] {
        let orphans: i64 = f
            .conn
            .query_row(
                &format!(
                    "SELECT count(*) FROM {table}
                     WHERE (target_kind = 'room' AND target_id NOT IN (SELECT id FROM room))
                        OR (target_kind = 'stage' AND target_id NOT IN (SELECT id FROM stage))"
                ),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 0, "{table} names nothing that is gone");
    }
}

/// The schema keeps a warranty's and a task's shape, past the host.
#[test]
fn the_schema_refuses_a_warranty_or_a_task_out_of_shape() {
    let f = fixture();
    warranties::add(&f.conn, &warranty("room", &f.bathroom, "Tiles")).unwrap();
    let reseal = maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal")).unwrap();
    for sql in [
        "UPDATE warranty SET months = 0".to_string(),
        "UPDATE warranty SET months = 601".to_string(),
        "UPDATE warranty SET months = 1.5".to_string(),
        "UPDATE warranty SET title = '  '".to_string(),
        format!("UPDATE warranty SET title = '{}'", "t".repeat(201)),
        "UPDATE warranty SET given_by = ''".to_string(),
        format!("UPDATE warranty SET given_by = '{}'", "g".repeat(121)),
        "UPDATE warranty SET note = ''".to_string(),
        format!("UPDATE warranty SET note = '{}'", "n".repeat(1001)),
        "UPDATE warranty SET starts_on = '2026-02-30'".to_string(),
        "UPDATE warranty SET starts_on = '2026-2-3'".to_string(),
        "UPDATE warranty SET target_kind = 'activity'".to_string(),
        "UPDATE warranty SET position = 0".to_string(),
        "UPDATE maintenance_task SET every_months = 0".to_string(),
        "UPDATE maintenance_task SET every_months = 121".to_string(),
        "UPDATE maintenance_task SET every_months = 0.5".to_string(),
        "UPDATE maintenance_task SET title = ''".to_string(),
        format!("UPDATE maintenance_task SET title = '{}'", "t".repeat(201)),
        format!("UPDATE maintenance_task SET note = '{}'", "n".repeat(1001)),
        "UPDATE maintenance_task SET first_due_on = '2027-13-01'".to_string(),
        "UPDATE maintenance_task SET first_due_on = '27-03-15'".to_string(),
        "UPDATE maintenance_task SET target_kind = 'decision'".to_string(),
        "UPDATE maintenance_task SET position = -1".to_string(),
    ] {
        assert!(f.conn.execute(&sql, []).is_err(), "{sql}");
    }
    for sql in [
        "UPDATE warranty SET months = 600, given_by = 'The installer'",
        "UPDATE maintenance_task SET every_months = 120",
    ] {
        f.conn
            .execute(sql, [])
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    }
    for (day, note) in [
        ("2026-02-30", None),
        ("2026-2-3", None),
        ("2026-10-01", Some(String::new())),
        ("2026-10-01", Some("n".repeat(501))),
    ] {
        assert!(
            f.conn
                .execute(
                    "INSERT INTO maintenance_done (task_id, seq, done_on, note, author_name,
                                                   created_at)
                     VALUES (?1, 1, ?2, ?3, 'x', 't')",
                    params![reseal, day, note],
                )
                .is_err(),
            "{day} {note:?}"
        );
    }
    let refused = f
        .conn
        .execute(
            "INSERT INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
             VALUES (?1, 1, '2026-10-01', 'x', 't')",
            [new_id()],
        )
        .unwrap_err();
    assert!(
        refused.to_string().contains("FOREIGN KEY"),
        "a task not in the work: {refused}"
    );
}

fn insert_done(conn: &Connection, task: &str, seq: i64, day: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
         VALUES (?1, ?2, ?3, 'x', 't')",
        params![task, seq, day],
    )
}

/// The order of the times is the schema's as well as the host's.
#[test]
fn the_schema_refuses_a_time_before_the_last_past_the_host() {
    let f = fixture();
    let reseal = maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal")).unwrap();
    insert_done(&f.conn, &reseal, 1, "2026-10-01").expect("the first");
    let refused = insert_done(&f.conn, &reseal, 2, "2026-09-30").unwrap_err();
    assert!(
        refused.to_string().contains("aftercare: out of order"),
        "{refused}"
    );
    insert_done(&f.conn, &reseal, 2, "2026-10-01").expect("the same day");
    insert_done(&f.conn, &reseal, 3, "2027-10-01").expect("a year on");
    let refused = insert_done(&f.conn, &reseal, 4, "2027-01-01").unwrap_err();
    assert!(
        refused.to_string().contains("aftercare: out of order"),
        "before the last, after an earlier one: {refused}"
    );
}

/// Every way SQL can rewrite a time done, with `recursive_triggers` on and
/// off.
#[test]
fn every_update_delete_replace_and_upsert_of_a_time_done_is_refused_whatever_the_pragmas() {
    let f = fixture();
    let reseal = maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal")).unwrap();
    let gutters = maintenance::add(&f.conn, &task("stage", &f.roof, "Gutters")).unwrap();
    let boiler = maintenance::add(&f.conn, &task("work", &f.work, "Boiler")).unwrap();
    maintenance_done::append(&f.conn, &done(&reseal, "2026-03-15")).unwrap();
    maintenance_done::append(&f.conn, &done(&reseal, "2026-09-15")).unwrap();
    maintenance_done::append(&f.conn, &done(&gutters, "2026-04-01")).unwrap();
    let before = snapshot(&f.conn).unwrap().maintenance;

    let attacks = [
        "UPDATE maintenance_done SET done_on = '2026-01-01'".to_string(),
        format!("UPDATE maintenance_done SET note = 'Rewritten' WHERE task_id = '{reseal}'"),
        "UPDATE maintenance_done SET author_name = 'Somebody else'".to_string(),
        format!(
            "UPDATE OR REPLACE maintenance_done SET seq = 1 WHERE task_id = '{reseal}' AND seq = 2"
        ),
        format!("UPDATE maintenance_done SET task_id = '{boiler}' WHERE task_id = '{gutters}'"),
        "DELETE FROM maintenance_done".to_string(),
        format!("DELETE FROM maintenance_done WHERE task_id = '{reseal}' AND seq = 2"),
        format!(
            "INSERT OR REPLACE INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
             VALUES ('{reseal}', 2, '2026-12-01', 'x', 't')"
        ),
        format!(
            "REPLACE INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
             VALUES ('{gutters}', 1, '2026-04-02', 'x', 't')"
        ),
        format!(
            "INSERT INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
             VALUES ('{reseal}', 1, '2026-03-15', 'x', 't')
             ON CONFLICT (task_id, seq) DO UPDATE SET done_on = '2026-03-16'"
        ),
        // A seq that does not continue: a gap, or one from the past.
        format!(
            "INSERT INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
             VALUES ('{reseal}', 9, '2026-12-01', 'x', 't')"
        ),
        format!(
            "INSERT INTO maintenance_done (task_id, seq, done_on, author_name, created_at)
             VALUES ('{boiler}', 2, '2026-12-01', 'x', 't')"
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
        snapshot(&f.conn).unwrap().maintenance,
        before,
        "every task and every time done reads as it did"
    );
}

/// Why the records carry a `BEFORE INSERT` guard as well as their `BEFORE
/// DELETE` trigger: with `recursive_triggers` off, a `REPLACE` removes the row
/// it replaces without firing a DELETE trigger. The guard is taken away here,
/// on this connection only, to show the hole it closes.
#[test]
fn without_the_insert_guard_a_replace_would_rewrite_a_time_done_when_recursive_triggers_are_off() {
    let f = fixture();
    let reseal = maintenance::add(&f.conn, &task("room", &f.bathroom, "Reseal")).unwrap();
    maintenance_done::append(&f.conn, &done(&reseal, "2026-03-15")).unwrap();
    f.conn
        .execute_batch(
            "DROP TRIGGER maintenance_done_no_replace; DROP TRIGGER maintenance_done_continues;",
        )
        .unwrap();
    f.conn
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();
    f.conn
        .execute(
            "INSERT OR REPLACE INTO maintenance_done
               (task_id, seq, done_on, author_name, created_at)
             VALUES (?1, 1, '2025-01-01', 'Somebody', 't')",
            [&reseal],
        )
        .expect("the hole: the time done is replaced and no trigger saw it go");
    let day: String = f
        .conn
        .query_row(
            "SELECT done_on FROM maintenance_done WHERE task_id = ?1 AND seq = 1",
            [&reseal],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(day, "2025-01-01");
}

/// The rule in `db::maintenance_done`'s header, checked against its source.
#[test]
fn the_module_that_writes_the_times_done_holds_no_update_delete_or_replace() {
    let source = include_str!("maintenance_done.rs");
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
        "db/maintenance_done.rs must write by INSERT only: {offending:?}"
    );
    assert!(source.contains("INSERT INTO maintenance_done"));
}

/// No module but `db::maintenance_done` names the records' table in a
/// statement that writes.
#[test]
fn no_other_module_writes_the_times_done() {
    let sources = [
        ("maintenance.rs", include_str!("maintenance.rs")),
        ("warranties.rs", include_str!("warranties.rs")),
        ("work.rs", include_str!("work.rs")),
        ("rooms.rs", include_str!("rooms.rs")),
        ("order.rs", include_str!("order.rs")),
        ("templates.rs", include_str!("templates.rs")),
        ("documents.rs", include_str!("documents.rs")),
    ];
    for (file, source) in sources {
        let product = source.split("#[cfg(test)]").next().unwrap_or(source);
        let lower = product.to_ascii_lowercase();
        for verb in ["insert into ", "update ", "delete from ", "replace into "] {
            assert!(
                !lower.contains(&format!("{verb}maintenance_done")),
                "{file} writes the times done"
            );
        }
    }
}
