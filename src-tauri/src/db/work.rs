//! A work's database: the SQL that reads and writes the plan.
//!
//! Values arrive here already checked (`crate::validate`) and are checked once
//! more by the schema. What this module adds is the one thing only the file can
//! answer — whether the stage, activity or person an id names is in this work —
//! and it answers with a sentence rather than a foreign-key failure.
//!
//! Every write is one transaction. There is no statement here that writes
//! progress, because there is no column for it.
//!
//! Rooms and the rooms an activity touches are in `db::rooms`; order — moves,
//! and positions closed up after a removal — is in `db::order`.
//!
//! # Changelog of this repository
//!
//! - F0: the work row, the calendar and its holidays, people, stages and
//!   activities; the snapshot.
//! - F1: an activity's quantity and unit, and the pairing between them; rooms
//!   and each activity's rooms in the snapshot; a person renamed or removed;
//!   positions closed up after a removal.
//! - F2: the approval (`approved_at`, set once, by the first baseline); the
//!   snapshot carries dependencies and baselines; removing an activity or a
//!   stage removes the dependencies that name it, in the same transaction.
//! - F3: the snapshot carries decisions; a stage's removal takes its decisions
//!   with it (the schema's `ON DELETE CASCADE`).
//! - F5: a stage's lifecycle (`started_at`, `closed_at`) and its checks and
//!   answers in the snapshot; a closed stage refuses changes to its name and
//!   its activities (`stage_closed`); a stage whose checks were answered cannot
//!   be removed.
//! - F6: a person's trade (`update_person` replaces the rename alone); the
//!   snapshot carries cost lines, commitments and the ledger; a stage with
//!   payments, or a person the money names, cannot be removed.
//! - F7: a person as a contact (phone, e-mail, note, availability) with the
//!   stages they are expected on; the snapshot carries documents.
//! - F8: the snapshot carries the open replanning. The lock on an approved
//!   plan is `db::replanning`'s, asked by the commands before they call here.
//! - D1: `update_activity` writes an activity's range (`ActivityChange.range`,
//!   both ends in one statement) and refuses a change to the duration or the
//!   range that leaves the duration outside it. No migration: the columns and
//!   their `CHECK`s are F9's (work migration 010).
//! - D2: an activity a payment milestone is earned by is not removed
//!   (`db::milestones`); the snapshot's commitments carry their payment plans.
//! - D3: the snapshot carries care notes; a stage's removal takes its care
//!   notes with it, in the same transaction.
//! - E1: the snapshot carries change orders (`db::change_orders`);
//!   `update_activity_within` and `remove_activity_within`, the same checks
//!   inside a transaction the caller holds, so an approved change order's
//!   effects are written through them with its decision or not at all.
//! - E2: the snapshot carries the funds and the money received
//!   (`db::funding`, `db::funding_receipts`).
//! - E4: the snapshot carries snags, each with its closure (`db::snags`).
//! - G1: the snapshot carries the meetings' minutes, each action with its
//!   closure (`db::meetings`).
//! - G2: the snapshot carries purchases, each with its events
//!   (`db::purchases`); a stage's removal takes the purchases nothing has
//!   happened to with it and closes their positions up, and is refused while
//!   a purchase of it has been ordered; so is an activity's removal while a
//!   purchase it needs has been ordered.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::{Activity, Calendar, Holiday, Person, Room, Stage, Work, WorkSnapshot};
use crate::db::order::{ACTIVITIES, PURCHASES, STAGES};
use crate::db::{
    baselines, care_notes, change_orders, check_answers, checks, decisions, dependencies,
    documents, funding, funding_receipts, meetings, milestones, money, payments, purchases,
    replanning, snags,
};
use crate::db::{migrations, new_id, now};
use crate::error::{Error, Result};

/// A new work, as it is first written. Every field is already checked.
#[derive(Debug, Clone, PartialEq)]
pub struct NewWork {
    /// UUID v7.
    pub work_id: String,
    /// The name.
    pub name: String,
    /// The place; may be empty.
    pub place: String,
    /// `YYYY-MM-DD`.
    pub start_date: String,
    /// Three upper-case letters.
    pub currency: String,
    /// Seven ones and zeros, not all zeros.
    pub working_days: String,
    /// More than 0, at most 24.
    pub hours_per_day: f64,
}

/// Create a work's schema and its first rows in an empty database.
///
/// Every work migration, the work row at the version they produce, and the
/// calendar row — in one transaction, so a file either holds a whole work or
/// nothing.
///
/// # Errors
///
/// [`Error::Database`] when the database is not empty or a row is refused.
pub fn create(conn: &Connection, work: &NewWork) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (_, sql) in migrations::WORK.sources() {
        tx.execute_batch(sql)?;
    }
    tx.execute(
        "INSERT INTO work (id, schema_version, work_id, name, place, start_date, currency, created_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            migrations::WORK.target_version(),
            work.work_id,
            work.name,
            work.place,
            work.start_date,
            work.currency,
            now(),
        ],
    )?;
    tx.execute(
        "INSERT INTO calendar (id, working_days, hours_per_day) VALUES (1, ?1, ?2)",
        params![work.working_days, work.hours_per_day],
    )?;
    tx.commit()?;
    Ok(())
}

/// The work row.
///
/// # Errors
///
/// [`Error::Database`] when the row cannot be read.
pub fn work(conn: &Connection) -> Result<Work> {
    let work = conn.query_row(
        "SELECT work_id, name, place, start_date, currency, created_at, approved_at,
                template_id, template_version, template_title
         FROM work WHERE id = 1",
        [],
        |row| {
            Ok(Work {
                work_id: row.get(0)?,
                name: row.get(1)?,
                place: row.get(2)?,
                start_date: row.get(3)?,
                currency: row.get(4)?,
                created_at: row.get(5)?,
                approved_at: row.get(6)?,
                template_id: row.get(7)?,
                template_version: row.get(8)?,
                template_title: row.get(9)?,
            })
        },
    )?;
    Ok(work)
}

/// The whole plan.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn snapshot(conn: &Connection) -> Result<WorkSnapshot> {
    let calendar = conn.query_row(
        "SELECT working_days, hours_per_day FROM calendar WHERE id = 1",
        [],
        |row| {
            Ok(Calendar {
                working_days: row.get(0)?,
                hours_per_day: row.get(1)?,
            })
        },
    )?;

    let holidays = conn
        .prepare("SELECT date, name FROM holiday ORDER BY date")?
        .query_map([], |row| {
            Ok(Holiday {
                date: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let people = conn
        .prepare(
            "SELECT id, name, trade, phone, email, note, availability FROM person
             ORDER BY name COLLATE NOCASE, id",
        )?
        .query_map([], |row| {
            Ok(Person {
                id: row.get(0)?,
                name: row.get(1)?,
                trade: row.get(2)?,
                phone: row.get(3)?,
                email: row.get(4)?,
                note: row.get(5)?,
                availability: row.get(6)?,
                stage_ids: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut stages_of: HashMap<String, Vec<String>> = HashMap::new();
    let expected = conn
        .prepare(
            "SELECT ps.person_id, ps.stage_id FROM person_stage ps
             JOIN stage s ON s.id = ps.stage_id ORDER BY s.position",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (person, stage) in expected {
        stages_of.entry(person).or_default().push(stage);
    }
    let people: Vec<Person> = people
        .into_iter()
        .map(|mut person| {
            person.stage_ids = stages_of.remove(&person.id).unwrap_or_default();
            person
        })
        .collect();

    let stages = conn
        .prepare("SELECT id, position, name, started_at, closed_at FROM stage ORDER BY position")?
        .query_map([], |row| {
            Ok(Stage {
                id: row.get(0)?,
                position: row.get(1)?,
                name: row.get(2)?,
                started_at: row.get(3)?,
                closed_at: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let rooms = conn
        .prepare("SELECT id, position, name FROM room ORDER BY position")?
        .query_map([], |row| {
            Ok(Room {
                id: row.get(0)?,
                position: row.get(1)?,
                name: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    // Each activity's rooms, in the rooms' order.
    let mut rooms_of: HashMap<String, Vec<String>> = HashMap::new();
    let links = conn
        .prepare(
            "SELECT ar.activity_id, ar.room_id
             FROM activity_room ar JOIN room r ON r.id = ar.room_id
             ORDER BY r.position",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (activity, room) in links {
        rooms_of.entry(activity).or_default().push(room);
    }

    let activities = conn
        .prepare(
            "SELECT a.id, a.stage_id, a.position, a.name, a.duration_days, a.responsible_id,
                    a.quantity, a.unit, a.duration_min_days, a.duration_max_days
             FROM activity a JOIN stage s ON s.id = a.stage_id
             ORDER BY s.position, a.position",
        )?
        .query_map([], |row| {
            Ok(Activity {
                id: row.get(0)?,
                stage_id: row.get(1)?,
                position: row.get(2)?,
                name: row.get(3)?,
                duration_days: row.get(4)?,
                duration_min_days: row.get(8)?,
                duration_max_days: row.get(9)?,
                responsible_id: row.get(5)?,
                room_ids: Vec::new(),
                quantity: row.get(6)?,
                unit: row.get(7)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut activity| {
            activity.room_ids = rooms_of.remove(&activity.id).unwrap_or_default();
            activity
        })
        .collect();

    Ok(WorkSnapshot {
        work: work(conn)?,
        calendar,
        holidays,
        people,
        stages,
        rooms,
        activities,
        dependencies: dependencies::list(conn)?,
        baselines: baselines::list(conn)?,
        decisions: decisions::list(conn)?,
        checks: checks::list(conn)?,
        check_answers: check_answers::list(conn)?,
        cost_lines: money::cost_lines(conn)?,
        commitments: money::commitments(conn)?,
        payments: payments::list(conn)?,
        documents: documents::list(conn)?,
        replanning: replanning::current(conn)?,
        care_notes: care_notes::list(conn)?,
        change_orders: change_orders::list(conn)?,
        funding: funding::list(conn)?,
        funding_receipts: funding_receipts::list(conn)?,
        snags: snags::list(conn)?,
        meetings: meetings::list(conn)?,
        purchases: purchases::list(conn)?,
    })
}

/// Record that the plan was approved, now — once. A work already approved
/// keeps the instant it was first approved; the schema refuses to change it.
/// Called by `db::baselines::take` inside the transaction that takes baseline 1.
///
/// # Errors
///
/// [`Error::Database`] when the row cannot be written.
pub fn record_approval(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE work SET approved_at = ?1 WHERE id = 1 AND approved_at IS NULL",
        [now()],
    )?;
    Ok(())
}

/// Change the work row. `None` leaves a field alone.
///
/// # Errors
///
/// [`Error::Database`] when the row is refused.
pub fn update_work(
    conn: &Connection,
    name: Option<&str>,
    place: Option<&str>,
    start_date: Option<&str>,
    currency: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE work SET name = coalesce(?1, name),
                         place = coalesce(?2, place),
                         start_date = coalesce(?3, start_date),
                         currency = coalesce(?4, currency)
         WHERE id = 1",
        params![name, place, start_date, currency],
    )?;
    Ok(())
}

/// Replace the calendar and every holiday with these.
///
/// # Errors
///
/// [`Error::Database`] when a row is refused.
pub fn set_calendar(conn: &Connection, calendar: &Calendar, holidays: &[Holiday]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE calendar SET working_days = ?1, hours_per_day = ?2 WHERE id = 1",
        params![calendar.working_days, calendar.hours_per_day],
    )?;
    tx.execute("DELETE FROM holiday", [])?;
    for holiday in holidays {
        tx.execute(
            "INSERT INTO holiday (date, name) VALUES (?1, ?2)",
            params![holiday.date, holiday.name],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Add a person; returns their id.
///
/// # Errors
///
/// [`Error::Database`] when the row is refused.
pub fn add_person(conn: &Connection, name: &str) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO person (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, now()],
    )?;
    Ok(id)
}

/// What a person update changes. `None` leaves a field alone; `Some(None)`
/// clears it. Every value is already checked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PersonChange {
    /// A new name.
    pub name: Option<String>,
    /// A trade, or none.
    pub trade: Option<Option<String>>,
    /// A phone, or none.
    pub phone: Option<Option<String>>,
    /// An e-mail, or none.
    pub email: Option<Option<String>>,
    /// A note, or none.
    pub note: Option<Option<String>>,
    /// An availability, or none.
    pub availability: Option<Option<String>>,
}

/// Change a person: name, trade, contact fields — any of them.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the person is not in this work.
pub fn update_person(conn: &Connection, id: &str, change: &PersonChange) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
    }
    if let Some(name) = &change.name {
        tx.execute(
            "UPDATE person SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;
    }
    // The column names are constants of this function, never input.
    for (column, value) in [
        ("trade", &change.trade),
        ("phone", &change.phone),
        ("email", &change.email),
        ("note", &change.note),
        ("availability", &change.availability),
    ] {
        if let Some(value) = value {
            tx.execute(
                &format!("UPDATE person SET {column} = ?2 WHERE id = ?1"),
                params![id, value],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Replace the stages a person is expected on. An empty list means none.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the person, or any of the stages, is not in
/// this work — and then nothing changes.
pub fn set_person_stages(conn: &Connection, id: &str, stage_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
    }
    let stages: std::collections::BTreeSet<&str> = stage_ids.iter().map(String::as_str).collect();
    for stage in &stages {
        if !exists(&tx, "SELECT 1 FROM stage WHERE id = ?1", stage)? {
            return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
        }
    }
    tx.execute("DELETE FROM person_stage WHERE person_id = ?1", [id])?;
    for stage in stages {
        tx.execute(
            "INSERT INTO person_stage (person_id, stage_id) VALUES (?1, ?2)",
            params![id, stage],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Remove a person. Every activity they were responsible for is left with
/// nobody responsible — the schema's `ON DELETE SET NULL` — and readiness will
/// say so.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the person is not in this work, or a
/// commitment or a payment names them.
pub fn remove_person(conn: &Connection, id: &str) -> Result<()> {
    money::refuse_if_person_in_the_money(conn, id)?;
    let changed = conn.execute("DELETE FROM person WHERE id = ?1", [id])?;
    found(changed, PERSON_NOT_FOUND)
}

/// Add a stage after the last one; returns its id.
///
/// # Errors
///
/// [`Error::Database`] when the row is refused.
pub fn add_stage(conn: &Connection, name: &str) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO stage (id, position, name, created_at)
         VALUES (?1, (SELECT coalesce(max(position), 0) + 1 FROM stage), ?2, ?3)",
        params![id, name, now()],
    )?;
    Ok(id)
}

/// Rename a stage.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the stage is not in this work.
pub fn rename_stage(conn: &Connection, id: &str, name: &str) -> Result<()> {
    refuse_if_stage_closed(conn, id)?;
    let changed = conn.execute(
        "UPDATE stage SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    found(changed, STAGE_NOT_FOUND)
}

/// Remove a stage and, with it, its activities; the stages after it close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the stage is not in this work, its checks
/// have been answered (answers are facts), or a purchase of it has been
/// ordered (G2); [`Error::StageClosed`] when it is closed. Its purchases
/// nothing has happened to go with it (the schema's `ON DELETE CASCADE`), and
/// the purchases after them close up.
pub fn remove_stage(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    refuse_if_stage_closed(&tx, id)?;
    checks::refuse_if_stage_answered(&tx, id)?;
    money::refuse_if_stage_paid(&tx, id)?;
    purchases::refuse_if_stage_has_purchases_on_record(&tx, id)?;
    dependencies::remove_naming_stage(&tx, id)?;
    let changed = tx.execute("DELETE FROM stage WHERE id = ?1", [id])?;
    found(changed, STAGE_NOT_FOUND)?;
    care_notes::remove_for(&tx, "stage", id)?;
    STAGES.close_gaps(&tx, None)?;
    PURCHASES.close_gaps(&tx, None)?;
    tx.commit()?;
    Ok(())
}

/// Add an activity at the end of a stage; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the stage is not in this work.
pub fn add_activity(conn: &Connection, stage_id: &str, name: &str) -> Result<String> {
    if !exists(conn, "SELECT 1 FROM stage WHERE id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    refuse_if_stage_closed(conn, stage_id)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO activity (id, stage_id, position, name, created_at)
         VALUES (?1, ?2,
                 (SELECT coalesce(max(position), 0) + 1 FROM activity WHERE stage_id = ?2),
                 ?3, ?4)",
        params![id, stage_id, name, now()],
    )?;
    Ok(id)
}

/// What an activity update changes. `None` leaves a field alone; `Some(None)`
/// clears it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ActivityChange {
    /// A new name.
    pub name: Option<String>,
    /// A new duration, or none.
    pub duration_days: Option<Option<i64>>,
    /// A new responsible, or nobody.
    pub responsible_id: Option<Option<String>>,
    /// A new quantity, or none — which takes the unit with it.
    pub quantity: Option<Option<f64>>,
    /// A new unit, or none. Already trimmed; an empty one is none.
    pub unit: Option<Option<String>>,
    /// A new range, optimistic end first, or none (D1). Each end already a
    /// duration and the first not above the second
    /// (`validate::duration_range`).
    pub range: Option<Option<(i64, i64)>>,
}

/// The sentence for a unit with no quantity beside it.
pub const UNIT_WITHOUT_QUANTITY: &str =
    "A unit needs a quantity: say how much before saying in what.";

/// The sentence for a duration outside its activity's range (D1), naming both.
pub fn duration_outside_range(duration: i64, min: i64, max: i64) -> String {
    let unit = if max == 1 {
        "working day"
    } else {
        "working days"
    };
    let one = if duration == 1 {
        "working day"
    } else {
        "working days"
    };
    format!(
        "A duration of {duration} {one} is outside the range of {min} to {max} {unit}: \
         the duration lies between the optimistic and the pessimistic ends."
    )
}

/// Change an activity.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the activity, or the person named responsible,
/// is not in this work; and when a change to the duration or the range would
/// leave the duration outside the range ([`duration_outside_range`]).
pub fn update_activity(conn: &Connection, id: &str, change: &ActivityChange) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    update_activity_within(&tx, id, change)?;
    tx.commit()?;
    Ok(())
}

/// [`update_activity`], inside a transaction the caller already holds and
/// commits (E1: an approved change order's effects are written with its
/// decision, or not at all).
///
/// # Errors
///
/// As [`update_activity`].
pub fn update_activity_within(tx: &Connection, id: &str, change: &ActivityChange) -> Result<()> {
    if !exists(tx, "SELECT 1 FROM activity WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(ACTIVITY_NOT_FOUND.into()));
    }
    refuse_if_activity_closed(tx, id)?;
    refuse_if_duration_leaves_range(tx, id, change)?;
    if let Some(range) = change.range {
        tx.execute(
            "UPDATE activity SET duration_min_days = ?2, duration_max_days = ?3 WHERE id = ?1",
            params![id, range.map(|(min, _)| min), range.map(|(_, max)| max)],
        )?;
    }
    if let Some(name) = &change.name {
        tx.execute(
            "UPDATE activity SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;
    }
    if let Some(duration) = change.duration_days {
        tx.execute(
            "UPDATE activity SET duration_days = ?2 WHERE id = ?1",
            params![id, duration],
        )?;
    }
    if let Some(responsible) = &change.responsible_id {
        if let Some(person) = responsible {
            if !exists(tx, "SELECT 1 FROM person WHERE id = ?1", person)? {
                return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
            }
        }
        tx.execute(
            "UPDATE activity SET responsible_id = ?2 WHERE id = ?1",
            params![id, responsible],
        )?;
    }
    if change.quantity.is_some() || change.unit.is_some() {
        let (quantity, unit) = quantity_and_unit(tx, id, change)?;
        tx.execute(
            "UPDATE activity SET quantity = ?2, unit = ?3 WHERE id = ?1",
            params![id, quantity, unit],
        )?;
    }
    Ok(())
}

/// Refuse a change to the duration or the range that leaves a duration outside
/// a range (D1).
///
/// Only a change is asked: a patch that touches neither, or sends what is
/// held, passes whatever the row holds — a duration typed outside a range
/// before D1 (F9 allowed it) is not refused when the name or the responsible
/// changes, nor when the same values are sent again. A duration edit outside
/// the range is refused rather than widening the range or clearing it: either
/// would change an estimate the person gave without their saying so, and the
/// fix is one patch — the range, or both together.
pub(crate) fn refuse_if_duration_leaves_range(
    conn: &Connection,
    id: &str,
    change: &ActivityChange,
) -> Result<()> {
    if change.duration_days.is_none() && change.range.is_none() {
        return Ok(());
    }
    let (held_duration, held_min, held_max): (Option<i64>, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT duration_days, duration_min_days, duration_max_days FROM activity
             WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    let held_range = held_min.zip(held_max);
    let duration = change.duration_days.unwrap_or(held_duration);
    let range = change.range.unwrap_or(held_range);
    if (duration, range) == (held_duration, held_range) {
        return Ok(());
    }
    match (duration, range) {
        (Some(duration), Some((min, max))) if duration < min || duration > max => Err(
            Error::InvalidInput(duration_outside_range(duration, min, max)),
        ),
        _ => Ok(()),
    }
}

/// The quantity and unit an activity will hold after `change`.
///
/// A unit sent explicitly is taken as sent. A quantity cleared without a unit
/// being sent takes the unit with it: "12 m²" with the 12 removed is not "m²".
/// Whatever the result, a unit with no quantity is refused.
fn quantity_and_unit(
    conn: &Connection,
    id: &str,
    change: &ActivityChange,
) -> Result<(Option<f64>, Option<String>)> {
    let (held_quantity, held_unit): (Option<f64>, Option<String>) = conn.query_row(
        "SELECT quantity, unit FROM activity WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let quantity = change.quantity.unwrap_or(held_quantity);
    let unit = match (&change.quantity, &change.unit) {
        (_, Some(unit)) => unit.clone(),
        (Some(None), None) => None,
        (_, None) => held_unit,
    };
    if unit.is_some() && quantity.is_none() {
        return Err(Error::InvalidInput(UNIT_WITHOUT_QUANTITY.into()));
    }
    Ok((quantity, unit))
}

/// Remove an activity; the activities after it in its stage close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the activity is not in this work, a payment
/// milestone is earned by its finish (D2), or a purchase it needs has been
/// ordered (G2).
pub fn remove_activity(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    remove_activity_within(&tx, id)?;
    tx.commit()?;
    Ok(())
}

/// [`remove_activity`], inside a transaction the caller already holds and
/// commits (E1).
///
/// # Errors
///
/// As [`remove_activity`].
pub fn remove_activity_within(tx: &Connection, id: &str) -> Result<()> {
    let stage = ACTIVITIES.scope_of(tx, id)?;
    refuse_if_activity_closed(tx, id)?;
    milestones::refuse_if_activity_earns(tx, id)?;
    purchases::refuse_if_activity_has_purchases_on_record(tx, id)?;
    dependencies::remove_naming_activity(tx, id)?;
    tx.execute("DELETE FROM activity WHERE id = ?1", [id])?;
    ACTIVITIES.close_gaps(tx, stage.as_deref())?;
    Ok(())
}

/// The sentence for a stage id that is not in this work.
pub const STAGE_NOT_FOUND: &str = "That stage is not in this work.";
/// The sentence for an activity id that is not in this work.
pub const ACTIVITY_NOT_FOUND: &str = "That activity is not in this work.";
/// The sentence for a person id that is not in this work.
pub const PERSON_NOT_FOUND: &str = "That person is not in this work.";
/// The sentence for a room id that is not in this work.
pub const ROOM_NOT_FOUND: &str = "That room is not in this work.";
/// The sentence for a decision id that is not in this work.
pub const DECISION_NOT_FOUND: &str = "That decision is not in this work.";

/// Refuse when a stage is closed: a closed stage is read-only until it is
/// reopened. A stage that is not there is not refused here — the caller says
/// so with its own sentence.
///
/// # Errors
///
/// [`Error::StageClosed`] naming the stage.
pub fn refuse_if_stage_closed(conn: &Connection, stage_id: &str) -> Result<()> {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT name, closed_at FROM stage WHERE id = ?1",
            [stage_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match row {
        Some((name, Some(_))) => Err(Error::StageClosed(name)),
        _ => Ok(()),
    }
}

/// Refuse when an activity's stage is closed.
///
/// # Errors
///
/// [`Error::StageClosed`] naming the stage.
pub fn refuse_if_activity_closed(conn: &Connection, activity_id: &str) -> Result<()> {
    let stage: Option<String> = conn
        .query_row(
            "SELECT stage_id FROM activity WHERE id = ?1",
            [activity_id],
            |row| row.get(0),
        )
        .optional()?;
    match stage {
        Some(stage) => refuse_if_stage_closed(conn, &stage),
        None => Ok(()),
    }
}

/// Whether `sql` (one `?1`) finds a row.
pub(crate) fn exists(conn: &Connection, sql: &str, id: &str) -> Result<bool> {
    Ok(conn.query_row(sql, [id], |_| Ok(())).optional()?.is_some())
}

/// `Ok` when a statement touched a row; the sentence when it touched none.
pub(crate) fn found(changed: usize, sentence: &'static str) -> Result<()> {
    if changed == 0 {
        Err(Error::InvalidInput(sentence.into()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn seed() -> NewWork {
        NewWork {
            work_id: new_id(),
            name: "Synthetic bathroom".into(),
            place: "A synthetic street".into(),
            start_date: "2026-10-05".into(),
            currency: "BRL".into(),
            working_days: "1111100".into(),
            hours_per_day: 8.0,
        }
    }

    pub(crate) fn a_work() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        crate::db::configure(&conn).expect("pragmas");
        create(&conn, &seed()).expect("create");
        conn
    }

    fn refused_by_the_schema(conn: &Connection, sql: &str) -> bool {
        match conn.execute(sql, []) {
            Err(rusqlite::Error::SqliteFailure(error, _)) => {
                error.code == rusqlite::ErrorCode::ConstraintViolation
            }
            _ => false,
        }
    }

    #[test]
    fn a_new_work_holds_every_table_its_row_and_its_calendar_at_the_current_version() {
        let conn = a_work();

        for table in [
            "work",
            "calendar",
            "holiday",
            "person",
            "stage",
            "activity",
            "room",
            "activity_room",
            "dependency",
            "baseline",
            "baseline_activity",
            "decision",
            "diary_entry",
            "diary_done",
            "diary_present",
            "diary_photo",
            "stage_check",
            "check_answer",
            "cost_line",
            "commitment",
            "payment",
            "person_stage",
            "document",
            "document_link",
            "payment_milestone",
            "care_note",
            "change_order",
            "change_order_decision",
            "funding",
            "funding_receipt",
            "snag",
            "snag_closure",
            "meeting",
            "meeting_attendee",
            "meeting_item",
            "meeting_action",
            "meeting_action_closure",
            "purchase",
            "purchase_event",
        ] {
            let found: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(found, 1, "`{table}` is missing");
        }
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        let snapshot = snapshot(&conn).expect("snapshot");
        assert_eq!(snapshot.work.name, "Synthetic bathroom");
        assert_eq!(snapshot.calendar.working_days, "1111100");
        assert_eq!(snapshot.calendar.hours_per_day, 8.0);
        assert!(snapshot.stages.is_empty() && snapshot.activities.is_empty());
    }

    #[test]
    fn applying_the_work_migrations_again_changes_nothing() {
        let conn = a_work();
        migrations::WORK.apply(&conn).expect("again");
        migrations::WORK.apply(&conn).expect("and again");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            snapshot(&conn).expect("snapshot").work.name,
            "Synthetic bathroom"
        );
    }

    #[test]
    fn the_calendar_refuses_a_week_with_no_working_day_and_a_day_of_no_hours() {
        let conn = a_work();

        for sql in [
            "UPDATE calendar SET working_days = '0000000'",
            "UPDATE calendar SET working_days = '111110'",
            "UPDATE calendar SET working_days = '11111002'",
            "UPDATE calendar SET working_days = '111110a'",
            "UPDATE calendar SET hours_per_day = 0",
            "UPDATE calendar SET hours_per_day = -8",
            "UPDATE calendar SET hours_per_day = 25",
            "INSERT INTO calendar (id, working_days, hours_per_day) VALUES (2, '1111100', 8)",
        ] {
            assert!(refused_by_the_schema(&conn, sql), "{sql}");
        }
        assert_eq!(snapshot(&conn).unwrap().calendar.working_days, "1111100");
    }

    #[test]
    fn the_schema_refuses_an_activity_of_zero_days_or_part_of_a_day() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let activity = add_activity(&conn, &stage, "Tiling").unwrap();

        for duration in ["0", "-1", "2.5", "3651", "'three'"] {
            let sql =
                format!("UPDATE activity SET duration_days = {duration} WHERE id = '{activity}'");
            assert!(refused_by_the_schema(&conn, &sql), "{duration}");
        }
        conn.execute(
            "UPDATE activity SET duration_days = 3 WHERE id = ?1",
            [&activity],
        )
        .expect("three whole days");
        conn.execute(
            "UPDATE activity SET duration_days = NULL WHERE id = ?1",
            [&activity],
        )
        .expect("and back to unknown");
    }

    #[test]
    fn the_schema_refuses_empty_or_long_names_a_bad_currency_and_a_day_that_does_not_exist() {
        let conn = a_work();

        for sql in [
            "UPDATE work SET name = ''",
            "UPDATE work SET name = '   '",
            &format!("UPDATE work SET name = '{}'", "x".repeat(121)),
            &format!("UPDATE work SET place = '{}'", "x".repeat(201)),
            "UPDATE work SET currency = 'brl'",
            "UPDATE work SET currency = 'EURO'",
            "UPDATE work SET currency = 'R$'",
            "UPDATE work SET start_date = '2026-02-30'",
            "UPDATE work SET start_date = '5/10/2026'",
            "UPDATE work SET start_date = 'soon'",
            "INSERT INTO holiday (date, name) VALUES ('2026-13-01', 'Nowhere')",
            "INSERT INTO holiday (date, name) VALUES ('2026-12-25', '')",
            "INSERT INTO person (id, name, created_at) VALUES ('short', 'Ana', 't')",
            "INSERT INTO work (id, schema_version, work_id, name, place, start_date, currency,
               created_at) VALUES (2, 1, 'x', 'Two', '', '2026-01-01', 'BRL', 't')",
        ] {
            assert!(refused_by_the_schema(&conn, sql), "{sql}");
        }
    }

    #[test]
    fn stages_and_activities_come_back_in_their_order_and_a_removed_stage_takes_its_activities() {
        let conn = a_work();
        let first = add_stage(&conn, "Demolition").unwrap();
        let second = add_stage(&conn, "Bathroom").unwrap();
        let tiling = add_activity(&conn, &second, "Tiling").unwrap();
        let grout = add_activity(&conn, &second, "Grout").unwrap();
        let strip = add_activity(&conn, &first, "Strip out").unwrap();

        let plan = snapshot(&conn).unwrap();
        let stage_names: Vec<_> = plan
            .stages
            .iter()
            .map(|s| (s.position, s.name.as_str()))
            .collect();
        assert_eq!(stage_names, vec![(1, "Demolition"), (2, "Bathroom")]);
        let ids: Vec<_> = plan.activities.iter().map(|a| a.id.clone()).collect();
        assert_eq!(ids, vec![strip, tiling, grout]);

        remove_stage(&conn, &first).unwrap();
        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.stages.len(), 1);
        assert_eq!(
            plan.activities.len(),
            2,
            "the stage's activity went with it"
        );

        let third = add_stage(&conn, "Painting").unwrap();
        let plan = snapshot(&conn).unwrap();
        assert_eq!(
            plan.stages.iter().map(|s| s.position).collect::<Vec<_>>(),
            vec![1, 2],
            "the removal closed the gap (F1), and a new stage goes after the last"
        );
        assert_eq!(
            plan.stages.iter().find(|s| s.id == third).unwrap().position,
            2,
            "a new stage goes after the last, whatever was removed"
        );
    }

    #[test]
    fn an_activity_takes_a_duration_and_a_responsible_and_can_lose_both() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tiling = add_activity(&conn, &stage, "Tiling").unwrap();
        let ana = add_person(&conn, "Ana (synthetic)").unwrap();

        update_activity(
            &conn,
            &tiling,
            &ActivityChange {
                duration_days: Some(Some(3)),
                responsible_id: Some(Some(ana.clone())),
                ..ActivityChange::default()
            },
        )
        .unwrap();
        let activity = snapshot(&conn).unwrap().activities.remove(0);
        assert_eq!(activity.duration_days, Some(3));
        assert_eq!(activity.responsible_id, Some(ana));

        update_activity(
            &conn,
            &tiling,
            &ActivityChange {
                duration_days: Some(None),
                responsible_id: Some(None),
                ..ActivityChange::default()
            },
        )
        .unwrap();
        let activity = snapshot(&conn).unwrap().activities.remove(0);
        assert_eq!(
            (activity.duration_days, activity.responsible_id),
            (None, None)
        );
    }

    #[test]
    fn an_id_that_is_not_in_this_work_is_a_sentence_not_a_foreign_key_failure() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tiling = add_activity(&conn, &stage, "Tiling").unwrap();
        let nobody = new_id();

        for (refused, sentence) in [
            (
                add_activity(&conn, &nobody, "Tiling").map(|_| ()),
                STAGE_NOT_FOUND,
            ),
            (rename_stage(&conn, &nobody, "Kitchen"), STAGE_NOT_FOUND),
            (remove_stage(&conn, &nobody), STAGE_NOT_FOUND),
            (remove_activity(&conn, &nobody), ACTIVITY_NOT_FOUND),
            (
                update_activity(&conn, &nobody, &ActivityChange::default()),
                ACTIVITY_NOT_FOUND,
            ),
            (
                update_activity(
                    &conn,
                    &tiling,
                    &ActivityChange {
                        responsible_id: Some(Some(nobody.clone())),
                        ..ActivityChange::default()
                    },
                ),
                PERSON_NOT_FOUND,
            ),
        ] {
            let error = refused.expect_err(sentence);
            assert_eq!(error.kind(), "invalid_input");
            assert_eq!(error.to_string(), sentence);
        }
    }

    #[test]
    fn setting_the_calendar_replaces_every_holiday() {
        let conn = a_work();
        let calendar = Calendar {
            working_days: "1111110".into(),
            hours_per_day: 9.0,
        };
        let holiday = |date: &str| Holiday {
            date: date.into(),
            name: "Synthetic holiday".into(),
        };

        set_calendar(
            &conn,
            &calendar,
            &[holiday("2026-12-25"), holiday("2026-11-02")],
        )
        .unwrap();
        set_calendar(&conn, &calendar, &[holiday("2027-01-01")]).unwrap();

        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.calendar, calendar);
        let dates: Vec<_> = plan.holidays.iter().map(|h| h.date.as_str()).collect();
        assert_eq!(dates, vec!["2027-01-01"]);
    }

    /// Write, by hand, a work as F0 left it: schema 1, a stage, an activity
    /// with a duration and a responsible, and a holiday. Returns the activity's
    /// id. Synthetic, like every fixture here.
    pub(crate) fn a_work_at_schema_one(conn: &Connection) -> String {
        let (_, first) = migrations::WORK.sources()[0];
        conn.execute_batch(first).expect("migration 001 alone");
        conn.execute_batch(
            "INSERT INTO work (id, schema_version, work_id, name, place, start_date, currency,
                               created_at)
             VALUES (1, 1, '00000000-0000-7000-8000-000000000001', 'Synthetic F0 work', '',
                     '2026-10-05', 'BRL', '2026-09-25T12:00:00.000Z');
             INSERT INTO calendar (id, working_days, hours_per_day) VALUES (1, '1111100', 8);
             INSERT INTO holiday (date, name) VALUES ('2026-11-02', 'Synthetic holiday');
             INSERT INTO person (id, name, created_at)
             VALUES ('00000000-0000-7000-8000-00000000000a', 'A. Tiler', 't');
             INSERT INTO stage (id, position, name, created_at)
             VALUES ('00000000-0000-7000-8000-00000000000b', 1, 'Bathroom', 't');
             INSERT INTO activity (id, stage_id, position, name, duration_days, responsible_id,
                                   created_at)
             VALUES ('00000000-0000-7000-8000-00000000000c',
                     '00000000-0000-7000-8000-00000000000b', 1, 'Tiling', 3,
                     '00000000-0000-7000-8000-00000000000a', 't');",
        )
        .expect("an F0 work's rows");
        "00000000-0000-7000-8000-00000000000c".into()
    }

    /// The upgrade from the first release of the schema: a work written by F0
    /// opens in this build and loses nothing — and gains rooms, quantities,
    /// units, dependencies and baselines, all empty.
    #[test]
    fn a_work_at_schema_one_with_rows_migrates_to_the_current_version_without_losing_any() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::configure(&conn).unwrap();
        let tiling = a_work_at_schema_one(&conn);
        assert_eq!(migrations::WORK.current_version(&conn), 1);

        migrations::WORK.apply(&conn).expect("migrate 1 → head");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.work.name, "Synthetic F0 work");
        assert_eq!(plan.holidays.len(), 1);
        assert_eq!(plan.people[0].name, "A. Tiler");
        assert_eq!(plan.stages[0].name, "Bathroom");
        let activity = &plan.activities[0];
        assert_eq!(activity.id, tiling);
        assert_eq!(activity.duration_days, Some(3));
        assert_eq!(
            activity.responsible_id.as_deref(),
            Some(plan.people[0].id.as_str())
        );
        assert!(activity.room_ids.is_empty());
        assert_eq!((activity.quantity, activity.unit.clone()), (None, None));
        assert!(plan.rooms.is_empty());

        migrations::WORK
            .apply(&conn)
            .expect("and again, idempotent");
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
    }

    fn one_activity(conn: &Connection) -> String {
        let stage = add_stage(conn, "Bathroom").unwrap();
        add_activity(conn, &stage, "Lay the floor tile").unwrap()
    }

    fn quantity_of(conn: &Connection) -> (Option<f64>, Option<String>) {
        let activity = snapshot(conn).unwrap().activities.remove(0);
        (activity.quantity, activity.unit)
    }

    fn set(
        conn: &Connection,
        id: &str,
        quantity: Option<Option<f64>>,
        unit: Option<Option<&str>>,
    ) -> Result<()> {
        update_activity(
            conn,
            id,
            &ActivityChange {
                quantity,
                unit: unit.map(|unit| unit.map(str::to_string)),
                ..ActivityChange::default()
            },
        )
    }

    #[test]
    fn a_quantity_takes_a_unit_and_clearing_the_quantity_takes_the_unit_with_it() {
        let conn = a_work();
        let id = one_activity(&conn);

        set(&conn, &id, Some(Some(12.0)), Some(Some("m²"))).unwrap();
        assert_eq!(quantity_of(&conn), (Some(12.0), Some("m²".into())));

        set(&conn, &id, Some(Some(14.5)), None).unwrap();
        assert_eq!(
            quantity_of(&conn),
            (Some(14.5), Some("m²".into())),
            "the unit stays"
        );

        set(&conn, &id, None, Some(None)).unwrap();
        assert_eq!(
            quantity_of(&conn),
            (Some(14.5), None),
            "a quantity may stand alone"
        );

        set(&conn, &id, Some(Some(0.0)), Some(Some("un"))).unwrap();
        assert_eq!(
            quantity_of(&conn),
            (Some(0.0), Some("un".into())),
            "zero is a quantity"
        );

        set(&conn, &id, Some(None), None).unwrap();
        assert_eq!(quantity_of(&conn), (None, None));
    }

    #[test]
    fn a_unit_without_a_quantity_is_refused_and_nothing_changes() {
        let conn = a_work();
        let id = one_activity(&conn);

        for (quantity, unit) in [(None, Some(Some("m²"))), (Some(None), Some(Some("m²")))] {
            let refused = set(&conn, &id, quantity, unit).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), UNIT_WITHOUT_QUANTITY);
        }
        assert_eq!(quantity_of(&conn), (None, None));

        set(&conn, &id, Some(Some(12.0)), Some(Some("m²"))).unwrap();
        let refused = set(&conn, &id, Some(None), Some(Some("m²"))).unwrap_err();
        assert_eq!(refused.to_string(), UNIT_WITHOUT_QUANTITY);
        assert_eq!(
            quantity_of(&conn),
            (Some(12.0), Some("m²".into())),
            "rolled back"
        );
    }

    #[test]
    fn the_schema_refuses_a_negative_quantity_a_textual_one_and_a_unit_on_its_own() {
        let conn = a_work();
        let id = one_activity(&conn);

        for assignment in [
            "quantity = -1",
            "quantity = 'twelve'",
            "unit = 'm²'",
            "quantity = 1, unit = ''",
            "quantity = 1, unit = '   '",
            "quantity = 1, unit = '12345678901234567'",
        ] {
            let sql = format!("UPDATE activity SET {assignment} WHERE id = '{id}'");
            assert!(refused_by_the_schema(&conn, &sql), "{assignment}");
        }
        conn.execute(
            "UPDATE activity SET quantity = '12', unit = '1234567890123456' WHERE id = ?1",
            [&id],
        )
        .expect("text that is a number becomes one, and 16 characters fit");
        assert_eq!(quantity_of(&conn).0, Some(12.0));
    }

    #[test]
    fn removing_a_person_leaves_their_activities_with_nobody_responsible() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tile = add_activity(&conn, &stage, "Tile").unwrap();
        let grout = add_activity(&conn, &stage, "Grout").unwrap();
        let tiler = add_person(&conn, "A. Tiler").unwrap();
        let other = add_person(&conn, "B. Plumber").unwrap();
        for (activity, person) in [(&tile, &tiler), (&grout, &other)] {
            update_activity(
                &conn,
                activity,
                &ActivityChange {
                    responsible_id: Some(Some(person.clone())),
                    ..ActivityChange::default()
                },
            )
            .unwrap();
        }

        remove_person(&conn, &tiler).unwrap();

        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.people.len(), 1);
        assert_eq!(plan.activities.len(), 2, "the activities stay");
        assert_eq!(plan.activities[0].responsible_id, None);
        assert_eq!(
            plan.activities[1].responsible_id.as_deref(),
            Some(other.as_str())
        );
    }

    #[test]
    fn a_person_is_renamed_and_an_unknown_one_is_a_sentence() {
        let conn = a_work();
        let id = add_person(&conn, "A. Tiler").unwrap();

        update_person(
            &conn,
            &id,
            &PersonChange {
                name: Some("Ana Tiler".into()),
                ..PersonChange::default()
            },
        )
        .unwrap();
        assert_eq!(snapshot(&conn).unwrap().people[0].name, "Ana Tiler");

        let nobody = new_id();
        for refused in [
            update_person(
                &conn,
                &nobody,
                &PersonChange {
                    name: Some("X".into()),
                    ..PersonChange::default()
                },
            ),
            remove_person(&conn, &nobody),
        ] {
            assert_eq!(refused.unwrap_err().to_string(), PERSON_NOT_FOUND);
        }
    }

    /// The upgrade from F1's schema: a work at schema 2 — with a room, an
    /// activity touching it, a quantity and a unit — opens in F2 and loses
    /// nothing, gains no dependency and no baseline, and is not approved.
    #[test]
    fn a_work_at_schema_two_with_rows_migrates_to_the_current_version_without_losing_any() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::configure(&conn).unwrap();
        let tiling = a_work_at_schema_one(&conn);
        migrations::WORK
            .apply_up_to(&conn, 2)
            .expect("stand at schema 2");
        conn.execute_batch(&format!(
            "INSERT INTO room (id, position, name, created_at)
             VALUES ('00000000-0000-7000-8000-00000000000d', 1, 'Bathroom', 't');
             INSERT INTO activity_room (activity_id, room_id)
             VALUES ('{tiling}', '00000000-0000-7000-8000-00000000000d');
             UPDATE activity SET quantity = 12, unit = 'm²' WHERE id = '{tiling}';"
        ))
        .expect("an F1 work's rows");
        assert_eq!(migrations::WORK.current_version(&conn), 2);

        migrations::WORK.apply(&conn).expect("migrate 2 → head");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        let plan = snapshot(&conn).unwrap();
        let activity = &plan.activities[0];
        assert_eq!(activity.id, tiling);
        assert_eq!(activity.duration_days, Some(3));
        assert_eq!(activity.room_ids, vec![plan.rooms[0].id.clone()]);
        assert_eq!(
            (activity.quantity, activity.unit.as_deref()),
            (Some(12.0), Some("m²"))
        );
        assert_eq!(plan.people.len(), 1);
        assert_eq!(plan.holidays.len(), 1);
        assert!(plan.dependencies.is_empty());
        assert!(plan.baselines.is_empty());
        assert_eq!(plan.work.approved_at, None);

        migrations::WORK
            .apply(&conn)
            .expect("and again, idempotent");
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
    }

    /// The upgrade from F2's schema: a work at schema 3 — a dependency,
    /// an approval and baseline 1 — opens in F3, loses nothing (the baseline
    /// least of all), and gains an empty list of decisions.
    #[test]
    fn a_work_at_schema_three_with_rows_migrates_to_the_current_version_without_losing_any() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::configure(&conn).unwrap();
        let tiling = a_work_at_schema_one(&conn);
        migrations::WORK
            .apply_up_to(&conn, 3)
            .expect("stand at schema 3");
        conn.execute_batch(&format!(
            "INSERT INTO stage (id, position, name, created_at)
             VALUES ('00000000-0000-7000-8000-0000000000e2', 2, 'Painting', 't');
             INSERT INTO dependency (id, blocker_kind, blocker_id, blocked_kind, blocked_id,
                                     lag_days, created_at)
             VALUES ('00000000-0000-7000-8000-0000000000e3', 'activity', '{tiling}',
                     'stage', '00000000-0000-7000-8000-0000000000e2', 2, 't');
             UPDATE work SET approved_at = '2026-09-25T12:00:00.000Z';
             INSERT INTO baseline (id, number, taken_at, finish_date)
             VALUES ('00000000-0000-7000-8000-0000000000e4', 1, 't', '2026-10-07');
             INSERT INTO baseline_activity (baseline_id, activity_id, position, name, stage_name,
                                            duration_days, start, finish)
             VALUES ('00000000-0000-7000-8000-0000000000e4', '{tiling}', 1, 'Tiling', 'Bathroom',
                     3, '2026-10-05', '2026-10-07');"
        ))
        .expect("an F2 work's rows");
        assert_eq!(migrations::WORK.current_version(&conn), 3);
        let before = snapshot_without_decisions(&conn);

        migrations::WORK.apply(&conn).expect("migrate 3 → head");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        let plan = snapshot(&conn).unwrap();
        assert!(plan.decisions.is_empty());
        assert_eq!(plan.dependencies.len(), 1);
        assert_eq!(plan.dependencies[0].lag_days, 2);
        assert_eq!(
            plan.work.approved_at.as_deref(),
            Some("2026-09-25T12:00:00.000Z")
        );
        assert_eq!(plan.baselines.len(), 1);
        assert_eq!(
            plan.baselines[0].rows[0].finish.as_deref(),
            Some("2026-10-07")
        );
        assert_eq!(
            snapshot_without_decisions(&conn),
            before,
            "nothing else moved"
        );

        migrations::WORK
            .apply(&conn)
            .expect("and again, idempotent");
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
    }

    /// What schema 3 can already say, read by hand so it can be compared across
    /// the migration without the decisions the snapshot of schema 4 carries.
    fn snapshot_without_decisions(conn: &Connection) -> String {
        let mut out = String::new();
        for sql in [
            "SELECT id, name, duration_days, responsible_id, quantity, unit FROM activity",
            "SELECT id, position, name FROM stage ORDER BY position",
            "SELECT id, blocker_kind, blocker_id, blocked_kind, blocked_id, lag_days FROM dependency",
            "SELECT id, number, finish_date FROM baseline",
            "SELECT baseline_id, activity_id, start, finish FROM baseline_activity",
            "SELECT approved_at FROM work",
        ] {
            let mut statement = conn.prepare(sql).unwrap();
            let width = statement.column_count();
            let rows = statement
                .query_map([], |row| {
                    (0..width)
                        .map(|i| row.get::<_, rusqlite::types::Value>(i).map(|v| format!("{v:?}")))
                        .collect::<std::result::Result<Vec<_>, _>>()
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();
            out.push_str(&format!("{sql}: {rows:?}
"));
        }
        out
    }

    /// The upgrade from F3's schema: a work at schema 4 — a decision
    /// made with its answer, a baseline — opens in F4, loses nothing, and
    /// gains an empty diary whose chain verifies.
    #[test]
    fn a_work_at_schema_four_with_rows_migrates_to_the_current_version_without_losing_any() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::configure(&conn).unwrap();
        let tiling = a_work_at_schema_one(&conn);
        migrations::WORK
            .apply_up_to(&conn, 4)
            .expect("stand at schema 4");
        conn.execute_batch(&format!(
            "INSERT INTO decision (id, stage_id, position, name, lead_time_days, made_at, answer,
                                   created_at)
             VALUES ('00000000-0000-7000-8000-0000000000f1', '00000000-0000-7000-8000-00000000000b',
                     1, 'Which tile', 10, '2026-09-30T10:00:00.000Z', 'Porcelain, grey', 't');
             UPDATE work SET approved_at = '2026-09-25T12:00:00.000Z';
             INSERT INTO baseline (id, number, taken_at, finish_date)
             VALUES ('00000000-0000-7000-8000-0000000000f2', 1, 't', '2026-10-07');
             INSERT INTO baseline_activity (baseline_id, activity_id, position, name, stage_name,
                                            duration_days, start, finish)
             VALUES ('00000000-0000-7000-8000-0000000000f2', '{tiling}', 1, 'Tiling', 'Bathroom',
                     3, '2026-10-05', '2026-10-07');"
        ))
        .expect("an F3 work's rows");
        assert_eq!(migrations::WORK.current_version(&conn), 4);
        // Raw rows, not a snapshot: a snapshot is the current schema's, and
        // this file is at an older one.
        let before = snapshot_without_decisions(&conn);

        migrations::WORK.apply(&conn).expect("migrate 4 → head");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            snapshot_without_decisions(&conn),
            before,
            "the plan and its baseline: unchanged"
        );
        let decision = snapshot(&conn).unwrap().decisions.remove(0);
        assert_eq!(decision.answer.as_deref(), Some("Porcelain, grey"));
        assert!(decision.made_at.is_some());
        let report = crate::db::diary::verify(&conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (0, true),
            "an empty diary, intact"
        );
        for table in ["diary_entry", "diary_done", "diary_present", "diary_photo"] {
            let rows: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap_or_else(|error| panic!("`{table}` is missing: {error}"));
            assert_eq!(rows, 0);
        }

        migrations::WORK
            .apply(&conn)
            .expect("and again, idempotent");
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
    }

    /// The upgrade from F4's schema: a work at schema 5 — with diary
    /// entries — opens in F5, loses nothing, and its diary chain still
    /// verifies: a migration must never touch the record. Every stage comes
    /// out planned, with no checks.
    #[test]
    fn a_work_at_schema_five_with_a_diary_migrates_to_the_current_version_and_the_chain_still_verifies(
    ) {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::configure(&conn).unwrap();
        let tiling = a_work_at_schema_one(&conn);
        migrations::WORK
            .apply_up_to(&conn, 5)
            .expect("stand at schema 5");
        for day in ["2026-10-05", "2026-10-06"] {
            crate::db::diary::append(
                &conn,
                &crate::db::diary::NewEntry {
                    day: day.into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: Some("sun".into()),
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
                    hours: Some(8.0),
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: vec![crate::contract::DoneLine {
                        activity_id: tiling.clone(),
                        state: "worked".into(),
                        quantity: Some(4.0),
                        note: None,
                    }],
                    present: Vec::new(),
                    photos: Vec::new(),
                },
            )
            .expect("a diary entry at schema 5");
        }
        let diary_before = crate::db::diary::list(&conn, None, None).unwrap();
        let rows_before = snapshot_without_decisions(&conn);
        assert_eq!(migrations::WORK.current_version(&conn), 5);

        migrations::WORK.apply(&conn).expect("migrate 5 → head");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            crate::db::diary::list(&conn, None, None).unwrap(),
            diary_before
        );
        let report = crate::db::diary::verify(&conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (2, true),
            "the chain still holds"
        );
        assert_eq!(snapshot_without_decisions(&conn), rows_before);
        let plan = snapshot(&conn).unwrap();
        assert!(plan.checks.is_empty() && plan.check_answers.is_empty());
        assert_eq!(
            (
                plan.stages[0].started_at.clone(),
                plan.stages[0].closed_at.clone()
            ),
            (None, None),
            "planned"
        );

        migrations::WORK
            .apply(&conn)
            .expect("and again, idempotent");
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
    }

    /// The upgrade from F5's schema: a work at schema 6 — a diary entry,
    /// a stage started with an answered check — opens in F6, loses nothing,
    /// its diary chain still verifies, its people have no trade yet, and its
    /// money is empty.
    #[test]
    fn a_work_at_schema_six_with_a_diary_and_answers_migrates_to_the_current_version_and_the_chain_still_verifies(
    ) {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::configure(&conn).unwrap();
        let tiling = a_work_at_schema_one(&conn);
        migrations::WORK
            .apply_up_to(&conn, 6)
            .expect("stand at schema 6");
        crate::db::diary::append(
            &conn,
            &crate::db::diary::NewEntry {
                day: "2026-10-05".into(),
                kind: "entry".into(),
                corrects_seq: None,
                note: Some("Tiles laid.".into()),
                weather: None,
                lost_day: false,
                lost_cause: None,
                lost_party_person_id: None,
                hours: None,
                deliveries: None,
                incidents: None,
                visitors: None,
                author_name: "Synthetic author".into(),
                done: vec![crate::contract::DoneLine {
                    activity_id: tiling,
                    state: "finished".into(),
                    quantity: None,
                    note: None,
                }],
                present: Vec::new(),
                photos: Vec::new(),
            },
        )
        .expect("a diary entry at schema 6");
        let stage = "00000000-0000-7000-8000-00000000000b";
        let check = checks::add(&conn, stage, checks::Gate::Start, "On site").unwrap();
        check_answers::append(
            &conn,
            &check_answers::NewAnswer {
                check_id: check,
                answer: "yes".into(),
                reason: None,
                photo_hash: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        checks::start(&conn, stage).unwrap();
        let diary_before = crate::db::diary::list(&conn, None, None).unwrap();
        let rows_before = snapshot_without_decisions(&conn);
        let answers_before: i64 = conn
            .query_row("SELECT count(*) FROM check_answer", [], |r| r.get(0))
            .unwrap();
        assert_eq!(migrations::WORK.current_version(&conn), 6);

        migrations::WORK.apply(&conn).expect("migrate 6 → head");

        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            crate::db::diary::list(&conn, None, None).unwrap(),
            diary_before
        );
        let report = crate::db::diary::verify(&conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (1, true),
            "the chain still holds"
        );
        assert_eq!(snapshot_without_decisions(&conn), rows_before);
        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.check_answers.len() as i64, answers_before);
        assert!(plan.stages[0].started_at.is_some(), "the start stays");
        assert_eq!(plan.people[0].trade, None);
        assert!(
            plan.cost_lines.is_empty() && plan.commitments.is_empty() && plan.payments.is_empty()
        );

        migrations::WORK
            .apply(&conn)
            .expect("and again, idempotent");
        assert_eq!(
            migrations::WORK.current_version(&conn),
            migrations::WORK.target_version()
        );
    }
}
