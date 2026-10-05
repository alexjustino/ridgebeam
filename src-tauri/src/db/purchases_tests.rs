//! Purchases are plan; what happened to them is fact: the tests of both
//! (slice G2), and the ones that try to rewrite an event.
//!
//! These live apart from `db::purchase_events` on purpose. That module holds
//! no statement that edits or removes a row, by rule, and a test here reads
//! its source to prove it — so the statements that *attack* an event cannot
//! live inside it.
//!
//! Every attack is tried twice: with `recursive_triggers` on, as the product
//! opens every file, and off, as SQLite's default and any other tool would open
//! it. Each must be refused with `purchase: append-only`, and after all of them
//! the purchases must read exactly as they did before. The rules the host says
//! first with a sentence are then tried past the host, on the schema alone.

use rusqlite::{params, Connection};

use crate::db::money::ACTIVITY_OF_ANOTHER_STAGE;
use crate::db::new_id;
use crate::db::purchase_events::{
    self, after_delivered, before_the_last, cancelled_without_order, delivered_without_order,
    ordered_twice, Kind, NewEvent,
};
use crate::db::purchases::{
    self, PurchaseFields, ACTIVITY_HAS_PURCHASES_ON_RECORD, PURCHASE_NOT_FOUND, PURCHASE_ON_RECORD,
    PURCHASE_TERMS_FIXED, STAGE_HAS_PURCHASES_ON_RECORD,
};
use crate::db::work::tests::a_work;
use crate::db::work::{
    add_activity, add_stage, remove_activity, remove_stage, snapshot, ACTIVITY_NOT_FOUND,
    STAGE_NOT_FOUND,
};

const REFUSAL: &str = "purchase: append-only";

/// A work with a stage Kitchen (two activities) and a stage Bathroom (one).
/// Synthetic.
struct Fixture {
    conn: Connection,
    kitchen: String,
    cabinets: String,
    worktop_fit: String,
    bathroom: String,
    tiling: String,
}

fn fixture() -> Fixture {
    let conn = a_work();
    let kitchen = add_stage(&conn, "Kitchen").unwrap();
    let cabinets = add_activity(&conn, &kitchen, "Fit the cabinets").unwrap();
    let worktop_fit = add_activity(&conn, &kitchen, "Fit the worktop").unwrap();
    let bathroom = add_stage(&conn, "Bathroom").unwrap();
    let tiling = add_activity(&conn, &bathroom, "Tiling").unwrap();
    Fixture {
        conn,
        kitchen,
        cabinets,
        worktop_fit,
        bathroom,
        tiling,
    }
}

fn fields(stage: &str, activity: Option<&str>, name: &str, lead_days: i64) -> PurchaseFields {
    PurchaseFields {
        stage_id: stage.into(),
        activity_id: activity.map(str::to_string),
        name: name.into(),
        quantity: None,
        supplier: None,
        lead_days,
        note: None,
    }
}

fn event(purchase: &str, kind: Kind, day: &str) -> NewEvent {
    NewEvent {
        purchase_id: purchase.into(),
        kind,
        day: day.into(),
        note: None,
        author_name: "Synthetic author".into(),
    }
}

/// A worktop ordered and delivered, handles ordered and fallen through, and
/// tiles nothing has happened to.
struct Bought {
    f: Fixture,
    worktop: String,
    handles: String,
    tiles: String,
}

fn bought() -> Bought {
    let f = fixture();
    let worktop = purchases::add(
        &f.conn,
        &fields(&f.kitchen, Some(&f.worktop_fit), "Worktop", 21),
    )
    .unwrap();
    let handles = purchases::add(&f.conn, &fields(&f.kitchen, None, "Cabinet handles", 3)).unwrap();
    let tiles = purchases::add(&f.conn, &fields(&f.bathroom, None, "Tiles", 10)).unwrap();
    purchase_events::append(&f.conn, &event(&worktop, Kind::Ordered, "2026-10-05")).unwrap();
    purchase_events::append(&f.conn, &event(&worktop, Kind::Delivered, "2026-10-08")).unwrap();
    purchase_events::append(&f.conn, &event(&handles, Kind::Ordered, "2026-10-06")).unwrap();
    purchase_events::append(&f.conn, &event(&handles, Kind::Cancelled, "2026-10-07")).unwrap();
    Bought {
        f,
        worktop,
        handles,
        tiles,
    }
}

#[test]
fn purchases_are_listed_by_position_written_whole_and_removed_closing_the_gap() {
    let f = fixture();
    let first = purchases::add(&f.conn, &fields(&f.kitchen, None, "Worktop", 21)).unwrap();
    let second = purchases::add(&f.conn, &fields(&f.kitchen, None, "Handles", 3)).unwrap();
    let third = purchases::add(&f.conn, &fields(&f.bathroom, None, "Tiles", 10)).unwrap();

    purchases::update(
        &f.conn,
        &second,
        &PurchaseFields {
            stage_id: f.kitchen.clone(),
            activity_id: Some(f.cabinets.clone()),
            name: "Cabinet handles".into(),
            quantity: Some("24 pieces".into()),
            supplier: Some("The ironmonger".into()),
            lead_days: 5,
            note: Some("Brushed steel.\nThe long ones.".into()),
        },
    )
    .unwrap();
    let plan = snapshot(&f.conn).unwrap();
    let handles = &plan.purchases[1];
    assert_eq!(
        (
            handles.position,
            handles.name.as_str(),
            handles.activity_id.as_deref(),
            handles.quantity.as_deref(),
            handles.supplier.as_deref(),
            handles.lead_days,
            handles.note.as_deref(),
        ),
        (
            2,
            "Cabinet handles",
            Some(f.cabinets.as_str()),
            Some("24 pieces"),
            Some("The ironmonger"),
            5,
            Some("Brushed steel.\nThe long ones.")
        )
    );
    assert!(handles.events.is_empty());

    purchases::remove(&f.conn, &first).unwrap();
    let order: Vec<_> = snapshot(&f.conn)
        .unwrap()
        .purchases
        .iter()
        .map(|p| (p.position, p.id.clone()))
        .collect();
    assert_eq!(order, vec![(1, second), (2, third)]);

    let nobody = new_id();
    for refused in [
        purchases::update(&f.conn, &nobody, &fields(&f.kitchen, None, "X", 1)),
        purchases::remove(&f.conn, &nobody),
    ] {
        let refused = refused.unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), PURCHASE_NOT_FOUND);
    }
}

#[test]
fn a_purchase_is_on_a_stage_of_the_work_and_an_activity_of_that_stage() {
    let f = fixture();
    for (attempt, sentence) in [
        (fields(&new_id(), None, "Worktop", 1), STAGE_NOT_FOUND),
        (
            fields(&f.kitchen, Some(&new_id()), "Worktop", 1),
            ACTIVITY_NOT_FOUND,
        ),
        (
            fields(&f.kitchen, Some(&f.tiling), "Worktop", 1),
            ACTIVITY_OF_ANOTHER_STAGE,
        ),
    ] {
        let refused = purchases::add(&f.conn, &attempt).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
    assert!(snapshot(&f.conn).unwrap().purchases.is_empty());

    let worktop = purchases::add(&f.conn, &fields(&f.kitchen, None, "Worktop", 21)).unwrap();
    let refused = purchases::update(
        &f.conn,
        &worktop,
        &fields(&f.bathroom, Some(&f.worktop_fit), "Worktop", 21),
    )
    .unwrap_err();
    assert_eq!(refused.to_string(), ACTIVITY_OF_ANOTHER_STAGE);
    purchases::update(
        &f.conn,
        &worktop,
        &fields(&f.bathroom, Some(&f.tiling), "Worktop", 21),
    )
    .expect("moved to another stage, with an activity of it");
    assert_eq!(snapshot(&f.conn).unwrap().purchases[0].stage_id, f.bathroom);
}

#[test]
fn what_happens_to_a_purchase_is_recorded_in_order_each_with_its_own_sequence() {
    let b = bought();
    purchase_events::append(
        &b.f.conn,
        &NewEvent {
            note: Some("Second supplier.".into()),
            ..event(&b.handles, Kind::Ordered, "2026-10-07")
        },
    )
    .expect("ordered again once the first order fell through");
    let plan = snapshot(&b.f.conn).unwrap();

    let worktop = &plan.purchases[0];
    assert_eq!(worktop.id, b.worktop);
    let kinds = |p: &crate::contract::Purchase| -> Vec<(i64, String, String)> {
        p.events
            .iter()
            .map(|e| (e.seq, e.kind.clone(), e.day.clone()))
            .collect()
    };
    assert_eq!(
        kinds(worktop),
        vec![
            (1, "ordered".into(), "2026-10-05".into()),
            (2, "delivered".into(), "2026-10-08".into())
        ]
    );
    let handles = &plan.purchases[1];
    assert_eq!(
        kinds(handles),
        vec![
            (1, "ordered".into(), "2026-10-06".into()),
            (2, "cancelled".into(), "2026-10-07".into()),
            (3, "ordered".into(), "2026-10-07".into())
        ]
    );
    assert_eq!(handles.events[2].note.as_deref(), Some("Second supplier."));
    assert_eq!(handles.events[2].author_name, "Synthetic author");
    assert!(handles.events.iter().all(|e| e.purchase_id == b.handles));
    assert!(
        plan.purchases[2].events.is_empty(),
        "the tiles: nothing yet"
    );
}

#[test]
fn the_repository_refuses_an_event_out_of_order_with_a_sentence_naming_the_purchase() {
    let b = bought();
    let before = snapshot(&b.f.conn).unwrap().purchases;
    for (new, sentence) in [
        (
            event(&b.tiles, Kind::Delivered, "2026-10-09"),
            delivered_without_order("Tiles"),
        ),
        (
            event(&b.tiles, Kind::Cancelled, "2026-10-09"),
            cancelled_without_order("Tiles"),
        ),
        (
            event(&b.handles, Kind::Delivered, "2026-10-09"),
            delivered_without_order("Cabinet handles"),
        ),
        (
            event(&b.handles, Kind::Cancelled, "2026-10-09"),
            cancelled_without_order("Cabinet handles"),
        ),
        (
            event(&b.worktop, Kind::Ordered, "2026-10-09"),
            after_delivered("Worktop", "2026-10-08"),
        ),
        (
            event(&b.worktop, Kind::Cancelled, "2026-10-09"),
            after_delivered("Worktop", "2026-10-08"),
        ),
        (
            event(&b.worktop, Kind::Delivered, "2026-10-09"),
            after_delivered("Worktop", "2026-10-08"),
        ),
        (
            event(&b.handles, Kind::Ordered, "2026-10-06"),
            before_the_last("Cabinet handles", "cancelled", "2026-10-07"),
        ),
        (
            event(&new_id(), Kind::Ordered, "2026-10-09"),
            PURCHASE_NOT_FOUND.to_string(),
        ),
    ] {
        let refused = purchase_events::append(&b.f.conn, &new).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{new:?}");
        assert_eq!(refused.to_string(), sentence, "{new:?}");
    }
    assert_eq!(
        delivered_without_order("Tiles"),
        "“Tiles” has no open order: it is marked as delivered only once it has been ordered."
    );

    purchase_events::append(&b.f.conn, &event(&b.tiles, Kind::Ordered, "2026-10-09")).unwrap();
    let refused = purchase_events::append(&b.f.conn, &event(&b.tiles, Kind::Ordered, "2026-10-09"))
        .unwrap_err();
    assert_eq!(
        refused.to_string(),
        "“Tiles” was already ordered on 2026-10-09: it is ordered again only if that order falls through."
    );
    assert_eq!(refused.to_string(), ordered_twice("Tiles", "2026-10-09"));
    let refused =
        purchase_events::append(&b.f.conn, &event(&b.tiles, Kind::Delivered, "2026-10-08"))
            .unwrap_err();
    assert_eq!(
        refused.to_string(),
        "“Tiles” was ordered on 2026-10-09: what happens next is on that day or later."
    );
    let after = snapshot(&b.f.conn).unwrap().purchases;
    assert_eq!(after[..2], before[..2], "nothing written on a refusal");
    assert_eq!(after[2].events.len(), 1);
}

#[test]
fn a_purchase_on_record_is_changed_but_never_removed_and_neither_is_its_stage() {
    let b = bought();
    purchases::update(
        &b.f.conn,
        &b.worktop,
        &PurchaseFields {
            quantity: Some("3.2 m".into()),
            supplier: Some("The stone yard".into()),
            note: Some("Oak.".into()),
            ..fields(&b.f.kitchen, Some(&b.f.worktop_fit), "Worktop, oak", 21)
        },
    )
    .expect("its words can still be changed");
    // Fallen through, the handles were ordered once: fixed as well.
    for (purchase, attempt) in [
        (
            &b.worktop,
            fields(&b.f.kitchen, Some(&b.f.worktop_fit), "Worktop, oak", 30),
        ),
        (&b.worktop, fields(&b.f.kitchen, None, "Worktop, oak", 21)),
        (
            &b.worktop,
            fields(&b.f.kitchen, Some(&b.f.cabinets), "Worktop, oak", 21),
        ),
        (
            &b.worktop,
            fields(&b.f.bathroom, Some(&b.f.tiling), "Worktop, oak", 21),
        ),
        (&b.handles, fields(&b.f.kitchen, None, "Cabinet handles", 4)),
    ] {
        let refused = purchases::update(&b.f.conn, purchase, &attempt).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{attempt:?}");
        assert_eq!(refused.to_string(), PURCHASE_TERMS_FIXED, "{attempt:?}");
    }
    assert_eq!(
        PURCHASE_TERMS_FIXED,
        "The lead time, the stage and the activity of a purchase are fixed once it has been ordered: an order keeps the lead time it was placed with."
    );
    let worktop = snapshot(&b.f.conn).unwrap().purchases[0].clone();
    assert_eq!(
        (
            worktop.name.as_str(),
            worktop.lead_days,
            worktop.activity_id.as_deref(),
            worktop.supplier.as_deref()
        ),
        (
            "Worktop, oak",
            21,
            Some(b.f.worktop_fit.as_str()),
            Some("The stone yard")
        )
    );
    purchases::update(
        &b.f.conn,
        &b.tiles,
        &fields(&b.f.kitchen, None, "Tiles", 12),
    )
    .expect("nothing has happened to it: all of it can change");

    // An activity a purchase on record needs is not removed either: its
    // purchase would lose the activity it was ordered for.
    let refused = remove_activity(&b.f.conn, &b.f.worktop_fit).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), ACTIVITY_HAS_PURCHASES_ON_RECORD);
    let refused =
        b.f.conn
            .execute("DELETE FROM activity WHERE id = ?1", [&b.f.worktop_fit])
            .unwrap_err();
    assert!(
        refused.to_string().contains("purchase: ordered"),
        "the schema refuses it again: {refused}"
    );

    for purchase in [&b.worktop, &b.handles] {
        let refused = purchases::remove(&b.f.conn, purchase).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), PURCHASE_ON_RECORD);
    }
    let refused =
        b.f.conn
            .execute("DELETE FROM purchase WHERE id = ?1", [&b.worktop])
            .unwrap_err();
    assert!(
        refused.to_string().contains("FOREIGN KEY"),
        "the schema refuses it again: {refused}"
    );

    let refused = remove_stage(&b.f.conn, &b.f.kitchen).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert_eq!(refused.to_string(), STAGE_HAS_PURCHASES_ON_RECORD);
    let refused =
        b.f.conn
            .execute("DELETE FROM stage WHERE id = ?1", [&b.f.kitchen])
            .unwrap_err();
    assert!(refused.to_string().contains("FOREIGN KEY"), "{refused}");
    assert_eq!(snapshot(&b.f.conn).unwrap().purchases.len(), 3);

    purchases::remove(&b.f.conn, &b.tiles).expect("nothing has happened to it");
    assert_eq!(snapshot(&b.f.conn).unwrap().purchases.len(), 2);
}

/// A stage removed takes the purchases nothing has happened to, and the ones
/// after close up; an activity removed lets go of its purchases — they are
/// needed by the stage's first activity.
#[test]
fn a_stage_removed_takes_its_purchases_and_an_activity_removed_lets_go_of_them() {
    let f = fixture();
    let worktop = purchases::add(
        &f.conn,
        &fields(&f.kitchen, Some(&f.worktop_fit), "Worktop", 21),
    )
    .unwrap();
    purchases::add(&f.conn, &fields(&f.bathroom, None, "Tiles", 10)).unwrap();
    let grout = purchases::add(&f.conn, &fields(&f.bathroom, Some(&f.tiling), "Grout", 2)).unwrap();
    let mirror = add_stage(&f.conn, "Hall").unwrap();
    let hang = add_activity(&f.conn, &mirror, "Hang the mirror").unwrap();
    let glass = purchases::add(&f.conn, &fields(&mirror, Some(&hang), "Mirror glass", 14)).unwrap();

    remove_activity(&f.conn, &f.worktop_fit).unwrap();
    let plan = snapshot(&f.conn).unwrap();
    assert_eq!(plan.purchases[0].id, worktop);
    assert_eq!(plan.purchases[0].activity_id, None, "let go, kept");

    remove_stage(&f.conn, &f.bathroom).unwrap();
    let order: Vec<_> = snapshot(&f.conn)
        .unwrap()
        .purchases
        .iter()
        .map(|p| (p.position, p.id.clone()))
        .collect();
    assert_eq!(order, vec![(1, worktop), (2, glass)]);
    assert!(!order.iter().any(|(_, id)| *id == grout));
}

fn insert_event(
    conn: &Connection,
    purchase: &str,
    seq: i64,
    kind: &str,
    day: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO purchase_event (purchase_id, seq, kind, day, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, 'x', 't')",
        params![purchase, seq, kind, day],
    )
}

/// The order of what can happen is the schema's as well as the host's.
#[test]
fn the_schema_refuses_an_event_out_of_order_past_the_host() {
    let b = bought();
    let conn = &b.f.conn;
    for (case, purchase, seq, kind, day) in [
        (
            "delivered with no order",
            &b.tiles,
            1,
            "delivered",
            "2026-10-09",
        ),
        (
            "cancelled with no order",
            &b.tiles,
            1,
            "cancelled",
            "2026-10-09",
        ),
        (
            "delivered after a cancellation",
            &b.handles,
            3,
            "delivered",
            "2026-10-09",
        ),
        (
            "cancelled after a cancellation",
            &b.handles,
            3,
            "cancelled",
            "2026-10-09",
        ),
        (
            "ordered after a delivery",
            &b.worktop,
            3,
            "ordered",
            "2026-10-09",
        ),
        (
            "cancelled after a delivery",
            &b.worktop,
            3,
            "cancelled",
            "2026-10-09",
        ),
        (
            "before the event it follows",
            &b.handles,
            3,
            "ordered",
            "2026-10-06",
        ),
    ] {
        let refused = insert_event(conn, purchase, seq, kind, day).unwrap_err();
        assert!(
            refused.to_string().contains("purchase: event"),
            "{case}: {refused}"
        );
    }
    insert_event(conn, &b.tiles, 1, "ordered", "2026-10-09").expect("ordered first");
    let refused = insert_event(conn, &b.tiles, 2, "ordered", "2026-10-09").unwrap_err();
    assert!(
        refused.to_string().contains("purchase: event"),
        "ordered twice: {refused}"
    );
    insert_event(conn, &b.tiles, 2, "delivered", "2026-10-09").expect("on the open order");
    for (case, seq, kind, day) in [
        ("a kind that is not one", 3, "lost", "2026-10-09"),
        ("a day that does not exist", 3, "ordered", "2026-02-30"),
        ("a day written loosely", 3, "ordered", "2026-2-3"),
    ] {
        assert!(
            insert_event(conn, &b.handles, seq, kind, day).is_err(),
            "{case}"
        );
    }
    let refused = insert_event(conn, &new_id(), 1, "ordered", "2026-10-09").unwrap_err();
    assert!(
        refused.to_string().contains("FOREIGN KEY"),
        "a purchase not in the work: {refused}"
    );
}

/// A purchase is plan: the schema keeps its shape and its place, not its
/// history.
#[test]
fn the_schema_refuses_a_purchase_out_of_shape_or_on_an_activity_of_another_stage() {
    let b = bought();
    let conn = &b.f.conn;
    for sql in [
        "UPDATE purchase SET lead_days = 366".to_string(),
        "UPDATE purchase SET lead_days = -1".to_string(),
        "UPDATE purchase SET lead_days = 1.5".to_string(),
        "UPDATE purchase SET name = '  '".to_string(),
        format!("UPDATE purchase SET name = '{}'", "n".repeat(201)),
        format!("UPDATE purchase SET quantity = '{}'", "q".repeat(61)),
        format!("UPDATE purchase SET supplier = '{}'", "s".repeat(121)),
        format!("UPDATE purchase SET note = '{}'", "n".repeat(2001)),
        "UPDATE purchase SET quantity = ''".to_string(),
        "UPDATE purchase SET supplier = ''".to_string(),
        "UPDATE purchase SET note = ''".to_string(),
        "UPDATE purchase SET position = 0".to_string(),
        format!("UPDATE purchase SET stage_id = '{}'", new_id()),
    ] {
        assert!(conn.execute(&sql, []).is_err(), "{sql}");
    }
    // A purchase nothing has happened to, so only its place is in question.
    let sink = purchases::add(
        conn,
        &fields(&b.f.kitchen, Some(&b.f.worktop_fit), "Sink", 7),
    )
    .unwrap();
    let refused = conn
        .execute(
            "UPDATE purchase SET activity_id = ?1 WHERE id = ?2",
            [&b.f.tiling, &sink],
        )
        .unwrap_err();
    assert!(
        refused.to_string().contains("purchase: activity"),
        "{refused}"
    );
    let refused = conn
        .execute(
            "UPDATE purchase SET stage_id = ?1 WHERE id = ?2",
            [&b.f.bathroom, &sink],
        )
        .unwrap_err();
    assert!(
        refused.to_string().contains("purchase: activity"),
        "moved away from its activity's stage: {refused}"
    );
    let refused = conn
        .execute(
            "INSERT INTO purchase (id, position, stage_id, activity_id, name, lead_days, created_at)
             VALUES (?1, 9, ?2, ?3, 'Odd', 1, 't')",
            [&new_id(), &b.f.kitchen, &b.f.tiling],
        )
        .unwrap_err();
    assert!(
        refused.to_string().contains("purchase: activity"),
        "{refused}"
    );
}

/// The terms of an order are fixed by the schema as well as the host: a
/// purchase something has happened to keeps its lead time, its stage and its
/// activity, and its words still change.
#[test]
fn the_schema_fixes_the_lead_time_stage_and_activity_of_a_purchase_on_record() {
    let b = bought();
    let conn = &b.f.conn;
    for (sql, id) in [
        (
            "UPDATE purchase SET lead_days = 30 WHERE id = ?1",
            &b.worktop,
        ),
        (
            "UPDATE purchase SET activity_id = NULL WHERE id = ?1",
            &b.worktop,
        ),
        (
            "UPDATE purchase SET lead_days = 0 WHERE id = ?1",
            &b.handles,
        ),
    ] {
        let refused = conn.execute(sql, [id]).unwrap_err();
        assert!(
            refused.to_string().contains("purchase: ordered"),
            "{sql}: {refused}"
        );
    }
    let refused = conn
        .execute(
            "UPDATE purchase SET activity_id = ?1 WHERE id = ?2",
            [&b.f.cabinets, &b.worktop],
        )
        .unwrap_err();
    assert!(
        refused.to_string().contains("purchase: ordered"),
        "{refused}"
    );
    let refused = conn
        .execute(
            "UPDATE purchase SET stage_id = ?1 WHERE id = ?2",
            [&b.f.bathroom, &b.handles],
        )
        .unwrap_err();
    assert!(
        refused.to_string().contains("purchase: ordered"),
        "{refused}"
    );

    for sql in [
        "UPDATE purchase SET name = 'Worktop, oak', quantity = '3.2 m', supplier = 'Yard',
                             note = 'Oiled.' WHERE id = ?1",
        "UPDATE purchase SET lead_days = lead_days, stage_id = stage_id,
                             activity_id = activity_id WHERE id = ?1",
    ] {
        conn.execute(sql, [&b.worktop])
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    }
    conn.execute(
        "UPDATE purchase SET lead_days = 30 WHERE id = ?1",
        [&b.tiles],
    )
    .expect("nothing has happened to the tiles");
}

/// Every way SQL can rewrite what happened, with `recursive_triggers` on and
/// off.
#[test]
fn every_update_delete_replace_and_upsert_of_an_event_is_refused_whatever_the_pragmas() {
    let b = bought();
    let before = snapshot(&b.f.conn).unwrap().purchases;
    let (worktop, handles) = (&b.worktop, &b.handles);

    let attacks = [
        "UPDATE purchase_event SET kind = 'cancelled'".to_string(),
        format!("UPDATE purchase_event SET day = '2026-01-01' WHERE purchase_id = '{worktop}'"),
        "UPDATE purchase_event SET note = 'Rewritten'".to_string(),
        format!(
            "UPDATE OR REPLACE purchase_event SET seq = 1 WHERE purchase_id = '{handles}' AND seq = 2"
        ),
        format!("UPDATE purchase_event SET purchase_id = '{handles}' WHERE purchase_id = '{worktop}'"),
        "DELETE FROM purchase_event".to_string(),
        format!("DELETE FROM purchase_event WHERE purchase_id = '{worktop}' AND seq = 2"),
        format!(
            "INSERT OR REPLACE INTO purchase_event (purchase_id, seq, kind, day, author_name, created_at)
             VALUES ('{worktop}', 2, 'cancelled', '2026-10-08', 'x', 't')"
        ),
        format!(
            "REPLACE INTO purchase_event (purchase_id, seq, kind, day, author_name, created_at)
             VALUES ('{handles}', 2, 'delivered', '2026-10-08', 'x', 't')"
        ),
        format!(
            "INSERT INTO purchase_event (purchase_id, seq, kind, day, author_name, created_at)
             VALUES ('{worktop}', 1, 'ordered', '2026-10-05', 'x', 't')
             ON CONFLICT (purchase_id, seq) DO UPDATE SET kind = 'cancelled'"
        ),
        // A seq that does not continue: a gap, or one from the past.
        format!(
            "INSERT INTO purchase_event (purchase_id, seq, kind, day, author_name, created_at)
             VALUES ('{handles}', 9, 'ordered', '2026-10-08', 'x', 't')"
        ),
        format!(
            "INSERT INTO purchase_event (purchase_id, seq, kind, day, author_name, created_at)
             VALUES ('{}', 2, 'ordered', '2026-10-08', 'x', 't')",
            b.tiles
        ),
    ];
    for recursive in ["ON", "OFF"] {
        b.f.conn
            .pragma_update(None, "recursive_triggers", recursive)
            .unwrap();
        for attack in &attacks {
            let refused =
                b.f.conn
                    .execute(attack, [])
                    .expect_err(&format!("recursive_triggers {recursive}: {attack}"));
            assert!(
                refused.to_string().contains(REFUSAL),
                "recursive_triggers {recursive}: `{attack}` was refused for the wrong reason: {refused}"
            );
        }
    }
    assert_eq!(
        snapshot(&b.f.conn).unwrap().purchases,
        before,
        "every purchase and every event reads as it did"
    );
}

/// Why the events carry a `BEFORE INSERT` guard as well as their `BEFORE
/// DELETE` trigger: with `recursive_triggers` off, a `REPLACE` removes the row
/// it replaces without firing a DELETE trigger. The guard is taken away here,
/// on this connection only, to show the hole it closes.
#[test]
fn without_the_insert_guard_a_replace_would_rewrite_a_delivery_when_recursive_triggers_are_off() {
    let b = bought();
    b.f.conn
        .execute_batch(
            "DROP TRIGGER purchase_event_no_replace; DROP TRIGGER purchase_event_continues;",
        )
        .unwrap();
    b.f.conn
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();
    b.f.conn
        .execute(
            "INSERT OR REPLACE INTO purchase_event
               (purchase_id, seq, kind, day, author_name, created_at)
             VALUES (?1, 2, 'cancelled', '2026-10-08', 'Somebody', 't')",
            [&b.worktop],
        )
        .expect("the hole: the delivery is replaced and no trigger saw it go");
    let kind: String =
        b.f.conn
            .query_row(
                "SELECT kind FROM purchase_event WHERE purchase_id = ?1 AND seq = 2",
                [&b.worktop],
                |r| r.get(0),
            )
            .unwrap();
    assert_eq!(kind, "cancelled");
}

/// The rule in `db::purchase_events`' header, checked against its source.
#[test]
fn the_module_that_writes_the_events_holds_no_update_delete_or_replace() {
    let source = include_str!("purchase_events.rs");
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
        "db/purchase_events.rs must write by INSERT only: {offending:?}"
    );
    assert!(source.contains("INSERT INTO purchase_event"));
}

/// No module but `db::purchase_events` names the events' table in a statement
/// that writes.
#[test]
fn no_other_module_writes_the_events() {
    let sources = [
        ("purchases.rs", include_str!("purchases.rs")),
        ("work.rs", include_str!("work.rs")),
        ("order.rs", include_str!("order.rs")),
        ("templates.rs", include_str!("templates.rs")),
        ("change_effects.rs", include_str!("change_effects.rs")),
    ];
    for (file, source) in sources {
        let product = source.split("#[cfg(test)]").next().unwrap_or(source);
        let lower = product.to_ascii_lowercase();
        for verb in ["insert into ", "update ", "delete from ", "replace into "] {
            assert!(
                !lower.contains(&format!("{verb}purchase_event")),
                "{file} writes the purchase events"
            );
        }
    }
}
