//! Change orders are facts: the tests that try to rewrite one (slice E1).
//!
//! These live apart from `db::change_orders` on purpose. That module holds no
//! statement that edits or removes a row, by rule, and a test here reads its
//! source to prove it — so the statements that *attack* a change order cannot
//! live inside it.
//!
//! Every attack is tried twice: with `recursive_triggers` on, as the product
//! opens every file, and off, as SQLite's default and any other tool would open
//! it. Each must be refused with `change order: append-only`, and after all of
//! them the change orders must read exactly as they did before. The rules the
//! host says first with a sentence are then tried past the host, on the schema
//! alone.

use rusqlite::Connection;

use crate::contract::ChangeEffect;
use crate::db::baselines::{self, Placement};
use crate::db::change_orders::{self, AskedBy, NewChangeOrder, NewDecision, Outcome};
use crate::db::work::tests::a_work;
use crate::db::work::{add_activity, add_stage, snapshot};

const REFUSAL: &str = "change order: append-only";

/// A work with one stage and one activity.
struct Fixture {
    conn: Connection,
    stage: String,
    tiling: String,
}

fn fixture() -> Fixture {
    let conn = a_work();
    let stage = add_stage(&conn, "Bathroom").unwrap();
    let tiling = add_activity(&conn, &stage, "Tiling").unwrap();
    Fixture {
        conn,
        stage,
        tiling,
    }
}

fn approve(f: &Fixture) {
    baselines::take(
        &f.conn,
        &[Placement {
            activity_id: f.tiling.clone(),
            start: None,
            finish: None,
        }],
        None,
    )
    .expect("baseline 1");
}

fn change(f: &Fixture, title: &str, cost_cents: Option<i64>) -> NewChangeOrder {
    NewChangeOrder {
        raised_on: "2026-10-06".into(),
        title: title.into(),
        description: None,
        asked_by: AskedBy::Owner,
        stage_id: f.stage.clone(),
        cost_cents,
        effects: vec![ChangeEffect::Add {
            name: format!("{title} work"),
            duration_days: 2,
            after: Some(f.tiling.clone()),
        }],
        author_name: "Synthetic author".into(),
    }
}

fn decision(id: &str, outcome: Outcome) -> NewDecision {
    NewDecision {
        change_order_id: id.into(),
        outcome,
        decided_on: "2026-10-07".into(),
        note: None,
        finish_before: Some("2026-10-07".into()),
        finish_after: Some("2026-10-09".into()),
        days_delta: Some(2),
        author_name: "Synthetic author".into(),
    }
}

/// Two change orders, the first approved and the second declined.
fn decided(f: &Fixture) -> (String, String) {
    approve(f);
    change_orders::raise(&f.conn, &change(f, "Socket", Some(30000))).unwrap();
    change_orders::raise(&f.conn, &change(f, "Niche", None)).unwrap();
    let orders = change_orders::list(&f.conn).unwrap();
    let (first, second) = (orders[0].id.clone(), orders[1].id.clone());
    change_orders::decide(&f.conn, &decision(&first, Outcome::Approved)).unwrap();
    change_orders::decide(&f.conn, &decision(&second, Outcome::Declined)).unwrap();
    (first, second)
}

/// Every way SQL can rewrite a change order or its decision, with
/// `recursive_triggers` on and off.
#[test]
fn every_update_delete_and_replace_of_a_change_order_is_refused_whatever_the_pragmas() {
    let f = fixture();
    let (first, second) = decided(&f);
    let before = change_orders::list(&f.conn).unwrap();
    let replanning: String = f
        .conn
        .query_row("SELECT id FROM replanning", [], |r| r.get(0))
        .unwrap();
    let stage = &f.stage;

    let attacks = [
        format!("UPDATE change_order SET title = 'Rewritten' WHERE id = '{first}'"),
        "UPDATE change_order SET cost_cents = 0".to_string(),
        "UPDATE change_order SET effects = '[]'".to_string(),
        format!("UPDATE change_order SET number = 9 WHERE id = '{second}'"),
        format!("UPDATE OR REPLACE change_order SET number = 1 WHERE id = '{second}'"),
        format!("DELETE FROM change_order WHERE id = '{second}'"),
        "DELETE FROM change_order".to_string(),
        format!(
            "INSERT OR REPLACE INTO change_order
               (id, number, raised_on, title, asked_by, stage_id, cost_cents, effects,
                author_name, created_at)
             VALUES ('{first}', 1, '2026-10-06', 'Rewritten', 'owner', '{stage}', 1, '[]',
                     'Somebody', 't')"
        ),
        format!(
            "REPLACE INTO change_order
               (id, number, raised_on, title, asked_by, stage_id, effects, author_name,
                created_at)
             VALUES ('{}', 2, '2026-10-06', 'Usurper', 'owner', '{stage}', '[]', 'Somebody',
                     't')",
            crate::db::new_id()
        ),
        format!(
            "INSERT INTO change_order
               (id, number, raised_on, title, asked_by, stage_id, effects, author_name,
                created_at)
             VALUES ('{first}', 3, '2026-10-06', 'Twice', 'owner', '{stage}', '[]', 'Somebody',
                     't')
             ON CONFLICT (id) DO UPDATE SET title = 'Rewritten'"
        ),
        // A number that does not continue: a gap, or one from the past.
        format!(
            "INSERT INTO change_order
               (id, number, raised_on, title, asked_by, stage_id, effects, author_name,
                created_at)
             VALUES ('{}', 7, '2026-10-06', 'Skipped ahead', 'owner', '{stage}', '[]',
                     'Somebody', 't')",
            crate::db::new_id()
        ),
        // The decisions.
        format!(
            "UPDATE change_order_decision SET outcome = 'declined' WHERE change_order_id = '{first}'"
        ),
        "UPDATE change_order_decision SET days_delta = 0".to_string(),
        "UPDATE change_order_decision SET note = 'Rewritten'".to_string(),
        format!("DELETE FROM change_order_decision WHERE change_order_id = '{second}'"),
        "DELETE FROM change_order_decision".to_string(),
        format!(
            "INSERT OR REPLACE INTO change_order_decision
               (change_order_id, outcome, decided_on, cost_cents, replanning_id, author_name,
                created_at)
             VALUES ('{first}', 'approved', '2026-10-08', 30000, '{replanning}', 'Somebody', 't')"
        ),
        format!(
            "REPLACE INTO change_order_decision
               (change_order_id, outcome, decided_on, author_name, created_at)
             VALUES ('{second}', 'withdrawn', '2026-10-08', 'Somebody', 't')"
        ),
        format!(
            "INSERT INTO change_order_decision
               (change_order_id, outcome, decided_on, author_name, created_at)
             VALUES ('{second}', 'withdrawn', '2026-10-08', 'Somebody', 't')
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
        change_orders::list(&f.conn).unwrap(),
        before,
        "every change order and every decision reads as it did"
    );
}

/// Why each table carries a `BEFORE INSERT` guard as well as its `BEFORE
/// DELETE` trigger: with `recursive_triggers` off, a `REPLACE` removes the row
/// it replaces without firing a DELETE trigger. The guard is taken away here,
/// on this connection only, to show the hole it closes.
#[test]
fn without_the_insert_guard_a_replace_would_rewrite_a_decision_when_recursive_triggers_are_off() {
    let f = fixture();
    let (_, second) = decided(&f);
    f.conn
        .execute_batch("DROP TRIGGER change_order_decision_no_replace;")
        .unwrap();
    f.conn
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();

    f.conn
        .execute(
            "INSERT OR REPLACE INTO change_order_decision
               (change_order_id, outcome, decided_on, author_name, created_at)
             VALUES (?1, 'withdrawn', '2026-10-08', 'Somebody', 't')",
            [&second],
        )
        .expect("the hole: the old decision is replaced and no trigger saw it go");
    let outcome: String = f
        .conn
        .query_row(
            "SELECT outcome FROM change_order_decision WHERE change_order_id = ?1",
            [&second],
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
    let stage = &f.stage;
    let insert = |number: i64, columns: &str, values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO change_order
                   (id, number, raised_on, title, stage_id, author_name, created_at, {columns})
                 VALUES ('{}', {number}, '2026-10-06', 'A change', '{stage}', 'Somebody', 't',
                         {values})",
                crate::db::new_id()
            ),
            [],
        )
    };
    let owner = ("asked_by, effects", "'owner', '[]'");

    // Before approval there are no change orders.
    let refused = insert(1, owner.0, owner.1).unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("change order: plan not approved"),
        "{refused}"
    );

    approve(&f);
    for (columns, values) in [
        // A person asked, and none is named; somebody else, and no name.
        ("asked_by, effects", "'person', '[]'"),
        ("asked_by, effects", "'other', '[]'"),
        // A name beside the owner.
        ("asked_by, asked_by_name, effects", "'owner', 'Somebody', '[]'"),
        // Effects that are not a JSON array of at most 50.
        ("asked_by, effects", "'owner', 'not json'"),
        ("asked_by, effects", "'owner', '{\"kind\": \"add\"}'"),
        (
            "asked_by, effects",
            "'owner', (WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 51)
                      SELECT json_group_array(i) FROM n)",
        ),
        // Money that is not whole.
        ("asked_by, effects, cost_cents", "'owner', '[]', 1.5"),
        ("asked_by, effects", "'architect', '[]'"),
    ] {
        let refused = insert(1, columns, values).expect_err(values);
        let text = refused.to_string();
        assert!(text.contains("CHECK"), "{values}: {text}");
    }
    insert(1, owner.0, owner.1).expect("the first, by the schema alone");
    let id: String = f
        .conn
        .query_row("SELECT id FROM change_order", [], |r| r.get(0))
        .unwrap();

    let decide = |values: &str| {
        f.conn.execute(
            &format!(
                "INSERT INTO change_order_decision
                   (change_order_id, outcome, decided_on, cost_cents, replanning_id,
                    author_name, created_at)
                 VALUES ({values}, 'Somebody', 't')"
            ),
            [],
        )
    };
    for (values, refusal) in [
        // A change that is not there.
        (
            "'00000000-0000-7000-8000-0000000000ff', 'declined', '2026-10-07', NULL, NULL"
                .to_string(),
            "change order: decision",
        ),
        // Before it was raised.
        (
            format!("'{id}', 'declined', '2026-10-05', NULL, NULL"),
            "change order: decision",
        ),
        // Another amount than the change's (it was not priced).
        (
            format!("'{id}', 'declined', '2026-10-07', 0, NULL"),
            "change order: decision",
        ),
        // An approval written into no replanning; a decline written into one.
        (
            format!("'{id}', 'approved', '2026-10-07', NULL, NULL"),
            "CHECK",
        ),
        (format!("'{id}', 'kept', '2026-10-07', NULL, NULL"), "CHECK"),
    ] {
        let refused = decide(&values).expect_err(&values);
        assert!(refused.to_string().contains(refusal), "{values}: {refused}");
    }
    decide(&format!("'{id}', 'withdrawn', '2026-10-07', NULL, NULL"))
        .expect("one decision, by the schema alone");
    let refused = decide(&format!("'{id}', 'declined', '2026-10-08', NULL, NULL")).unwrap_err();
    assert!(refused.to_string().contains(REFUSAL), "{refused}");
}

/// The host's own refusals, at the repository: before approval, and a second
/// decision.
#[test]
fn the_repository_refuses_before_approval_and_a_second_decision() {
    let f = fixture();
    let refused = change_orders::raise(&f.conn, &change(&f, "Socket", None)).unwrap_err();
    assert_eq!(refused.to_string(), change_orders::NOT_APPROVED_YET);
    assert!(snapshot(&f.conn).unwrap().change_orders.is_empty());

    let (first, _) = decided(&f);
    let refused =
        change_orders::decide(&f.conn, &decision(&first, Outcome::Withdrawn)).unwrap_err();
    assert_eq!(
        refused.to_string(),
        change_orders::already_decided(1, "approved", "2026-10-07")
    );
    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(plan.change_orders.len(), 2);
    assert_eq!(
        plan.change_orders[0].decision.as_ref().unwrap().outcome,
        "approved"
    );
    assert_eq!(
        plan.replanning.as_ref().unwrap().reason,
        "Change order #1 — Socket",
        "the decline opened nothing of its own"
    );
}

/// The rule in `db::change_orders`' header, checked against its source: no
/// line of code in it names an UPDATE, a DELETE or a REPLACE. Comments may.
#[test]
fn the_module_that_writes_change_orders_holds_no_update_delete_or_replace() {
    let source = include_str!("change_orders.rs");
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
        "db/change_orders.rs must write by INSERT only: {offending:?}"
    );
    for table in [
        "INSERT INTO change_order\n",
        "INSERT INTO change_order_decision",
    ] {
        assert!(source.contains(table), "`{table}` is written here");
    }
}

/// No module but `db::change_orders` names a change-order table in a
/// statement that writes.
#[test]
fn no_other_module_writes_a_change_order_table() {
    let sources = [
        ("change_effects.rs", include_str!("change_effects.rs")),
        ("work.rs", include_str!("work.rs")),
        ("replanning.rs", include_str!("replanning.rs")),
        ("money.rs", include_str!("money.rs")),
        ("baselines.rs", include_str!("baselines.rs")),
        ("dependencies.rs", include_str!("dependencies.rs")),
    ];
    for (file, source) in sources {
        let product = source.split("#[cfg(test)]").next().unwrap_or(source);
        let lower = product.to_ascii_lowercase();
        for verb in ["insert into ", "update ", "delete from ", "replace into "] {
            assert!(
                !lower.contains(&format!("{verb}change_order")),
                "{file} writes a change-order table"
            );
        }
    }
}
