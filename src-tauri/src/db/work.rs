//! A work's database: the SQL that reads and writes the plan.
//!
//! Values arrive here already checked (`crate::validate`) and are checked once
//! more by the schema. What this module adds is the one thing only the file can
//! answer — whether the stage, activity or person an id names is in this work —
//! and it answers with a sentence rather than a foreign-key failure.
//!
//! Every write is one transaction. There is no statement here that writes
//! progress, because there is no column for it.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::{Activity, Calendar, Holiday, Person, Stage, Work, WorkSnapshot};
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
        "SELECT work_id, name, place, start_date, currency, created_at FROM work WHERE id = 1",
        [],
        |row| {
            Ok(Work {
                work_id: row.get(0)?,
                name: row.get(1)?,
                place: row.get(2)?,
                start_date: row.get(3)?,
                currency: row.get(4)?,
                created_at: row.get(5)?,
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
        .prepare("SELECT id, name FROM person ORDER BY name COLLATE NOCASE, id")?
        .query_map([], |row| {
            Ok(Person {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let stages = conn
        .prepare("SELECT id, position, name FROM stage ORDER BY position")?
        .query_map([], |row| {
            Ok(Stage {
                id: row.get(0)?,
                position: row.get(1)?,
                name: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let activities = conn
        .prepare(
            "SELECT a.id, a.stage_id, a.position, a.name, a.duration_days, a.responsible_id
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
                responsible_id: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(WorkSnapshot {
        work: work(conn)?,
        calendar,
        holidays,
        people,
        stages,
        activities,
    })
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
    let changed = conn.execute(
        "UPDATE stage SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    found(changed, STAGE_NOT_FOUND)
}

/// Remove a stage and, with it, its activities.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the stage is not in this work.
pub fn remove_stage(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM stage WHERE id = ?1", [id])?;
    found(changed, STAGE_NOT_FOUND)
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
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActivityChange {
    /// A new name.
    pub name: Option<String>,
    /// A new duration, or none.
    pub duration_days: Option<Option<i64>>,
    /// A new responsible, or nobody.
    pub responsible_id: Option<Option<String>>,
}

/// Change an activity.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the activity, or the person named responsible,
/// is not in this work.
pub fn update_activity(conn: &Connection, id: &str, change: &ActivityChange) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM activity WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(ACTIVITY_NOT_FOUND.into()));
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
            if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", person)? {
                return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
            }
        }
        tx.execute(
            "UPDATE activity SET responsible_id = ?2 WHERE id = ?1",
            params![id, responsible],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Remove an activity.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the activity is not in this work.
pub fn remove_activity(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM activity WHERE id = ?1", [id])?;
    found(changed, ACTIVITY_NOT_FOUND)
}

const STAGE_NOT_FOUND: &str = "That stage is not in this work.";
const ACTIVITY_NOT_FOUND: &str = "That activity is not in this work.";
const PERSON_NOT_FOUND: &str = "That person is not in this work.";

fn exists(conn: &Connection, sql: &str, id: &str) -> Result<bool> {
    Ok(conn.query_row(sql, [id], |_| Ok(())).optional()?.is_some())
}

fn found(changed: usize, sentence: &'static str) -> Result<()> {
    if changed == 0 {
        Err(Error::InvalidInput(sentence.into()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
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

    fn a_work() -> Connection {
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

        for table in ["work", "calendar", "holiday", "person", "stage", "activity"] {
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
            plan.stages.iter().find(|s| s.id == third).unwrap().position,
            3,
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
}
