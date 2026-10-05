//! Care notes: what the owner must know to look after the work — "Reseal the
//! shower grout once a year", "The stopcock is under the sink" — on the work, a
//! room or a stage (D3).
//!
//! They are not the plan. No approval locks them and a closed stage does not
//! refuse them: they are written, changed, moved and removed at any time. Each
//! target's notes are one sequence, 1..n ([`CARE_NOTES`]). A target is named by
//! kind and id and is not a foreign key — the work by its `work_id` — so the
//! notes that name a room or a stage are removed here, inside the transaction
//! that removes it ([`remove_for`], called by `db::rooms::remove_room` and
//! `db::work::remove_stage`).
//!
//! # Changelog of this repository
//!
//! - D3: notes listed, added, changed, moved and removed; a removed room's or
//!   stage's notes removed with it.
//! - G4: `check_target_as`, the same check with the sentence of whatever is
//!   on the target — a warranty, a maintenance task.

use rusqlite::{params, Connection};

use crate::contract::CareNote;
use crate::db::order::{Direction, CARE_NOTES};
use crate::db::work::{exists, found, ROOM_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a care note id that is not in this work.
pub const CARE_NOTE_NOT_FOUND: &str = "That care note is not in this work.";

/// The sentence for a target kind that is not one.
pub const CARE_TARGET_KIND: &str = "A care note is on the work, a room or a stage.";

/// The sentence for the work named by an id that is not this work's.
pub const WORK_NOT_THIS: &str = "That work is not the one open.";

/// Every note: the work's first, then each room's in the rooms' order, then
/// each stage's in the stages' order; by position within each. A note whose
/// target is gone — which the host never leaves — is listed last.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<CareNote>> {
    let notes = conn
        .prepare(
            "SELECT n.id, n.target_kind, n.target_id, n.position, n.text, n.created_at
             FROM care_note n
             LEFT JOIN room r ON n.target_kind = 'room' AND r.id = n.target_id
             LEFT JOIN stage s ON n.target_kind = 'stage' AND s.id = n.target_id
             ORDER BY CASE n.target_kind WHEN 'work' THEN 0 WHEN 'room' THEN 1 ELSE 2 END,
                      coalesce(r.position, s.position, 0), n.target_id, n.position",
        )?
        .query_map([], |row| {
            Ok(CareNote {
                id: row.get(0)?,
                target_kind: row.get(1)?,
                target_id: row.get(2)?,
                position: row.get(3)?,
                text: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(notes)
}

/// Refuse a target that is not in this work.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a kind that is not one, or an id that names
/// nothing of that kind.
pub fn check_target(conn: &Connection, kind: &str, id: &str) -> Result<()> {
    check_target_as(conn, kind, id, CARE_TARGET_KIND)
}

/// Refuse a target that is not in this work, with `not_a_kind` for a kind that
/// is not one — the sentence of whatever is on the target (G4: a warranty, a
/// maintenance task).
///
/// # Errors
///
/// [`Error::InvalidInput`] for a kind that is not one, or an id that names
/// nothing of that kind.
pub fn check_target_as(conn: &Connection, kind: &str, id: &str, not_a_kind: &str) -> Result<()> {
    let (sql, sentence) = match kind {
        "work" => ("SELECT 1 FROM work WHERE work_id = ?1", WORK_NOT_THIS),
        "room" => ("SELECT 1 FROM room WHERE id = ?1", ROOM_NOT_FOUND),
        "stage" => ("SELECT 1 FROM stage WHERE id = ?1", STAGE_NOT_FOUND),
        _ => return Err(Error::InvalidInput(not_a_kind.into())),
    };
    if exists(conn, sql, id)? {
        Ok(())
    } else {
        Err(Error::InvalidInput(sentence.into()))
    }
}

/// Add a note at the end of its target's; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a target not in this work.
pub fn add(conn: &Connection, kind: &str, target_id: &str, text: &str) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    check_target(&tx, kind, target_id)?;
    let id = new_id();
    tx.execute(
        "INSERT INTO care_note (id, target_kind, target_id, position, text, created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT coalesce(max(position), 0) + 1 FROM care_note
                  WHERE target_kind = ?2 AND target_id = ?3),
                 ?4, ?5)",
        params![id, kind, target_id, text, now()],
    )?;
    tx.commit()?;
    Ok(id)
}

/// Change what a note says.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a note not in this work.
pub fn update(conn: &Connection, id: &str, text: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE care_note SET text = ?2 WHERE id = ?1",
        params![id, text],
    )?;
    found(changed, CARE_NOTE_NOT_FOUND)
}

/// Move a note one step among its target's.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a note not in this work.
pub fn move_one(conn: &Connection, id: &str, direction: Direction) -> Result<()> {
    CARE_NOTES.move_one(conn, id, direction)
}

/// Remove a note; the notes after it close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a note not in this work.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let scope = CARE_NOTES.scope_of(&tx, id)?;
    tx.execute("DELETE FROM care_note WHERE id = ?1", [id])?;
    CARE_NOTES.close_gaps(&tx, scope.as_deref())?;
    tx.commit()?;
    Ok(())
}

/// Remove every note on a room or a stage. Called inside the transaction that
/// removes the room or the stage.
///
/// # Errors
///
/// [`Error::Database`] when the rows cannot be removed.
pub fn remove_for(conn: &Connection, kind: &str, target_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM care_note WHERE target_kind = ?1 AND target_id = ?2",
        params![kind, target_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::rooms::{add_room, remove_room};
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_stage, remove_stage, snapshot};

    fn texts(conn: &Connection) -> Vec<(String, String, i64, String)> {
        list(conn)
            .unwrap()
            .into_iter()
            .map(|n| (n.target_kind, n.target_id, n.position, n.text))
            .collect()
    }

    #[test]
    fn notes_are_added_per_target_in_order_changed_moved_and_removed() {
        let conn = a_work();
        let work_id = snapshot(&conn).unwrap().work.work_id;
        let stage = add_stage(&conn, "Tiling").unwrap();
        let bathroom = add_room(&conn, "Bathroom").unwrap();
        let kitchen = add_room(&conn, "Kitchen").unwrap();

        let grout = add(
            &conn,
            "room",
            &bathroom,
            "Reseal the shower grout once a year",
        )
        .unwrap();
        let stopcock = add(&conn, "room", &bathroom, "The stopcock is under the sink").unwrap();
        add(&conn, "room", &kitchen, "Clean the hood filter monthly").unwrap();
        add(&conn, "stage", &stage, "Spare tiles are in the garage").unwrap();
        add(&conn, "work", &work_id, "The main breaker is by the door").unwrap();

        let listed = texts(&conn);
        assert_eq!(
            listed
                .iter()
                .map(|(k, _, p, _)| (k.as_str(), *p))
                .collect::<Vec<_>>(),
            vec![
                ("work", 1),
                ("room", 1),
                ("room", 2),
                ("room", 1),
                ("stage", 1)
            ],
            "the work's first, then the rooms in their order, then the stages"
        );
        assert_eq!(listed[1].1, bathroom);
        assert_eq!(listed[3].1, kitchen);

        move_one(&conn, &stopcock, Direction::Up).unwrap();
        update(&conn, &grout, "Reseal the grout every spring").unwrap();
        let bathroom_notes: Vec<(i64, String)> = texts(&conn)
            .into_iter()
            .filter(|(_, t, _, _)| *t == bathroom)
            .map(|(_, _, p, text)| (p, text))
            .collect();
        assert_eq!(
            bathroom_notes,
            vec![
                (1, "The stopcock is under the sink".into()),
                (2, "Reseal the grout every spring".into())
            ]
        );

        remove(&conn, &stopcock).unwrap();
        let positions: Vec<i64> = texts(&conn)
            .into_iter()
            .filter(|(_, t, _, _)| *t == bathroom)
            .map(|(_, _, p, _)| p)
            .collect();
        assert_eq!(positions, vec![1], "the rest close up");

        for (refused, sentence) in [
            (update(&conn, &stopcock, "x"), CARE_NOTE_NOT_FOUND),
            (remove(&conn, &stopcock), CARE_NOTE_NOT_FOUND),
            (
                move_one(&conn, &stopcock, Direction::Down),
                CARE_NOTE_NOT_FOUND,
            ),
            (
                add(&conn, "activity", &stage, "x").map(|_| ()),
                CARE_TARGET_KIND,
            ),
            (add(&conn, "room", &stage, "x").map(|_| ()), ROOM_NOT_FOUND),
            (
                add(&conn, "stage", &bathroom, "x").map(|_| ()),
                STAGE_NOT_FOUND,
            ),
            (
                add(&conn, "work", "someone-else", "x").map(|_| ()),
                WORK_NOT_THIS,
            ),
        ] {
            assert_eq!(refused.unwrap_err().to_string(), sentence);
        }
    }

    #[test]
    fn a_removed_room_or_stage_takes_its_notes_and_leaves_the_others() {
        let conn = a_work();
        let work_id = snapshot(&conn).unwrap().work.work_id;
        let stage = add_stage(&conn, "Tiling").unwrap();
        let other = add_stage(&conn, "Painting").unwrap();
        let bathroom = add_room(&conn, "Bathroom").unwrap();
        let kitchen = add_room(&conn, "Kitchen").unwrap();
        add(&conn, "room", &bathroom, "Grout yearly").unwrap();
        add(&conn, "room", &bathroom, "Stopcock under the sink").unwrap();
        add(&conn, "room", &kitchen, "Hood filter").unwrap();
        add(&conn, "stage", &stage, "Spare tiles").unwrap();
        add(&conn, "stage", &other, "Paint code 1234").unwrap();
        add(&conn, "work", &work_id, "Breaker by the door").unwrap();

        remove_room(&conn, &bathroom).unwrap();
        remove_stage(&conn, &stage).unwrap();

        let left: Vec<String> = texts(&conn).into_iter().map(|(_, _, _, t)| t).collect();
        assert_eq!(
            left,
            vec!["Breaker by the door", "Hood filter", "Paint code 1234"]
        );
        assert_eq!(snapshot(&conn).unwrap().care_notes.len(), 3);
    }

    #[test]
    fn the_schema_refuses_a_note_that_does_not_fit() {
        let conn = a_work();
        let stage = add_stage(&conn, "Tiling").unwrap();
        for (kind, text, position) in [
            ("activity", "x".to_string(), "1"),
            ("stage", String::new(), "1"),
            ("stage", "   ".to_string(), "1"),
            ("stage", "x".repeat(1001), "1"),
            ("stage", "x".to_string(), "0"),
            ("stage", "x".to_string(), "1.5"),
        ] {
            let refused = conn.execute(
                &format!(
                    "INSERT INTO care_note (id, target_kind, target_id, position, text, created_at)
                     VALUES (?1, ?2, ?3, {position}, ?4, 't')"
                ),
                params![new_id(), kind, stage, text],
            );
            assert!(refused.is_err(), "{kind} {position} {}", text.len());
        }
        conn.execute(
            "INSERT INTO care_note (id, target_kind, target_id, position, text, created_at)
             VALUES (?1, 'stage', ?2, 1, ?3, 't')",
            params![new_id(), stage, "x".repeat(1000)],
        )
        .expect("1 000 characters");
    }
}
