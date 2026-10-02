//! The commands for care notes: what the owner must know to look after the
//! work, on the work, a room or a stage (D3).
//!
//! A care note is not the plan. None of these asks whether the plan is
//! approved or a stage closed: a note is written, changed, moved and removed at
//! any time. The text is trimmed, 1 to 1 000 characters; a line break and a tab
//! are kept, any other control character refused. Every command returns the
//! whole plan, which carries the notes (`WorkSnapshot.careNotes`).
//!
//! # Changelog of this boundary
//!
//! - D3: `care_note_add`, `care_note_update`, `care_note_move`,
//!   `care_note_remove`.

use tauri::State;

use crate::commands::work::change_work;
use crate::contract::WorkSnapshot;
use crate::db::care_notes as repo;
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::validate;

/// The longest care note, in characters.
pub const MAX_CARE_NOTE_CHARS: usize = 1000;

/// The sentence for a note with nothing in it.
pub const CARE_NOTE_EMPTY: &str = "A care note needs something to say.";

/// Add a care note at the end of its target's: `target_kind` is `work`, `room`
/// or `stage`; `target_id` the room's or stage's id, or the work's `workId`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a text that does not fit or a target not in
/// this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn care_note_add(
    open: State<'_, OpenWork>,
    target_kind: String,
    target_id: String,
    text: String,
) -> Result<WorkSnapshot> {
    care_note_add_with(&open, &target_kind, &target_id, &text)
}

/// Change what a care note says.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a text that does not fit or a note not in this
/// work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn care_note_update(
    open: State<'_, OpenWork>,
    id: String,
    text: String,
) -> Result<WorkSnapshot> {
    care_note_update_with(&open, &id, &text)
}

/// Move a care note one step among its target's, `up` or `down`. At the edge
/// nothing moves, and that is not an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a direction that is neither or a note not in
/// this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn care_note_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    care_note_move_with(&open, &id, &direction)
}

/// Remove a care note.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a note not in this work; and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn care_note_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    care_note_remove_with(&open, &id)
}

/// A care note's text: trimmed, 1 to 1 000 characters, no control character
/// but a line break or a tab.
///
/// # Errors
///
/// [`Error::InvalidInput`], with the sentence.
pub fn care_text(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(Error::InvalidInput(CARE_NOTE_EMPTY.into()));
    }
    if value.chars().count() > MAX_CARE_NOTE_CHARS {
        return Err(Error::InvalidInput(format!(
            "A care note is at most {MAX_CARE_NOTE_CHARS} characters."
        )));
    }
    if value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(Error::InvalidInput(
            "A care note holds a control character that cannot be kept.".into(),
        ));
    }
    Ok(value.to_string())
}

/// What [`care_note_add`] does once the state is in hand.
pub fn care_note_add_with(
    open: &OpenWork,
    target_kind: &str,
    target_id: &str,
    text: &str,
) -> Result<WorkSnapshot> {
    let text = care_text(text)?;
    change_work(open, |conn| {
        repo::add(conn, target_kind, target_id, &text).map(|_| ())
    })
}

/// What [`care_note_update`] does once the state is in hand.
pub fn care_note_update_with(open: &OpenWork, id: &str, text: &str) -> Result<WorkSnapshot> {
    let text = care_text(text)?;
    change_work(open, |conn| repo::update(conn, id, &text))
}

/// What [`care_note_move`] does once the state is in hand.
pub fn care_note_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| repo::move_one(conn, id, direction))
}

/// What [`care_note_remove`] does once the state is in hand.
pub fn care_note_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| repo::remove(conn, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::checks::{
        check_add_with, check_answer_with, stage_close_with, stage_start_with, AnswerDraft,
    };
    use crate::commands::plan::{stage_add_with, stage_remove_with};
    use crate::commands::rooms::{room_add_with, room_remove_with};
    use crate::commands::work::tests::host_with_a_work;
    use crate::commands::work::work_close_with;

    #[test]
    fn care_notes_are_added_changed_moved_and_removed_on_the_wire_in_camel_case() {
        let (_db, open, _scratch) = host_with_a_work();
        let plan = room_add_with(&open, "Bathroom").unwrap();
        let room = plan.rooms[0].id.clone();
        let work = plan.work.work_id.clone();

        care_note_add_with(
            &open,
            "room",
            &room,
            "  Reseal the shower grout once a year ",
        )
        .unwrap();
        let plan =
            care_note_add_with(&open, "room", &room, "The stopcock\nis under the sink").unwrap();
        assert_eq!(plan.care_notes.len(), 2);
        let plan = care_note_add_with(&open, "work", &work, "Breaker by the door").unwrap();

        let wire = serde_json::to_value(&plan.care_notes).unwrap();
        assert_eq!(wire[0]["targetKind"], "work");
        assert_eq!(wire[0]["targetId"], work.as_str());
        assert_eq!(wire[1]["targetKind"], "room");
        assert_eq!(wire[1]["targetId"], room.as_str());
        assert_eq!(wire[1]["text"], "Reseal the shower grout once a year");
        assert_eq!(wire[1]["position"], 1);
        assert_eq!(wire[2]["text"], "The stopcock\nis under the sink");
        assert!(wire[2]["createdAt"].is_string() && wire[2]["id"].as_str().unwrap().len() == 36);

        let second = plan.care_notes[2].id.clone();
        let plan = care_note_move_with(&open, &second, "up").unwrap();
        assert_eq!(plan.care_notes[1].id, second);
        let plan = care_note_update_with(&open, &second, "Stopcock: under the sink").unwrap();
        assert_eq!(plan.care_notes[1].text, "Stopcock: under the sink");
        let plan = care_note_remove_with(&open, &second).unwrap();
        assert_eq!(plan.care_notes.len(), 2);
        assert_eq!(plan.care_notes[1].position, 1);

        for (refused, words) in [
            (
                care_note_add_with(&open, "room", &room, "   "),
                CARE_NOTE_EMPTY.to_string(),
            ),
            (
                care_note_add_with(&open, "room", &room, &"x".repeat(1001)),
                "A care note is at most 1000 characters.".into(),
            ),
            (
                care_note_add_with(&open, "room", &room, "a\u{7}b"),
                "A care note holds a control character that cannot be kept.".into(),
            ),
            (
                care_note_add_with(&open, "decision", &room, "x"),
                repo::CARE_TARGET_KIND.into(),
            ),
            (
                care_note_move_with(&open, &plan.care_notes[0].id, "sideways"),
                String::new(),
            ),
            (
                care_note_update_with(&open, &second, "x"),
                repo::CARE_NOTE_NOT_FOUND.into(),
            ),
        ] {
            let error = refused.unwrap_err();
            assert_eq!(error.kind(), "invalid_input", "{error}");
            if !words.is_empty() {
                assert_eq!(error.to_string(), words);
            }
        }
        care_note_add_with(&open, "room", &room, &"é".repeat(1000))
            .expect("1 000 characters, not bytes");
        work_close_with(&open);
    }

    /// Not the plan: a closed stage keeps taking its notes, and a removed room
    /// or stage takes its own with it.
    #[test]
    fn a_closed_stage_takes_notes_and_a_removed_room_or_stage_takes_its_notes_with_it() {
        let (_db, open, _scratch) = host_with_a_work();
        let tiling = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let painting = stage_add_with(&open, "Painting").unwrap().stages[1]
            .id
            .clone();
        let room = room_add_with(&open, "Bathroom").unwrap().rooms[0]
            .id
            .clone();
        let check = check_add_with(&open, &tiling, "close", "Inspected")
            .unwrap()
            .checks[0]
            .id
            .clone();
        stage_start_with(&open, &tiling).unwrap();
        check_answer_with(
            &open,
            &AnswerDraft {
                check_id: &check,
                answer: "yes",
                reason: None,
                photo_path: None,
                photo_hash: None,
            },
            "Synthetic author",
        )
        .unwrap();
        stage_close_with(&open, &tiling).unwrap();

        let plan = care_note_add_with(&open, "stage", &tiling, "Spare tiles in the garage")
            .expect("a closed stage takes a care note");
        let note = plan.care_notes[0].id.clone();
        care_note_update_with(&open, &note, "Spare tiles: garage, top shelf").unwrap();
        care_note_add_with(&open, "stage", &painting, "Paint code 1234").unwrap();
        care_note_add_with(&open, "room", &room, "Grout yearly").unwrap();

        let plan = room_remove_with(&open, &room).unwrap();
        assert_eq!(plan.care_notes.len(), 2);
        let plan = stage_remove_with(&open, &painting).unwrap();
        let left: Vec<&str> = plan.care_notes.iter().map(|n| n.text.as_str()).collect();
        assert_eq!(left, vec!["Spare tiles: garage, top shelf"]);
        work_close_with(&open);
    }
}
