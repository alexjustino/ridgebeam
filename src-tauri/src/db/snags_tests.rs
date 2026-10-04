//! Snags are facts: the tests that try to rewrite one (slice E4), and the
//! retention trigger the payment plan gains with them.
//!
//! These live apart from `db::snags` on purpose. That module holds no statement
//! that edits or removes a row, by rule, and a test here reads its source to
//! prove it — so the statements that *attack* a snag cannot live inside it.
//!
//! Every attack is tried twice: with `recursive_triggers` on, as the product
//! opens every file, and off, as SQLite's default and any other tool would open
//! it. Each must be refused with `snag: append-only`, and after all of them the
//! snags must read exactly as they did before. The rules the host says first
//! with a sentence are then tried past the host, on the schema alone.

use rusqlite::Connection;

use crate::db::milestones::{self, MilestoneFields, ACTIVITY_NOT_WANTED};
use crate::db::money::{add_commitment, CommitmentFields, ACTIVITY_OF_ANOTHER_STAGE};
use crate::db::snags::{
    self, NewClosure, NewSnag, Outcome, FIXED_NEEDS_PHOTO, PHOTO_NOT_AN_IMAGE, SNAG_NOT_FOUND,
    WITHDRAWN_NEEDS_NOTE,
};
use crate::db::work::tests::a_work;
use crate::db::work::{
    add_activity, add_person, add_stage, snapshot, ACTIVITY_NOT_FOUND, PERSON_NOT_FOUND,
    STAGE_NOT_FOUND,
};
use crate::db::{checks, documents, new_id};
use crate::files::intake::NOT_A_PHOTO;

const REFUSAL: &str = "snag: append-only";

/// A photo of the problem, and one of it fixed — documents of the work.
const BEFORE: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const AFTER: &str = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
/// A permit, a PDF document of the work.
const PERMIT: &str = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";

/// A work with a stage Tiling (one activity), a stage Painting, a tiler, and
/// three documents: two photos and a PDF. Synthetic.
struct Fixture {
    conn: Connection,
    tiling: String,
    painting: String,
    lay: String,
    paint: String,
    tiler: String,
}

fn document(conn: &Connection, hash: &str, media_type: &str) {
    let (width, height) = if media_type.starts_with("image/") {
        ("640", "480")
    } else {
        ("NULL", "NULL")
    };
    conn.execute(
        &format!(
            "INSERT INTO document (id, file_hash, file_name, media_type, bytes, width, height,
                                   kind, title, added_on, author_name, created_at)
             VALUES ('{}', '{hash}', 'file', '{media_type}', 2048, {width}, {height}, 'photo',
                     'A file', '2026-10-05', 'Synthetic author', 't')",
            new_id()
        ),
        [],
    )
    .unwrap();
}

fn fixture() -> Fixture {
    let conn = a_work();
    let tiling = add_stage(&conn, "Tiling").unwrap();
    let painting = add_stage(&conn, "Painting").unwrap();
    let lay = add_activity(&conn, &tiling, "Lay the tiles").unwrap();
    let paint = add_activity(&conn, &painting, "Paint the walls").unwrap();
    let tiler = add_person(&conn, "A. Tiler (synthetic)").unwrap();
    document(&conn, BEFORE, "image/jpeg");
    document(&conn, AFTER, "image/png");
    document(&conn, PERMIT, "application/pdf");
    Fixture {
        conn,
        tiling,
        painting,
        lay,
        paint,
        tiler,
    }
}

fn snag(f: &Fixture, title: &str) -> NewSnag {
    NewSnag {
        raised_on: "2026-10-06".into(),
        title: title.into(),
        description: None,
        stage_id: f.tiling.clone(),
        activity_id: Some(f.lay.clone()),
        person_id: Some(f.tiler.clone()),
        due_on: Some("2026-10-10".into()),
        photo_hash: Some(BEFORE.into()),
        author_name: "Synthetic author".into(),
    }
}

fn fixed(id: &str) -> NewClosure {
    NewClosure {
        snag_id: id.into(),
        outcome: Outcome::Fixed,
        closed_on: "2026-10-08".into(),
        photo_hash: Some(AFTER.into()),
        note: None,
        author_name: "Synthetic author".into(),
    }
}

fn withdrawn(id: &str) -> NewClosure {
    NewClosure {
        outcome: Outcome::Withdrawn,
        photo_hash: None,
        note: Some("Raised by mistake: it was the shadow.".into()),
        ..fixed(id)
    }
}

/// Two snags, the first fixed and the second withdrawn.
fn closed(f: &Fixture) -> (String, String) {
    snags::raise(&f.conn, &snag(f, "Cracked tile by the drain")).unwrap();
    snags::raise(&f.conn, &snag(f, "Grout missing in the corner")).unwrap();
    let list = snags::list(&f.conn).unwrap();
    let (first, second) = (list[0].id.clone(), list[1].id.clone());
    snags::close(&f.conn, &fixed(&first)).unwrap();
    snags::close(&f.conn, &withdrawn(&second)).unwrap();
    (first, second)
}

#[test]
fn a_snag_is_raised_numbered_and_closed_once_and_reads_back_whole() {
    let f = fixture();
    assert_eq!(
        snags::raise(&f.conn, &snag(&f, "Cracked tile by the drain")).unwrap(),
        1
    );
    let bare = NewSnag {
        description: Some("Found again after #1 — the same corner.".into()),
        stage_id: f.painting.clone(),
        activity_id: None,
        person_id: None,
        due_on: None,
        photo_hash: None,
        ..snag(&f, "Paint drip on the door")
    };
    assert_eq!(snags::raise(&f.conn, &bare).unwrap(), 2);

    let list = snags::list(&f.conn).unwrap();
    assert_eq!(
        list.iter()
            .map(|s| (s.number, s.title.as_str(), s.closure.is_none()))
            .collect::<Vec<_>>(),
        vec![
            (1, "Cracked tile by the drain", true),
            (2, "Paint drip on the door", true)
        ]
    );
    let first = &list[0];
    assert_eq!(
        (
            first.stage_id.as_str(),
            first.activity_id.as_deref(),
            first.person_id.as_deref(),
            first.raised_on.as_str(),
            first.due_on.as_deref(),
            first.photo_hash.as_deref(),
            first.author_name.as_str(),
        ),
        (
            f.tiling.as_str(),
            Some(f.lay.as_str()),
            Some(f.tiler.as_str()),
            "2026-10-06",
            Some("2026-10-10"),
            Some(BEFORE),
            "Synthetic author",
        )
    );
    assert_eq!(
        (list[1].activity_id.clone(), list[1].person_id.clone()),
        (None, None)
    );

    snags::close(&f.conn, &fixed(&first.id)).unwrap();
    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(plan.snags, snags::list(&f.conn).unwrap(), "in the snapshot");
    let closure = plan.snags[0].closure.as_ref().unwrap();
    assert_eq!(
        (
            closure.outcome.as_str(),
            closure.closed_on.as_str(),
            closure.photo_hash.as_deref(),
            closure.note.as_deref()
        ),
        ("fixed", "2026-10-08", Some(AFTER), None)
    );
    assert!(plan.snags[1].closure.is_none(), "the other is still open");
}

/// The host's own refusals, at the repository, each writing nothing.
#[test]
fn the_repository_refuses_what_is_not_in_the_work_and_a_second_closure() {
    let f = fixture();
    let nobody = new_id();
    for (draft, sentence) in [
        (
            NewSnag {
                stage_id: nobody.clone(),
                ..snag(&f, "X")
            },
            STAGE_NOT_FOUND.to_string(),
        ),
        (
            NewSnag {
                activity_id: Some(nobody.clone()),
                ..snag(&f, "X")
            },
            ACTIVITY_NOT_FOUND.to_string(),
        ),
        (
            NewSnag {
                activity_id: Some(f.paint.clone()),
                ..snag(&f, "X")
            },
            ACTIVITY_OF_ANOTHER_STAGE.to_string(),
        ),
        (
            NewSnag {
                person_id: Some(nobody.clone()),
                ..snag(&f, "X")
            },
            PERSON_NOT_FOUND.to_string(),
        ),
        (
            NewSnag {
                photo_hash: Some("d4".repeat(32)),
                ..snag(&f, "X")
            },
            NOT_A_PHOTO.to_string(),
        ),
        (
            NewSnag {
                photo_hash: Some(PERMIT.into()),
                ..snag(&f, "X")
            },
            PHOTO_NOT_AN_IMAGE.to_string(),
        ),
    ] {
        let refused = snags::raise(&f.conn, &draft).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{draft:?}");
        assert_eq!(refused.to_string(), sentence, "{draft:?}");
    }
    assert!(snags::list(&f.conn).unwrap().is_empty(), "nothing written");

    snags::raise(&f.conn, &snag(&f, "Cracked tile")).unwrap();
    let id = snags::list(&f.conn).unwrap()[0].id.clone();
    for (closure, sentence) in [
        (fixed(&nobody), SNAG_NOT_FOUND.to_string()),
        (
            NewClosure {
                closed_on: "2026-10-05".into(),
                ..fixed(&id)
            },
            snags::closed_before_raised(1, "2026-10-06"),
        ),
        (
            NewClosure {
                photo_hash: None,
                ..fixed(&id)
            },
            FIXED_NEEDS_PHOTO.to_string(),
        ),
        (
            NewClosure {
                note: None,
                ..withdrawn(&id)
            },
            WITHDRAWN_NEEDS_NOTE.to_string(),
        ),
        (
            NewClosure {
                photo_hash: Some(PERMIT.into()),
                ..fixed(&id)
            },
            PHOTO_NOT_AN_IMAGE.to_string(),
        ),
        (
            NewClosure {
                photo_hash: Some("e5".repeat(32)),
                ..fixed(&id)
            },
            NOT_A_PHOTO.to_string(),
        ),
    ] {
        let refused = snags::close(&f.conn, &closure).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{closure:?}");
        assert_eq!(refused.to_string(), sentence, "{closure:?}");
    }
    assert!(snags::list(&f.conn).unwrap()[0].closure.is_none());

    snags::close(
        &f.conn,
        &NewClosure {
            closed_on: "2026-10-06".into(),
            ..fixed(&id)
        },
    )
    .expect("closed on the day it was raised");
    for again in [fixed(&id), withdrawn(&id)] {
        assert_eq!(
            snags::close(&f.conn, &again).unwrap_err().to_string(),
            snags::already_closed(1, "fixed", "2026-10-06")
        );
    }
}

/// Snags are found after closing: a closed stage takes one, and its closure.
#[test]
fn a_closed_stage_takes_a_snag_and_its_closure() {
    let f = fixture();
    checks::start(&f.conn, &f.tiling).unwrap();
    checks::close(&f.conn, &f.tiling).unwrap();
    assert!(snapshot(&f.conn).unwrap().stages[0].closed_at.is_some());

    snags::raise(&f.conn, &snag(&f, "Cracked tile")).expect("a closed stage");
    let id = snags::list(&f.conn).unwrap()[0].id.clone();
    snags::close(&f.conn, &fixed(&id)).expect("and its closure");
}

/// Every way SQL can rewrite a snag or its closure, with `recursive_triggers`
/// on and off.
#[test]
fn every_update_delete_and_replace_of_a_snag_is_refused_whatever_the_pragmas() {
    let f = fixture();
    let (first, second) = closed(&f);
    let before = snags::list(&f.conn).unwrap();
    let stage = &f.tiling;

    let attacks = [
        format!("UPDATE snag SET title = 'Rewritten' WHERE id = '{first}'"),
        "UPDATE snag SET person_id = NULL".to_string(),
        "UPDATE snag SET due_on = '2027-01-01'".to_string(),
        format!("UPDATE snag SET number = 9 WHERE id = '{second}'"),
        format!("UPDATE OR REPLACE snag SET number = 1 WHERE id = '{second}'"),
        format!("DELETE FROM snag WHERE id = '{second}'"),
        "DELETE FROM snag".to_string(),
        format!(
            "INSERT OR REPLACE INTO snag
               (id, number, title, stage_id, raised_on, author_name, created_at)
             VALUES ('{first}', 1, 'Rewritten', '{stage}', '2026-10-06', 'Somebody', 't')"
        ),
        format!(
            "REPLACE INTO snag (id, number, title, stage_id, raised_on, author_name, created_at)
             VALUES ('{}', 2, 'Usurper', '{stage}', '2026-10-06', 'Somebody', 't')",
            new_id()
        ),
        format!(
            "INSERT INTO snag (id, number, title, stage_id, raised_on, author_name, created_at)
             VALUES ('{first}', 3, 'Twice', '{stage}', '2026-10-06', 'Somebody', 't')
             ON CONFLICT (id) DO UPDATE SET title = 'Rewritten'"
        ),
        // A number that does not continue: a gap, or one from the past.
        format!(
            "INSERT INTO snag (id, number, title, stage_id, raised_on, author_name, created_at)
             VALUES ('{}', 7, 'Skipped ahead', '{stage}', '2026-10-06', 'Somebody', 't')",
            new_id()
        ),
        // The closures.
        format!(
            "UPDATE snag_closure SET outcome = 'withdrawn', note = 'x' WHERE snag_id = '{first}'"
        ),
        "UPDATE snag_closure SET closed_on = '2026-12-01'".to_string(),
        "UPDATE snag_closure SET photo_hash = NULL WHERE outcome = 'withdrawn'".to_string(),
        format!("DELETE FROM snag_closure WHERE snag_id = '{first}'"),
        "DELETE FROM snag_closure".to_string(),
        format!(
            "INSERT OR REPLACE INTO snag_closure
               (snag_id, outcome, closed_on, note, author_name, created_at)
             VALUES ('{first}', 'withdrawn', '2026-10-09', 'Never fixed', 'Somebody', 't')"
        ),
        format!(
            "REPLACE INTO snag_closure (snag_id, outcome, closed_on, photo_hash, author_name,
                                       created_at)
             VALUES ('{second}', 'fixed', '2026-10-09', '{AFTER}', 'Somebody', 't')"
        ),
        format!(
            "INSERT INTO snag_closure (snag_id, outcome, closed_on, note, author_name, created_at)
             VALUES ('{second}', 'withdrawn', '2026-10-09', 'Again', 'Somebody', 't')
             ON CONFLICT DO UPDATE SET outcome = 'withdrawn'"
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
        snags::list(&f.conn).unwrap(),
        before,
        "every snag and every closure reads as it did"
    );
}

/// Why each table carries a `BEFORE INSERT` guard as well as its `BEFORE
/// DELETE` trigger: with `recursive_triggers` off, a `REPLACE` removes the row
/// it replaces without firing a DELETE trigger. The guard is taken away here,
/// on this connection only, to show the hole it closes.
#[test]
fn without_the_insert_guard_a_replace_would_rewrite_a_closure_when_recursive_triggers_are_off() {
    let f = fixture();
    let (first, _) = closed(&f);
    f.conn
        .execute_batch("DROP TRIGGER snag_closure_no_replace;")
        .unwrap();
    f.conn
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();

    f.conn
        .execute(
            "INSERT OR REPLACE INTO snag_closure
               (snag_id, outcome, closed_on, note, author_name, created_at)
             VALUES (?1, 'withdrawn', '2026-10-09', 'Never fixed', 'Somebody', 't')",
            [&first],
        )
        .expect("the hole: the fix is replaced and no trigger saw it go");
    let outcome: String = f
        .conn
        .query_row(
            "SELECT outcome FROM snag_closure WHERE snag_id = ?1",
            [&first],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(outcome, "withdrawn");
}

/// What the host refuses first with a sentence, refused again by the schema
/// alone — a file written by something else holds the same rules.
#[test]
fn the_schema_refuses_what_the_host_refuses_first() {
    let f = fixture();
    let stage = &f.tiling;
    let insert = |number: i64, columns: &str, values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO snag (id, number, stage_id, author_name, created_at, {columns})
                 VALUES ('{}', {number}, '{stage}', 'Somebody', 't', {values})",
                new_id()
            ),
            [],
        )
    };
    for (columns, values) in [
        // A title that is empty, blank, or longer than 200.
        ("title, raised_on", "'', '2026-10-06'"),
        ("title, raised_on", "'   ', '2026-10-06'"),
        (
            "title, raised_on",
            "replace(hex(zeroblob(201)), '00', 'x'), '2026-10-06'",
        ),
        // A day that is not one.
        ("title, raised_on", "'X', '2026-02-30'"),
        ("title, raised_on", "'X', '6 Oct 2026'"),
        // Due before it was raised.
        (
            "title, raised_on, due_on",
            "'X', '2026-10-06', '2026-10-05'",
        ),
        // A photo that is not a hash.
        (
            "title, raised_on, photo_hash",
            "'X', '2026-10-06', 'photo.jpg'",
        ),
        (
            "title, raised_on, photo_hash",
            &format!("'X', '2026-10-06', '{}'", BEFORE.to_uppercase()),
        ),
        // Ids that are not ids.
        ("title, raised_on, person_id", "'X', '2026-10-06', 'Ana'"),
        ("title, raised_on, activity_id", "'X', '2026-10-06', ''"),
        // A description that is blank.
        ("title, raised_on, description", "'X', '2026-10-06', ' '"),
    ] {
        let refused = insert(1, columns, values).expect_err(values);
        assert!(refused.to_string().contains("CHECK"), "{values}: {refused}");
    }
    insert(
        1,
        "title, raised_on, due_on",
        "'Cracked tile', '2026-10-06', '2026-10-06'",
    )
    .expect("the first, due on the day it was raised, by the schema alone");
    let id: String = f
        .conn
        .query_row("SELECT id FROM snag", [], |r| r.get(0))
        .unwrap();

    let close = |values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO snag_closure
                   (snag_id, outcome, closed_on, photo_hash, note, author_name, created_at)
                 VALUES ({values}, 'Somebody', 't')"
            ),
            [],
        )
    };
    for (values, refusal) in [
        // A snag that is not there.
        (
            format!("'{}', 'withdrawn', '2026-10-07', NULL, 'x'", new_id()),
            "snag: closure",
        ),
        // Before it was raised.
        (
            format!("'{id}', 'fixed', '2026-10-05', '{AFTER}', NULL"),
            "snag: closure",
        ),
        // Fixed with no photo; withdrawn with no note.
        (
            format!("'{id}', 'fixed', '2026-10-07', NULL, 'Done'"),
            "CHECK",
        ),
        (
            format!("'{id}', 'withdrawn', '2026-10-07', '{AFTER}', NULL"),
            "CHECK",
        ),
        // An outcome that is not one.
        (
            format!("'{id}', 'ignored', '2026-10-07', '{AFTER}', 'x'"),
            "CHECK",
        ),
    ] {
        let refused = close(&values).expect_err(&values);
        assert!(refused.to_string().contains(refusal), "{values}: {refused}");
    }
    close(&format!("'{id}', 'fixed', '2026-10-07', '{AFTER}', NULL"))
        .expect("one closure, by the schema alone");
    let refused = close(&format!("'{id}', 'withdrawn', '2026-10-08', NULL, 'x'")).unwrap_err();
    assert!(refused.to_string().contains(REFUSAL), "{refused}");
}

/// The rule in `db::snags`' header, checked against its source: no line of
/// code in it names an UPDATE, a DELETE or a REPLACE. Comments may.
#[test]
fn the_module_that_writes_snags_holds_no_update_delete_or_replace() {
    let source = include_str!("snags.rs");
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
        "db/snags.rs must write by INSERT only: {offending:?}"
    );
    for table in ["INSERT INTO snag\n", "INSERT INTO snag_closure"] {
        assert!(source.contains(table), "`{table}` is written here");
    }
}

/// No module but `db::snags` names a snag table in a statement that writes.
#[test]
fn no_other_module_writes_a_snag_table() {
    let sources = [
        ("work.rs", include_str!("work.rs")),
        ("documents.rs", include_str!("documents.rs")),
        ("milestones.rs", include_str!("milestones.rs")),
        ("money.rs", include_str!("money.rs")),
        ("checks.rs", include_str!("checks.rs")),
        ("change_orders.rs", include_str!("change_orders.rs")),
        ("templates.rs", include_str!("templates.rs")),
    ];
    for (file, source) in sources {
        let product = source.split("#[cfg(test)]").next().unwrap_or(source);
        let lower = product.to_ascii_lowercase();
        for verb in ["insert into ", "update ", "delete from ", "replace into "] {
            assert!(
                !lower.contains(&format!("{verb}snag")),
                "{file} writes a snag table"
            );
        }
    }
}

/// A snag's photos are hashes the work names: removing the document leaves
/// the file in the folder.
#[test]
fn a_snag_s_photos_are_hashes_the_work_names() {
    let f = fixture();
    let (first, _) = closed(&f);
    let named = documents::named_hashes(&f.conn).unwrap();
    assert!(named.contains(BEFORE) && named.contains(AFTER));
    assert_eq!(snags::list(&f.conn).unwrap()[0].id, first);

    let id: String = f
        .conn
        .query_row(
            "SELECT id FROM document WHERE file_hash = ?1",
            [AFTER],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(documents::remove(&f.conn, &id).unwrap(), AFTER);
    assert!(
        documents::hash_is_named(&f.conn, AFTER).unwrap(),
        "the closure still names it"
    );
}

fn commitment(f: &Fixture, person: Option<&str>) -> String {
    add_commitment(
        &f.conn,
        &f.tiling,
        &CommitmentFields {
            person_id: person.map(str::to_string),
            label: "Tiler's quote".into(),
            amount_cents: 1_000_000,
            agreed_on: "2026-10-01".into(),
            document_hash: None,
        },
    )
    .unwrap()
}

fn milestone(trigger: &str, share_bp: i64, activity: Option<&str>) -> MilestoneFields {
    MilestoneFields {
        label: trigger.into(),
        share_bp,
        trigger: trigger.into(),
        activity_id: activity.map(str::to_string),
    }
}

/// The payment plan's last part held back as retention: 5 %, naming no
/// activity, and refused with one — by the host and by the schema.
#[test]
fn a_retention_milestone_is_added_names_no_activity_and_counts_toward_the_whole() {
    let f = fixture();
    let quote = commitment(&f, Some(&f.tiler));
    milestones::add(&f.conn, &quote, &milestone("stage_started", 3_000, None)).unwrap();
    milestones::add(
        &f.conn,
        &quote,
        &milestone("activity_finished", 4_500, Some(&f.lay)),
    )
    .unwrap();
    milestones::add(&f.conn, &quote, &milestone("stage_closed", 2_000, None)).unwrap();
    assert_eq!(
        milestones::add(&f.conn, &quote, &milestone("retention", 500, Some(&f.lay)))
            .unwrap_err()
            .to_string(),
        ACTIVITY_NOT_WANTED
    );
    assert_eq!(
        milestones::add(&f.conn, &quote, &milestone("retention", 501, None))
            .unwrap_err()
            .to_string(),
        milestones::over_whole(10_001)
    );
    milestones::add(&f.conn, &quote, &milestone("retention", 500, None))
        .expect("5 % held back, the last part");

    let plan = snapshot(&f.conn).unwrap();
    let last = plan.commitments[0].milestones.last().unwrap();
    assert_eq!(
        (
            last.position,
            last.share_bp,
            last.trigger.as_str(),
            last.activity_id.as_deref()
        ),
        (4, 500, "retention", None)
    );

    let other = commitment(&f, None);
    let refused = f
        .conn
        .execute(
            &format!(
                "INSERT INTO payment_milestone (id, commitment_id, position, label, share_bp,
                                                trigger, activity_id, created_at)
                 VALUES ('{}', '{other}', 1, 'Held', 500, 'retention', '{}', 't')",
                new_id(),
                f.lay
            ),
            [],
        )
        .unwrap_err();
    assert!(refused.to_string().contains("CHECK"), "{refused}");
    f.conn
        .execute(
            &format!(
                "INSERT INTO payment_milestone (id, commitment_id, position, label, share_bp,
                                                trigger, created_at)
                 VALUES ('{}', '{other}', 1, 'Held', 500, 'retention', 't')",
                new_id()
            ),
            [],
        )
        .expect("retention, by the schema alone, on a commitment with nobody");
}

/// Migration 016 rebuilds `payment_milestone`; every rule of migration 011 is
/// still the schema's on a new work: the sum, the activity, the lock.
#[test]
fn the_rebuilt_payment_plan_keeps_every_rule_of_its_first_migration() {
    let f = fixture();
    let quote = commitment(&f, Some(&f.tiler));
    let names: Vec<String> = f
        .conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE tbl_name = 'payment_milestone'
             AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        names,
        [
            "idx_payment_milestone_activity",
            "payment_milestone_activity_insert",
            "payment_milestone_activity_update",
            "payment_milestone_locked_delete",
            "payment_milestone_locked_insert",
            "payment_milestone_locked_update",
            "payment_milestone_sum_insert",
            "payment_milestone_sum_update",
        ]
    );
    let leftovers: i64 = f
        .conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name LIKE '%\\_016%' ESCAPE '\\'
             OR sql LIKE '%payment_milestone_016%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(leftovers, 0, "nothing of the rebuild is left behind");

    let row = |id: &str, position: i64, share: i64, trigger: &str, activity: &str| {
        format!(
            "INSERT INTO payment_milestone
               (id, commitment_id, position, label, share_bp, trigger, activity_id, created_at)
             VALUES ('{id}', '{quote}', {position}, 'X', {share}, '{trigger}', {activity}, 't')"
        )
    };
    let a = "00000000-0000-7000-8000-0000000000a1";
    for (sql, message) in [
        (
            row(a, 1, 10_001, "retention", "NULL"),
            "money: payment plan over 100 %",
        ),
        (
            row(a, 1, 1, "activity_finished", &format!("'{}'", f.paint)),
            "money: milestone activity",
        ),
    ] {
        let refused = f.conn.execute(&sql, []).unwrap_err();
        assert!(refused.to_string().contains(message), "{sql}: {refused}");
    }
    f.conn
        .execute(&row(a, 1, 9_500, "stage_closed", "NULL"), [])
        .unwrap();
    f.conn
        .execute(
            &format!(
                "INSERT INTO payment (id, seq, day, stage_id, commitment_id, amount_cents,
                                      author_name, created_at)
                 VALUES ('{}', 1, '2026-10-05', '{}', '{quote}', 100, 'Somebody', 't')",
                new_id(),
                f.tiling
            ),
            [],
        )
        .unwrap();
    for sql in [
        row(
            "00000000-0000-7000-8000-0000000000a2",
            2,
            500,
            "retention",
            "NULL",
        ),
        format!("UPDATE payment_milestone SET trigger = 'retention' WHERE id = '{a}'"),
        format!("DELETE FROM payment_milestone WHERE id = '{a}'"),
    ] {
        let refused = f.conn.execute(&sql, []).unwrap_err();
        assert!(
            refused.to_string().contains("money: payment plan locked"),
            "{sql}: {refused}"
        );
    }
}
