//! The commands for rooms, and for the rooms an activity touches.
//!
//! A room is the architect's and the owner's map of the work; "By room" on the
//! Plan page is the same activities arranged under it. Every command returns
//! the whole plan as it now is, like every other command that changes it.
//!
//! # Changelog of this boundary
//!
//! - F1: `room_add`, `room_rename`, `room_remove` (its links go, its
//!   activities stay), `room_move` (one step, a no-op at the edge, positions
//!   1..n after), `activity_set_rooms` (the set replaced whole).

use tauri::State;

use crate::commands::work::change_work;
use crate::contract::WorkSnapshot;
use crate::db::order::ROOMS;
use crate::db::rooms as repo;
use crate::error::Result;
use crate::folder::OpenWork;
use crate::validate;

/// Add a room after the last one.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for an empty or long name, and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn room_add(open: State<'_, OpenWork>, name: String) -> Result<WorkSnapshot> {
    room_add_with(&open, &name)
}

/// Rename a room.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a name that does not fit or a room
/// not in this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn room_rename(open: State<'_, OpenWork>, id: String, name: String) -> Result<WorkSnapshot> {
    room_rename_with(&open, &id, &name)
}

/// Remove a room. The activities that touched it stay; they touch it no more.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a room not in this work, and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn room_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    room_remove_with(&open, &id)
}

/// Move a room one step, `up` or `down`. At the edge nothing moves, and that is
/// not an error.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a direction that is neither or a
/// room not in this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn room_move(open: State<'_, OpenWork>, id: String, direction: String) -> Result<WorkSnapshot> {
    room_move_with(&open, &id, &direction)
}

/// Replace the rooms an activity touches with `room_ids`. An empty list means
/// it touches no room yet.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for an activity or a room not in this
/// work — and then nothing changes; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn activity_set_rooms(
    open: State<'_, OpenWork>,
    id: String,
    room_ids: Vec<String>,
) -> Result<WorkSnapshot> {
    activity_set_rooms_with(&open, &id, &room_ids)
}

/// What [`room_add`] does once the state is in hand.
pub fn room_add_with(open: &OpenWork, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("room", name)?;
    change_work(open, |conn| repo::add_room(conn, &name).map(|_| ()))
}

/// What [`room_rename`] does once the state is in hand.
pub fn room_rename_with(open: &OpenWork, id: &str, name: &str) -> Result<WorkSnapshot> {
    let name = validate::name("room", name)?;
    change_work(open, |conn| repo::rename_room(conn, id, &name))
}

/// What [`room_remove`] does once the state is in hand.
pub fn room_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::remove_room(conn, id))
}

/// What [`room_move`] does once the state is in hand.
pub fn room_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| ROOMS.move_one(conn, id, direction))
}

/// What [`activity_set_rooms`] does once the state is in hand.
pub fn activity_set_rooms_with(
    open: &OpenWork,
    id: &str,
    room_ids: &[String],
) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::set_activity_rooms(conn, id, room_ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plan::{activity_add_with, stage_add_with};
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;

    #[test]
    fn rooms_are_added_moved_linked_and_removed_and_every_step_returns_the_plan() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Finishes").unwrap().stages[0]
            .id
            .clone();
        let paint = activity_add_with(&open, &stage, "Paint")
            .unwrap()
            .activities[0]
            .id
            .clone();
        room_add_with(&open, "Kitchen").unwrap();
        let plan = room_add_with(&open, "Bathroom").unwrap();
        let (kitchen, bathroom) = (plan.rooms[0].id.clone(), plan.rooms[1].id.clone());

        let plan = room_move_with(&open, &bathroom, "up").unwrap();
        assert_eq!(plan.rooms[0].name, "Bathroom");
        let plan = room_move_with(&open, &bathroom, "up").unwrap();
        assert_eq!(plan.rooms[0].name, "Bathroom", "the edge is a no-op");

        let plan =
            activity_set_rooms_with(&open, &paint, &[kitchen.clone(), bathroom.clone()]).unwrap();
        assert_eq!(
            plan.activities[0].room_ids,
            vec![bathroom.clone(), kitchen.clone()],
            "in the rooms' order"
        );
        let wire = serde_json::to_value(&plan).unwrap();
        assert_eq!(wire["rooms"][0]["name"], "Bathroom");
        assert!(wire["activities"][0]["roomIds"].is_array());

        let plan = room_rename_with(&open, &kitchen, "Kitchen and pantry").unwrap();
        assert_eq!(plan.rooms[1].name, "Kitchen and pantry");

        let plan = room_remove_with(&open, &bathroom).unwrap();
        assert_eq!(plan.rooms.len(), 1);
        assert_eq!(plan.rooms[0].position, 1);
        assert_eq!(plan.activities.len(), 1, "the activity stays");
        assert_eq!(plan.activities[0].room_ids, vec![kitchen]);
        work_close_with(&open);
    }

    #[test]
    fn an_unknown_room_in_the_set_is_invalid_input() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Finishes").unwrap().stages[0]
            .id
            .clone();
        let paint = activity_add_with(&open, &stage, "Paint")
            .unwrap()
            .activities[0]
            .id
            .clone();

        let refused = activity_set_rooms_with(&open, &paint, &[crate::db::new_id()]).unwrap_err();

        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), "That room is not in this work.");
        work_close_with(&open);
    }

    #[test]
    fn a_room_name_that_does_not_fit_and_no_work_open_are_both_said() {
        let (_db, open) = host();
        assert_eq!(
            room_add_with(&open, " ").unwrap_err().to_string(),
            "A room needs a name."
        );
        assert_eq!(
            room_add_with(&open, "Hall").unwrap_err().kind(),
            "no_work_open"
        );
        assert_eq!(
            room_move_with(&open, "x", "sideways").unwrap_err().kind(),
            "invalid_input"
        );
    }
}
