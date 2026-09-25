//! Decisions: what the person must decide before a stage can start, and how
//! long it takes between deciding and having.
//!
//! The host stores five things about a decision — its stage, its place in the
//! stage, its name, its lead time, and, once it is made, when and with what
//! answer. **It never stores the deadline.** The deadline is the stage's
//! earliest scheduled start minus the lead time on the working calendar, and
//! the domain computes it every time from the schedule (ADR-017), so it moves
//! when the schedule moves and nobody maintains it. Nor does the host know what
//! "overdue" means: that is the deadline against today, and today is an input
//! the interface passes to the domain.
//!
//! Making a decision is one step and reopening it is another. A decision that
//! is already made is not made again — it is reopened first — so the moment it
//! was made is never silently moved. Reopening clears the answer with the
//! moment: the answer belongs to the making.
//!
//! # Changelog of this repository
//!
//! - F3: decisions added, renamed, re-timed, moved (via `db::order`), removed,
//!   made and reopened.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Decision;
use crate::db::order::DECISIONS;
use crate::db::work::{exists, DECISION_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for making a decision that is already made.
pub const ALREADY_MADE: &str = "That decision is already made. Reopen it first to make it again.";

/// The sentence for reopening a decision that is still open.
pub const NOT_MADE: &str = "That decision is still open; there is nothing to reopen.";

/// Every decision, by its stage's position and then its own.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Decision>> {
    let decisions = conn
        .prepare(
            "SELECT d.id, d.stage_id, d.position, d.name, d.lead_time_days, d.made_at, d.answer
             FROM decision d JOIN stage s ON s.id = d.stage_id
             ORDER BY s.position, d.position",
        )?
        .query_map([], |row| {
            Ok(Decision {
                id: row.get(0)?,
                stage_id: row.get(1)?,
                position: row.get(2)?,
                name: row.get(3)?,
                lead_time_days: row.get(4)?,
                made_at: row.get(5)?,
                answer: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(decisions)
}

/// Add a decision at the end of a stage's decisions; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the stage is not in this work.
pub fn add(conn: &Connection, stage_id: &str, name: &str, lead_time_days: i64) -> Result<String> {
    if !exists(conn, "SELECT 1 FROM stage WHERE id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO decision (id, stage_id, position, name, lead_time_days, created_at)
         VALUES (?1, ?2,
                 (SELECT coalesce(max(position), 0) + 1 FROM decision WHERE stage_id = ?2),
                 ?3, ?4, ?5)",
        params![id, stage_id, name, lead_time_days, now()],
    )?;
    Ok(id)
}

/// Change a decision's name, its lead time, or both. `None` leaves a field
/// alone.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the decision is not in this work.
pub fn update(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    lead_time_days: Option<i64>,
) -> Result<()> {
    let changed = conn.execute(
        "UPDATE decision SET name = coalesce(?2, name),
                             lead_time_days = coalesce(?3, lead_time_days)
         WHERE id = ?1",
        params![id, name, lead_time_days],
    )?;
    if changed == 0 {
        return Err(Error::InvalidInput(DECISION_NOT_FOUND.into()));
    }
    Ok(())
}

/// Remove a decision; the decisions after it in its stage close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the decision is not in this work.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let stage = DECISIONS.scope_of(&tx, id)?;
    tx.execute("DELETE FROM decision WHERE id = ?1", [id])?;
    DECISIONS.close_gaps(&tx, stage.as_deref())?;
    tx.commit()?;
    Ok(())
}

/// Make a decision, now, with an answer or without one.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the decision is not in this work, or is
/// already made.
pub fn make(conn: &Connection, id: &str, answer: Option<&str>) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    match made_at(&tx, id)? {
        None => return Err(Error::InvalidInput(DECISION_NOT_FOUND.into())),
        Some(Some(_)) => return Err(Error::InvalidInput(ALREADY_MADE.into())),
        Some(None) => {}
    }
    tx.execute(
        "UPDATE decision SET made_at = ?2, answer = ?3 WHERE id = ?1",
        params![id, now(), answer],
    )?;
    tx.commit()?;
    Ok(())
}

/// Reopen a made decision: it is open again, with no moment and no answer.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the decision is not in this work, or is still
/// open.
pub fn reopen(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    match made_at(&tx, id)? {
        None => return Err(Error::InvalidInput(DECISION_NOT_FOUND.into())),
        Some(None) => return Err(Error::InvalidInput(NOT_MADE.into())),
        Some(Some(_)) => {}
    }
    tx.execute(
        "UPDATE decision SET made_at = NULL, answer = NULL WHERE id = ?1",
        [id],
    )?;
    tx.commit()?;
    Ok(())
}

/// `None` when the decision is not in this work; otherwise when it was made,
/// if it was.
fn made_at(conn: &Connection, id: &str) -> Result<Option<Option<String>>> {
    Ok(conn
        .query_row("SELECT made_at FROM decision WHERE id = ?1", [id], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::order::Direction;
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_stage, remove_stage, snapshot};

    fn names(conn: &Connection) -> Vec<(i64, String)> {
        snapshot(conn)
            .unwrap()
            .decisions
            .into_iter()
            .map(|d| (d.position, d.name))
            .collect()
    }

    #[test]
    fn decisions_are_added_in_order_renamed_retimed_moved_and_removed() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tile = add(&conn, &stage, "Which tile", 10).unwrap();
        let tap = add(&conn, &stage, "Which tap", 5).unwrap();
        add(&conn, &stage, "Which mirror", 0).unwrap();

        update(&conn, &tile, Some("Which floor tile"), None).unwrap();
        update(&conn, &tap, None, Some(12)).unwrap();
        DECISIONS.move_one(&conn, &tap, Direction::Up).unwrap();

        let plan = snapshot(&conn).unwrap();
        let rows: Vec<_> = plan
            .decisions
            .iter()
            .map(|d| (d.position, d.name.as_str(), d.lead_time_days))
            .collect();
        assert_eq!(
            rows,
            vec![
                (1, "Which tap", 12),
                (2, "Which floor tile", 10),
                (3, "Which mirror", 0)
            ]
        );

        remove(&conn, &tile).unwrap();
        assert_eq!(
            names(&conn),
            vec![(1, "Which tap".into()), (2, "Which mirror".into())],
            "the decisions after it closed up"
        );
    }

    #[test]
    fn decisions_come_back_by_stage_position_then_their_own() {
        let conn = a_work();
        let first = add_stage(&conn, "Structure").unwrap();
        let second = add_stage(&conn, "Finishes").unwrap();
        add(&conn, &second, "Which colour", 1).unwrap();
        add(&conn, &first, "Which bricks", 5).unwrap();
        add(&conn, &second, "Which handles", 2).unwrap();

        crate::db::order::STAGES
            .move_one(&conn, &second, Direction::Up)
            .unwrap();

        let order: Vec<String> = snapshot(&conn)
            .unwrap()
            .decisions
            .into_iter()
            .map(|d| d.name)
            .collect();
        assert_eq!(order, vec!["Which colour", "Which handles", "Which bricks"]);
    }

    #[test]
    fn a_decision_is_made_with_an_answer_and_reopening_clears_both() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tile = add(&conn, &stage, "Which tile", 10).unwrap();

        make(&conn, &tile, Some("Porcelain, grey")).unwrap();
        let made = snapshot(&conn).unwrap().decisions.remove(0);
        assert!(made.made_at.is_some());
        assert_eq!(made.answer.as_deref(), Some("Porcelain, grey"));

        reopen(&conn, &tile).unwrap();
        let open = snapshot(&conn).unwrap().decisions.remove(0);
        assert_eq!((open.made_at, open.answer), (None, None));

        make(&conn, &tile, None).expect("made again, without writing an answer");
        let made = snapshot(&conn).unwrap().decisions.remove(0);
        assert!(made.made_at.is_some());
        assert_eq!(made.answer, None);
    }

    /// The moment a decision was made is never silently moved: making it again
    /// is refused, and nothing changes.
    #[test]
    fn making_a_made_decision_again_is_refused_and_reopening_an_open_one_too() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tile = add(&conn, &stage, "Which tile", 10).unwrap();

        let refused = reopen(&conn, &tile).unwrap_err();
        assert_eq!(refused.to_string(), NOT_MADE);

        make(&conn, &tile, Some("Porcelain")).unwrap();
        let before = snapshot(&conn).unwrap().decisions;
        std::thread::sleep(std::time::Duration::from_millis(5));

        let refused = make(&conn, &tile, Some("Ceramic")).unwrap_err();

        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), ALREADY_MADE);
        assert_eq!(snapshot(&conn).unwrap().decisions, before);
    }

    #[test]
    fn a_decision_or_a_stage_not_in_this_work_is_a_sentence() {
        let conn = a_work();
        let nobody = new_id();

        assert_eq!(
            add(&conn, &nobody, "Which tile", 1)
                .unwrap_err()
                .to_string(),
            STAGE_NOT_FOUND
        );
        for refused in [
            update(&conn, &nobody, Some("X"), None),
            remove(&conn, &nobody),
            make(&conn, &nobody, None),
            reopen(&conn, &nobody),
            DECISIONS.move_one(&conn, &nobody, Direction::Up),
        ] {
            assert_eq!(refused.unwrap_err().to_string(), DECISION_NOT_FOUND);
        }
    }

    #[test]
    fn removing_a_stage_removes_its_decisions_and_no_other() {
        let conn = a_work();
        let bathroom = add_stage(&conn, "Bathroom").unwrap();
        let kitchen = add_stage(&conn, "Kitchen").unwrap();
        add(&conn, &bathroom, "Which tile", 10).unwrap();
        add(&conn, &bathroom, "Which tap", 5).unwrap();
        add(&conn, &kitchen, "Which worktop", 15).unwrap();

        remove_stage(&conn, &bathroom).unwrap();

        let left: i64 = conn
            .query_row("SELECT count(*) FROM decision", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1, "the schema's cascade removed the stage's two");
        assert_eq!(names(&conn), vec![(1, "Which worktop".into())]);
    }

    fn refused_by_the_schema(conn: &Connection, sql: &str) -> bool {
        matches!(
            conn.execute(sql, []),
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == rusqlite::ErrorCode::ConstraintViolation
        )
    }

    /// The deadline is not in the file, and an answer without the making is not
    /// either — whatever writes the file.
    #[test]
    fn the_schema_refuses_an_answer_without_the_making_and_a_lead_time_out_of_range() {
        let conn = a_work();
        let stage = add_stage(&conn, "Bathroom").unwrap();
        let tile = add(&conn, &stage, "Which tile", 10).unwrap();

        for assignment in [
            "answer = 'Porcelain'",
            "lead_time_days = -1",
            "lead_time_days = 3651",
            "lead_time_days = 2.5",
            "lead_time_days = 'ten'",
            "name = ''",
            "name = '   '",
            "made_at = 't', answer = ''",
            "made_at = 't', answer = '   '",
        ] {
            let sql = format!("UPDATE decision SET {assignment} WHERE id = '{tile}'");
            assert!(refused_by_the_schema(&conn, &sql), "{assignment}");
        }
        let long = "a".repeat(501);
        let sql =
            format!("UPDATE decision SET made_at = 't', answer = '{long}' WHERE id = '{tile}'");
        assert!(
            refused_by_the_schema(&conn, &sql),
            "an answer of 501 characters"
        );

        make(&conn, &tile, Some("Porcelain")).unwrap();
        let sql = format!("UPDATE decision SET made_at = NULL WHERE id = '{tile}'");
        assert!(
            refused_by_the_schema(&conn, &sql),
            "an answer left behind by clearing only the moment"
        );

        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('decision')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert!(
            !columns
                .iter()
                .any(|c| c.contains("deadline") || c.contains("overdue")),
            "the deadline is computed, never stored: {columns:?}"
        );
    }
}
