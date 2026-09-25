//! Rooms, and the rooms an activity touches.
//!
//! A room is a row of the work: the architect's and the owner's map of it. An
//! activity touches zero or more rooms, and the set is replaced whole — the
//! interface sends the rooms the activity touches now, not a list of edits to
//! apply. Removing a room removes its links and leaves every activity where it
//! was; the schema's `ON DELETE CASCADE` on `activity_room` does it.
//!
//! # Changelog of this repository
//!
//! - F1: rooms added, renamed, removed; an activity's rooms replaced.

use std::collections::BTreeSet;

use rusqlite::{params, Connection};

use crate::db::order::ROOMS;
use crate::db::work::{exists, found, ACTIVITY_NOT_FOUND, ROOM_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// Add a room after the last one; returns its id.
///
/// # Errors
///
/// [`Error::Database`] when the row is refused.
pub fn add_room(conn: &Connection, name: &str) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO room (id, position, name, created_at)
         VALUES (?1, (SELECT coalesce(max(position), 0) + 1 FROM room), ?2, ?3)",
        params![id, name, now()],
    )?;
    Ok(id)
}

/// Rename a room.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the room is not in this work.
pub fn rename_room(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let changed = conn.execute("UPDATE room SET name = ?2 WHERE id = ?1", params![id, name])?;
    found(changed, ROOM_NOT_FOUND)
}

/// Remove a room: its links go with it, the activities stay, and the rooms
/// after it close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the room is not in this work.
pub fn remove_room(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute("DELETE FROM room WHERE id = ?1", [id])?;
    found(changed, ROOM_NOT_FOUND)?;
    ROOMS.close_gaps(&tx, None)?;
    tx.commit()?;
    Ok(())
}

/// Replace the set of rooms an activity touches. A room named twice is one
/// room; an empty set means the activity touches no room yet.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the activity, or any of the rooms, is not in
/// this work — and then nothing changes.
pub fn set_activity_rooms(conn: &Connection, activity_id: &str, room_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM activity WHERE id = ?1", activity_id)? {
        return Err(Error::InvalidInput(ACTIVITY_NOT_FOUND.into()));
    }
    let rooms: BTreeSet<&str> = room_ids.iter().map(String::as_str).collect();
    for room in &rooms {
        if !exists(&tx, "SELECT 1 FROM room WHERE id = ?1", room)? {
            return Err(Error::InvalidInput(ROOM_NOT_FOUND.into()));
        }
    }
    tx.execute(
        "DELETE FROM activity_room WHERE activity_id = ?1",
        [activity_id],
    )?;
    for room in rooms {
        tx.execute(
            "INSERT INTO activity_room (activity_id, room_id) VALUES (?1, ?2)",
            params![activity_id, room],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::order::Direction;
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_activity, add_stage, snapshot};

    fn names(conn: &Connection) -> Vec<(i64, String)> {
        snapshot(conn)
            .unwrap()
            .rooms
            .into_iter()
            .map(|room| (room.position, room.name))
            .collect()
    }

    #[test]
    fn rooms_are_added_in_order_renamed_and_moved() {
        let conn = a_work();
        let kitchen = add_room(&conn, "Kitchen").unwrap();
        add_room(&conn, "Bathroom").unwrap();

        rename_room(&conn, &kitchen, "Kitchen and pantry").unwrap();
        ROOMS.move_one(&conn, &kitchen, Direction::Down).unwrap();

        assert_eq!(
            names(&conn),
            vec![(1, "Bathroom".into()), (2, "Kitchen and pantry".into())]
        );
    }

    #[test]
    fn an_activity_s_rooms_are_replaced_whole_and_come_back_in_the_rooms_order() {
        let conn = a_work();
        let stage = add_stage(&conn, "Finishes").unwrap();
        let paint = add_activity(&conn, &stage, "Paint").unwrap();
        let kitchen = add_room(&conn, "Kitchen").unwrap();
        let bathroom = add_room(&conn, "Bathroom").unwrap();
        let hall = add_room(&conn, "Hall").unwrap();

        set_activity_rooms(
            &conn,
            &paint,
            &[hall.clone(), kitchen.clone(), hall.clone()],
        )
        .unwrap();
        assert_eq!(
            snapshot(&conn).unwrap().activities[0].room_ids,
            vec![kitchen.clone(), hall.clone()],
            "in the rooms' order, a room named twice once"
        );

        set_activity_rooms(&conn, &paint, std::slice::from_ref(&bathroom)).unwrap();
        assert_eq!(
            snapshot(&conn).unwrap().activities[0].room_ids,
            vec![bathroom]
        );

        set_activity_rooms(&conn, &paint, &[]).unwrap();
        assert!(snapshot(&conn).unwrap().activities[0].room_ids.is_empty());
    }

    #[test]
    fn an_unknown_room_is_refused_and_the_activity_keeps_the_rooms_it_had() {
        let conn = a_work();
        let stage = add_stage(&conn, "Finishes").unwrap();
        let paint = add_activity(&conn, &stage, "Paint").unwrap();
        let kitchen = add_room(&conn, "Kitchen").unwrap();
        set_activity_rooms(&conn, &paint, std::slice::from_ref(&kitchen)).unwrap();

        let refused = set_activity_rooms(&conn, &paint, &[kitchen.clone(), new_id()]).unwrap_err();

        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), ROOM_NOT_FOUND);
        assert_eq!(
            snapshot(&conn).unwrap().activities[0].room_ids,
            vec![kitchen]
        );

        let refused = set_activity_rooms(&conn, &new_id(), &[]).unwrap_err();
        assert_eq!(refused.to_string(), ACTIVITY_NOT_FOUND);
    }

    #[test]
    fn removing_a_room_removes_its_links_and_leaves_the_activities() {
        let conn = a_work();
        let stage = add_stage(&conn, "Finishes").unwrap();
        let paint = add_activity(&conn, &stage, "Paint").unwrap();
        let tile = add_activity(&conn, &stage, "Tile").unwrap();
        let kitchen = add_room(&conn, "Kitchen").unwrap();
        add_room(&conn, "Bathroom").unwrap();
        let hall = add_room(&conn, "Hall").unwrap();
        set_activity_rooms(&conn, &paint, &[kitchen.clone(), hall.clone()]).unwrap();
        set_activity_rooms(&conn, &tile, std::slice::from_ref(&kitchen)).unwrap();

        remove_room(&conn, &kitchen).unwrap();

        let plan = snapshot(&conn).unwrap();
        assert_eq!(plan.activities.len(), 2, "no activity went with the room");
        assert_eq!(plan.activities[0].room_ids, vec![hall]);
        assert!(plan.activities[1].room_ids.is_empty());
        let links: i64 = conn
            .query_row(
                "SELECT count(*) FROM activity_room WHERE room_id = ?1",
                [&kitchen],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(links, 0);
        assert_eq!(
            names(&conn),
            vec![(1, "Bathroom".into()), (2, "Hall".into())],
            "the rooms after it closed up"
        );
    }

    #[test]
    fn removing_an_activity_removes_its_links_and_leaves_the_rooms() {
        let conn = a_work();
        let stage = add_stage(&conn, "Finishes").unwrap();
        let paint = add_activity(&conn, &stage, "Paint").unwrap();
        let kitchen = add_room(&conn, "Kitchen").unwrap();
        set_activity_rooms(&conn, &paint, std::slice::from_ref(&kitchen)).unwrap();

        crate::db::work::remove_activity(&conn, &paint).unwrap();

        assert_eq!(snapshot(&conn).unwrap().rooms.len(), 1);
        let links: i64 = conn
            .query_row("SELECT count(*) FROM activity_room", [], |r| r.get(0))
            .unwrap();
        assert_eq!(links, 0);
    }

    #[test]
    fn a_room_that_is_not_in_this_work_is_a_sentence() {
        let conn = a_work();
        let nobody = new_id();
        for refused in [
            rename_room(&conn, &nobody, "X"),
            remove_room(&conn, &nobody),
        ] {
            assert_eq!(refused.unwrap_err().to_string(), ROOM_NOT_FOUND);
        }
    }
}
