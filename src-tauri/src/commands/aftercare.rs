//! The commands for after the handover (G4): the warranties the work came
//! with, the maintenance it needs, each time a task was done, and the calendar
//! file that puts it on a phone's or a computer's calendar.
//!
//! A warranty and a task are not the plan: no approval locks them and a closed
//! stage does not refuse them. They are added, written whole, moved and
//! removed at any time — except that a task that has been done is not removed,
//! nor the room or the stage it is on. Each time a task was done is a fact:
//! there is no command that edits or removes one, and it is never before the
//! time it follows (`db::maintenance_done`).
//!
//! Months cross the boundary as whole calendar months — a warranty's `months`,
//! 1 to 600; a task's `everyMonths`, 1 to 120 — and are checked here to be
//! whole. "Today", for the day a task was done, is the host's clock in local
//! time. When a warranty ends, when a task is next due and what is overdue are
//! the domain's, computed every time; nothing here computes them.
//!
//! The calendar file is the domain's text — an RFC 5545 VCALENDAR, composed in
//! `src/domain/aftercare.ts` — written whole or not at all through the one path
//! every file the host saves takes (`files::save`): a full path, `.ics` only,
//! at most 1 MiB, an existing file replaced only with `overwrite`. The host
//! never parses it, and sends nothing anywhere: the person's own calendar does
//! the reminding.
//!
//! # Changelog of this boundary
//!
//! - G4: `warranty_add`, `warranty_update`, `warranty_move`,
//!   `warranty_remove`, `maintenance_add`, `maintenance_update`,
//!   `maintenance_move`, `maintenance_remove`, `maintenance_done_add`,
//!   `aftercare_ics_write`.

use std::path::Path;

use chrono::NaiveDate;
use tauri::State;

use crate::commands::change_orders::{has_control, not_after_today};
use crate::commands::work::change_work;
use crate::contract::{
    MaintenanceDoneDraft, MaintenanceDraft, WarrantyDraft, WorkSnapshot, WrittenFile,
};
use crate::db::maintenance::{self, TaskFields};
use crate::db::maintenance_done::{self, NewDone};
use crate::db::warranties::{self, WarrantyFields};
use crate::error::{Error, Result};
use crate::files::save;
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The longest title a warranty or a task keeps.
pub const MAX_TITLE_CHARS: usize = 200;

/// The longest "given by" a warranty keeps.
pub const MAX_GIVEN_BY_CHARS: usize = 120;

/// The longest note on a warranty or a task.
pub const MAX_NOTE_CHARS: usize = 1000;

/// The longest note on a time a task was done.
pub const MAX_DONE_NOTE_CHARS: usize = 500;

/// The longest warranty, in calendar months: fifty years.
pub const MAX_WARRANTY_MONTHS: i64 = 600;

/// The longest interval of a task, in calendar months: ten years.
pub const MAX_EVERY_MONTHS: i64 = 120;

/// The largest calendar file written: 1 MiB — far past every warranty and task
/// a work could hold.
pub const MAX_ICS_BYTES: u64 = 1024 * 1024;

/// The sentence for a warranty with no title.
pub const WARRANTY_TITLE_NEEDED: &str = "A warranty needs a title: say what it is for.";

/// The sentence for a task with no title.
pub const TASK_TITLE_NEEDED: &str = "A maintenance task needs a title: say what is to be done.";

/// The sentence for a warranty's length that does not fit.
pub const WARRANTY_MONTHS: &str = "A warranty lasts a whole number of months, from 1 to 600.";

/// The sentence for a task's interval that does not fit.
pub const EVERY_MONTHS: &str =
    "A maintenance task comes back every whole number of months, from 1 to 120.";

/// The sentence for a change that does not say which warranty.
pub const WARRANTY_ID_NEEDED: &str = "A change to a warranty says which warranty.";

/// The sentence for a change that does not say which task.
pub const TASK_ID_NEEDED: &str = "A change to a maintenance task says which task.";

/// The sentence for a time done that does not say which task.
pub const DONE_TASK_NEEDED: &str = "Say which maintenance task was done.";

/// The sentence for a calendar file saved to a path that is not a full one.
pub const ICS_FULL_PATH: &str = "A calendar file is saved to a file chosen by its full path.";

/// The calendar file of what comes due after the handover: `.ics`, at most
/// [`MAX_ICS_BYTES`].
pub const ICS_FILE: save::Kind = save::Kind {
    extension: "ics",
    not_this_kind: "a calendar file is a .ics file",
    max_bytes: MAX_ICS_BYTES,
    too_large: "it would be larger than 1 MiB",
    full_path: ICS_FULL_PATH,
    logged_as: "the aftercare calendar",
};

/// Add a warranty at the end of its target's: what it is for, on the work, a
/// room or a stage, who gives it, from when, for how many months, and
/// optionally its filed paper.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (a title, who gives
/// it, a day, a length, a note), a target not in this work, or a document not
/// in this work or not filed as a warranty; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn warranty_add(open: State<'_, OpenWork>, draft: WarrantyDraft) -> Result<WorkSnapshot> {
    warranty_add_with(&open, &draft)
}

/// Write a warranty whole: `null` clears who gives it, its document and its
/// note. A warranty moved to another target goes to the end of that target's.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, a draft that names
/// no warranty, a warranty or a target not in this work, or a document not in
/// this work or not filed as a warranty; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn warranty_update(open: State<'_, OpenWork>, draft: WarrantyDraft) -> Result<WorkSnapshot> {
    warranty_update_with(&open, &draft)
}

/// Move a warranty one step among its target's, `up` or `down`. At the edge
/// nothing moves, and that is not an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a direction that is neither or a warranty not
/// in this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn warranty_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    warranty_move_with(&open, &id, &direction)
}

/// Remove a warranty.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a warranty not in this work; and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn warranty_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    warranty_remove_with(&open, &id)
}

/// Add a maintenance task at the end of its target's: what is to be done, on
/// the work, a room or a stage, every how many months, and when it is first
/// due.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (a title, an
/// interval, a day, a note) or a target not in this work; and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn maintenance_add(open: State<'_, OpenWork>, draft: MaintenanceDraft) -> Result<WorkSnapshot> {
    maintenance_add_with(&open, &draft)
}

/// Write a maintenance task whole — its interval too, done or not: the next
/// due day counts from the last time it was done. `null` clears its note.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, a draft that names
/// no task, or a task or a target not in this work; and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn maintenance_update(
    open: State<'_, OpenWork>,
    draft: MaintenanceDraft,
) -> Result<WorkSnapshot> {
    maintenance_update_with(&open, &draft)
}

/// Move a maintenance task one step among its target's, `up` or `down`. At the
/// edge nothing moves, and that is not an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a direction that is neither or a task not in
/// this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn maintenance_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    maintenance_move_with(&open, &id, &direction)
}

/// Remove a maintenance task that has never been done.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a task not in this work, or one that has been
/// done; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn maintenance_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    maintenance_remove_with(&open, &id)
}

/// Record that a maintenance task was done, on a day that has happened and
/// not before the time it follows.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a draft that names no task, a day that is not
/// one or is after today, a note that does not fit, a task not in this work,
/// or a day before the last time it was done; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn maintenance_done_add(
    open: State<'_, OpenWork>,
    record: MaintenanceDoneDraft,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    maintenance_done_add_with(&open, &record, today, &account::display_name())
}

/// Write the calendar file the domain composed, whole or not at all: a full
/// path, `.ics`, at most 1 MiB; an existing file replaced only with
/// `overwrite: true`, which the interface sends when the save dialog chose the
/// path. No work needs to be open. Answers `{ path, bytes }`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that is not a full one, a name that is
/// not `.ics`, text larger than 1 MiB, a folder that is not there, a folder
/// where the file would be, or a file already there without `overwrite`;
/// [`Error::Io`] when the disk refuses — and then nothing is left behind.
#[tauri::command(rename_all = "snake_case")]
pub fn aftercare_ics_write(
    path: String,
    text: String,
    overwrite: Option<bool>,
) -> Result<WrittenFile> {
    aftercare_ics_write_with(&path, &text, overwrite.unwrap_or(false))
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// A value the form may have left empty: trimmed, and nothing is none.
fn given(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// A line of text: trimmed, empty is none, at most `max` characters, one
/// line with no control character.
fn line(what: &str, value: Option<&str>, max: usize) -> Result<Option<String>> {
    let Some(value) = given(value) else {
        return Ok(None);
    };
    if value.chars().count() > max {
        return Err(invalid(format!("{what} is at most {max} characters.")));
    }
    if has_control(value, false) {
        return Err(invalid(format!(
            "{what} is one line, with no control character."
        )));
    }
    Ok(Some(value.to_string()))
}

/// A note: trimmed, empty is none, at most `max` characters, no control
/// characters but line breaks and tabs.
fn note(what: &str, value: Option<&str>, max: usize) -> Result<Option<String>> {
    let Some(value) = given(value) else {
        return Ok(None);
    };
    if value.chars().count() > max {
        return Err(invalid(format!("{what} is at most {max} characters.")));
    }
    if has_control(value, true) {
        return Err(invalid(format!(
            "{what} holds a control character that cannot be kept."
        )));
    }
    Ok(Some(value.to_string()))
}

/// Whole calendar months, 1 to `max`.
fn months(value: f64, max: i64, sentence: &str) -> Result<i64> {
    if value.is_finite() && value.fract() == 0.0 && (1.0..=max as f64).contains(&value) {
        Ok(value as i64)
    } else {
        Err(invalid(sentence))
    }
}

/// A warranty's fields, checked.
fn warranty_fields(draft: &WarrantyDraft) -> Result<WarrantyFields> {
    Ok(WarrantyFields {
        target_kind: draft.target_kind.trim().to_string(),
        target_id: draft.target_id.trim().to_string(),
        title: line("A warranty's title", Some(&draft.title), MAX_TITLE_CHARS)?
            .ok_or_else(|| invalid(WARRANTY_TITLE_NEEDED))?,
        given_by: line(
            "Who gives a warranty",
            draft.given_by.as_deref(),
            MAX_GIVEN_BY_CHARS,
        )?,
        starts_on: validate::date("The day a warranty starts", &draft.starts_on)?,
        months: months(draft.months, MAX_WARRANTY_MONTHS, WARRANTY_MONTHS)?,
        document_id: given(draft.document_id.as_deref()).map(str::to_string),
        note: note("A warranty's note", draft.note.as_deref(), MAX_NOTE_CHARS)?,
    })
}

/// A task's fields, checked.
fn task_fields(draft: &MaintenanceDraft) -> Result<TaskFields> {
    Ok(TaskFields {
        target_kind: draft.target_kind.trim().to_string(),
        target_id: draft.target_id.trim().to_string(),
        title: line(
            "A maintenance task's title",
            Some(&draft.title),
            MAX_TITLE_CHARS,
        )?
        .ok_or_else(|| invalid(TASK_TITLE_NEEDED))?,
        every_months: months(draft.every_months, MAX_EVERY_MONTHS, EVERY_MONTHS)?,
        first_due_on: validate::date("The day a task is first due", &draft.first_due_on)?,
        note: note(
            "A maintenance task's note",
            draft.note.as_deref(),
            MAX_NOTE_CHARS,
        )?,
    })
}

/// What [`warranty_add`] does once the state is in hand.
pub fn warranty_add_with(open: &OpenWork, draft: &WarrantyDraft) -> Result<WorkSnapshot> {
    let fields = warranty_fields(draft)?;
    change_work(open, |conn| warranties::add(conn, &fields).map(|_| ()))
}

/// What [`warranty_update`] does once the state is in hand.
pub fn warranty_update_with(open: &OpenWork, draft: &WarrantyDraft) -> Result<WorkSnapshot> {
    let id = given(draft.id.as_deref()).ok_or_else(|| invalid(WARRANTY_ID_NEEDED))?;
    let fields = warranty_fields(draft)?;
    change_work(open, |conn| warranties::update(conn, id, &fields))
}

/// What [`warranty_move`] does once the state is in hand.
pub fn warranty_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| {
        warranties::move_one(conn, id.trim(), direction)
    })
}

/// What [`warranty_remove`] does once the state is in hand.
pub fn warranty_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| warranties::remove(conn, id.trim()))
}

/// What [`maintenance_add`] does once the state is in hand.
pub fn maintenance_add_with(open: &OpenWork, draft: &MaintenanceDraft) -> Result<WorkSnapshot> {
    let fields = task_fields(draft)?;
    change_work(open, |conn| maintenance::add(conn, &fields).map(|_| ()))
}

/// What [`maintenance_update`] does once the state is in hand.
pub fn maintenance_update_with(open: &OpenWork, draft: &MaintenanceDraft) -> Result<WorkSnapshot> {
    let id = given(draft.id.as_deref()).ok_or_else(|| invalid(TASK_ID_NEEDED))?;
    let fields = task_fields(draft)?;
    change_work(open, |conn| maintenance::update(conn, id, &fields))
}

/// What [`maintenance_move`] does once the state is in hand.
pub fn maintenance_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| {
        maintenance::move_one(conn, id.trim(), direction)
    })
}

/// What [`maintenance_remove`] does once the state is in hand.
pub fn maintenance_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| maintenance::remove(conn, id.trim()))
}

/// What [`maintenance_done_add`] does once the state, today and the author
/// are in hand.
pub fn maintenance_done_add_with(
    open: &OpenWork,
    draft: &MaintenanceDoneDraft,
    today: NaiveDate,
    author: &str,
) -> Result<WorkSnapshot> {
    let new = NewDone {
        task_id: given(Some(&draft.task_id))
            .ok_or_else(|| invalid(DONE_TASK_NEEDED))?
            .to_string(),
        done_on: not_after_today(
            validate::date("The day a task was done", &draft.done_on)?,
            today,
            "a task is recorded as done on a day that has",
        )?,
        note: note(
            "A note on the time it was done",
            draft.note.as_deref(),
            MAX_DONE_NOTE_CHARS,
        )?,
        author_name: author.to_string(),
    };
    change_work(open, |conn| {
        maintenance_done::append(conn, &new).map(|_| ())
    })
}

/// What [`aftercare_ics_write`] does.
pub fn aftercare_ics_write_with(path: &str, text: &str, overwrite: bool) -> Result<WrittenFile> {
    let path = Path::new(path);
    save::write(path, text.as_bytes(), overwrite, &ICS_FILE)?;
    Ok(WrittenFile {
        path: path.to_string_lossy().into_owned(),
        bytes: text.len() as u64,
        pages: None,
    })
}
