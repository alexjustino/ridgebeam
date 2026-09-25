//! Requirement one, applied to baselines: the tests that try to rewrite one.
//!
//! These live apart from `db::baselines` on purpose. That module holds no
//! statement that edits or removes a row, by rule, and the last test here reads
//! its source to prove it — so the statements that *attack* a baseline cannot
//! live inside it.
//!
//! Every attack is tried twice: with `recursive_triggers` on, as the product
//! opens every file, and off, as SQLite's default and any other tool would open
//! it. Each must be refused with `baseline: append-only`, and after all of them
//! the baselines must read exactly as they did before.

use rusqlite::Connection;

use crate::db::baselines::{self, Placement, FINISH_IS_THE_LAST, NAMED_TWICE, NOTHING_TO_APPROVE};
use crate::db::work::tests::a_work;
use crate::db::work::{
    add_activity, add_stage, remove_activity, remove_stage, rename_stage, snapshot,
    update_activity, ActivityChange, ACTIVITY_NOT_FOUND,
};

const REFUSAL: &str = "baseline: append-only";

/// A plan of two stages and three activities, and where a schedule put them.
struct Fixture {
    conn: Connection,
    stage: String,
    tiling: String,
    grout: String,
    paint: String,
}

fn fixture() -> Fixture {
    let conn = a_work();
    let stage = add_stage(&conn, "Bathroom").unwrap();
    let later = add_stage(&conn, "Finishes").unwrap();
    let tiling = add_activity(&conn, &stage, "Tiling").unwrap();
    let grout = add_activity(&conn, &stage, "Grout").unwrap();
    let paint = add_activity(&conn, &later, "Paint").unwrap();
    for (id, days) in [(&tiling, 3), (&grout, 1)] {
        update_activity(
            &conn,
            id,
            &ActivityChange {
                duration_days: Some(Some(days)),
                ..ActivityChange::default()
            },
        )
        .unwrap();
    }
    Fixture {
        conn,
        stage,
        tiling,
        grout,
        paint,
    }
}

fn placed(id: &str, start: &str, finish: &str) -> Placement {
    Placement {
        activity_id: id.into(),
        start: Some(start.into()),
        finish: Some(finish.into()),
    }
}

fn unplaced(id: &str) -> Placement {
    Placement {
        activity_id: id.into(),
        start: None,
        finish: None,
    }
}

/// Where the schedule put them: Paint has no duration and is not placed.
fn placements(f: &Fixture) -> Vec<Placement> {
    vec![
        unplaced(&f.paint),
        placed(&f.grout, "2026-10-08", "2026-10-08"),
        placed(&f.tiling, "2026-10-05", "2026-10-07"),
    ]
}

#[test]
fn the_first_baseline_is_number_one_and_approves_the_plan() {
    let f = fixture();
    assert_eq!(snapshot(&f.conn).unwrap().work.approved_at, None);

    let number = baselines::take(&f.conn, &placements(&f), Some("2026-10-08")).unwrap();

    assert_eq!(number, 1);
    let plan = snapshot(&f.conn).unwrap();
    let approved = plan.work.approved_at.clone().expect("approved");
    let baseline = &plan.baselines[0];
    assert_eq!(baseline.number, 1);
    assert_eq!(baseline.reason, None);
    assert_eq!(baseline.finish_date.as_deref(), Some("2026-10-08"));
    let rows: Vec<_> = baseline
        .rows
        .iter()
        .map(|r| {
            (
                r.name.as_str(),
                r.stage_name.as_str(),
                r.duration_days,
                r.start.as_deref(),
                r.finish.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                "Tiling",
                "Bathroom",
                Some(3),
                Some("2026-10-05"),
                Some("2026-10-07")
            ),
            (
                "Grout",
                "Bathroom",
                Some(1),
                Some("2026-10-08"),
                Some("2026-10-08")
            ),
            ("Paint", "Finishes", None, None, None),
        ],
        "in breakdown order, names and durations from the file"
    );

    std::thread::sleep(std::time::Duration::from_millis(5));
    let number = baselines::take(&f.conn, &placements(&f), Some("2026-10-08")).unwrap();
    assert_eq!(number, 2, "max + 1");
    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(plan.baselines.len(), 2);
    assert_eq!(
        plan.work.approved_at,
        Some(approved),
        "the approval is the first baseline's, and stays"
    );
}

#[test]
fn a_row_naming_an_unknown_activity_refuses_the_whole_take() {
    let f = fixture();
    let mut rows = placements(&f);
    rows.push(unplaced(&crate::db::new_id()));

    let refused = baselines::take(&f.conn, &rows, Some("2026-10-08")).unwrap_err();

    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), ACTIVITY_NOT_FOUND);
    let plan = snapshot(&f.conn).unwrap();
    assert!(plan.baselines.is_empty(), "nothing was written");
    assert_eq!(plan.work.approved_at, None, "and nothing was approved");
}

#[test]
fn a_take_that_leaves_one_out_names_one_twice_or_misstates_the_finish_is_refused() {
    let f = fixture();
    let all = placements(&f);

    let refused = baselines::take(&f.conn, &all[1..], Some("2026-10-08")).unwrap_err();
    assert_eq!(
        refused.to_string(),
        "A baseline records every activity in the plan; 1 is left out."
    );

    let mut twice = all.clone();
    twice.push(unplaced(&f.paint));
    let refused = baselines::take(&f.conn, &twice, Some("2026-10-08")).unwrap_err();
    assert_eq!(refused.to_string(), NAMED_TWICE);

    for finish in [Some("2026-10-09"), None] {
        let refused = baselines::take(&f.conn, &all, finish).unwrap_err();
        assert_eq!(refused.to_string(), FINISH_IS_THE_LAST);
    }
    assert!(snapshot(&f.conn).unwrap().baselines.is_empty());

    let empty = a_work();
    let refused = baselines::take(&empty, &[], None).unwrap_err();
    assert_eq!(refused.to_string(), NOTHING_TO_APPROVE);
}

/// What a plan becomes after approval does not reach back into its baseline:
/// an activity renamed, re-timed or removed — a whole stage removed — is still
/// what it was in the baseline it was approved in.
#[test]
fn editing_or_removing_the_plan_after_approval_leaves_the_baseline_as_it_was() {
    let f = fixture();
    baselines::take(&f.conn, &placements(&f), Some("2026-10-08")).unwrap();
    let before = snapshot(&f.conn).unwrap().baselines;

    update_activity(
        &f.conn,
        &f.tiling,
        &ActivityChange {
            name: Some("Wall and floor tiling".into()),
            duration_days: Some(Some(5)),
            ..ActivityChange::default()
        },
    )
    .unwrap();
    rename_stage(&f.conn, &f.stage, "Main bathroom").unwrap();
    remove_activity(&f.conn, &f.grout).unwrap();
    remove_stage(&f.conn, &f.stage).unwrap();

    assert_eq!(snapshot(&f.conn).unwrap().baselines, before);
}

/// Every way SQL can rewrite a row, against both tables and the approval,
/// with `recursive_triggers` on and off.
#[test]
fn every_update_delete_and_replace_of_a_baseline_is_refused_whatever_the_pragmas() {
    let f = fixture();
    baselines::take(&f.conn, &placements(&f), Some("2026-10-08")).unwrap();
    baselines::take(&f.conn, &placements(&f), Some("2026-10-08")).unwrap();
    let plan = snapshot(&f.conn).unwrap();
    let before = plan.baselines.clone();
    let approved = plan.work.approved_at.clone();
    let first = &before[0].id;
    let second = &before[1].id;
    let tiling = &f.tiling;

    let attacks = [
        format!("UPDATE baseline SET finish_date = '2027-01-01' WHERE id = '{first}'"),
        format!("UPDATE baseline SET number = 9 WHERE id = '{first}'"),
        "UPDATE baseline SET reason = 'rewritten'".to_string(),
        format!("UPDATE OR REPLACE baseline SET number = 2 WHERE id = '{first}'"),
        format!("DELETE FROM baseline WHERE id = '{second}'"),
        "DELETE FROM baseline".to_string(),
        format!(
            "INSERT OR REPLACE INTO baseline (id, number, taken_at, finish_date)
             VALUES ('{first}', 1, 't', '2027-01-01')"
        ),
        format!(
            "REPLACE INTO baseline (id, number, taken_at, finish_date)
             VALUES ('{}', 1, 't', '2027-01-01')",
            crate::db::new_id()
        ),
        format!(
            "INSERT INTO baseline (id, number, taken_at) VALUES ('{first}', 1, 't')
             ON CONFLICT (id) DO UPDATE SET finish_date = '2027-01-01'"
        ),
        format!("UPDATE baseline_activity SET name = 'Rewritten' WHERE activity_id = '{tiling}'"),
        format!("UPDATE baseline_activity SET finish = '2027-01-01' WHERE baseline_id = '{first}'"),
        format!("DELETE FROM baseline_activity WHERE activity_id = '{tiling}'"),
        "DELETE FROM baseline_activity".to_string(),
        format!(
            "INSERT OR REPLACE INTO baseline_activity
               (baseline_id, activity_id, position, name, stage_name)
             VALUES ('{second}', '{tiling}', 1, 'Rewritten', 'Bathroom')"
        ),
        format!(
            "REPLACE INTO baseline_activity (baseline_id, activity_id, position, name, stage_name)
             VALUES ('{second}', '{tiling}', 1, 'Rewritten', 'Bathroom')"
        ),
        // A row added to a past baseline: appending, but to a record that was
        // already approved without it.
        format!(
            "INSERT INTO baseline_activity (baseline_id, activity_id, position, name, stage_name)
             VALUES ('{first}', '{}', 9, 'Smuggled in', 'Bathroom')",
            crate::db::new_id()
        ),
        "UPDATE work SET approved_at = '2020-01-01T00:00:00.000Z'".to_string(),
        "UPDATE work SET approved_at = NULL".to_string(),
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

    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(plan.baselines, before, "every baseline reads as it did");
    assert_eq!(plan.work.approved_at, approved);
}

/// Why each table carries a `BEFORE INSERT` guard as well as its `BEFORE
/// DELETE` trigger: with `recursive_triggers` off — SQLite's default, and how
/// any other tool opens the file — a `REPLACE` removes the row it replaces
/// without firing a DELETE trigger. The guard is taken away here, on this
/// connection only, to show the hole it closes; the battery above proves it is
/// closed.
#[test]
fn without_the_insert_guard_a_replace_would_rewrite_a_baseline_when_recursive_triggers_are_off() {
    let f = fixture();
    baselines::take(&f.conn, &placements(&f), Some("2026-10-08")).unwrap();
    let first = snapshot(&f.conn).unwrap().baselines[0].id.clone();
    f.conn
        .execute_batch("DROP TRIGGER baseline_no_replace;")
        .unwrap();
    f.conn
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();

    f.conn
        .execute(
            &format!(
                "INSERT OR REPLACE INTO baseline (id, number, taken_at, finish_date)
                 VALUES ('{first}', 1, 't', '2027-01-01')"
            ),
            [],
        )
        .expect("the hole: the old row is replaced and no trigger saw it go");
    let finish: String = f
        .conn
        .query_row(
            "SELECT finish_date FROM baseline WHERE id = ?1",
            [&first],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(finish, "2027-01-01");
}

/// The rule in `db::baselines`' header, checked against its source: no line of
/// code in it names an UPDATE, a DELETE or a REPLACE. Comments may — the header
/// has to say what the rule is.
#[test]
fn the_module_that_writes_baselines_holds_no_update_delete_or_replace() {
    let source = include_str!("baselines.rs");
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
        "db/baselines.rs must write by INSERT only: {offending:?}"
    );
    assert!(
        source.contains("INSERT INTO baseline"),
        "the scan is reading the right file"
    );
}
