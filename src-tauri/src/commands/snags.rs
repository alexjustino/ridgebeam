//! The commands for snags (E4): raise one, close one.
//!
//! A snag — pt "pendência" — is a defect or a pending item found near the end
//! of a work: where it is (a stage, optionally one of its activities), who must
//! fix it (a person of the plan, or nobody), the day it is due and a photo of
//! the problem. It is closed once: `fixed`, always with a photo of it fixed,
//! or `withdrawn`, always with a note saying why. Neither is ever edited or
//! removed; a snag found again after its fix is a new snag.
//!
//! A closed stage takes a snag (snags are found after closing), and so does an
//! approved plan: a snag is a record of the site, not a plan edit.
//!
//! A photo crosses the boundary as the SHA-256 of an **image document of the
//! work** (`photoHash`), never as a path: the interface adds the file as a
//! document first, through the existing intake — as the gates' needs-photo
//! check does — and sends its hash. The host checks the hash names a document
//! of the work that is an image, and that its file is in the work's own
//! `documents/`. "Today", for a day not yet happened, is the host's clock in
//! local time.
//!
//! What a snag holds back as retention, whether it is overdue and how long it
//! has waited are the domain's, computed every time; nothing here stores them.
//!
//! # Changelog of this boundary
//!
//! - E4: `snag_raise`, `snag_close`.

use chrono::NaiveDate;
use tauri::State;

use crate::commands::change_orders::{has_control, not_after_today, text};
use crate::commands::work::with_work;
use crate::contract::{SnagClosureDraft, SnagDraft, WorkSnapshot};
use crate::db::snags::{
    self, NewClosure, NewSnag, Outcome, FIXED_NEEDS_PHOTO, WITHDRAWN_NEEDS_NOTE,
};
use crate::db::work as repo;
use crate::error::{Error, Result};
use crate::files::intake::{self, NOT_A_PHOTO};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The longest title a snag keeps.
pub const MAX_TITLE_CHARS: usize = 200;

/// The sentence for a snag with no title.
pub const TITLE_NEEDED: &str = "A snag needs a title: say what is wrong.";

/// The sentence for an outcome that is not one.
pub const OUTCOME_UNKNOWN: &str = "A snag is closed as fixed or withdrawn.";

/// The sentence for a due day before the snag was raised.
pub fn due_before_raised(raised_on: &str) -> String {
    format!("A snag is due on or after the day it was raised, {raised_on}.")
}

/// Raise a snag: what is wrong, where, who must fix it, by when, and a photo
/// of it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (a day not happened
/// yet, a title, a description, a due day before the snag was raised), a
/// stage, an activity or a person not in this work, an activity of another
/// stage, or a photo that is not an image document of the work; and the
/// errors of every work command. A closed stage is not refused.
#[tauri::command(rename_all = "snake_case")]
pub fn snag_raise(open: State<'_, OpenWork>, draft: SnagDraft) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    snag_raise_with(&open, &draft, today, &account::display_name())
}

/// Close a snag, once: `fixed`, with a photo of it fixed, or `withdrawn`, with
/// a note saying why.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an outcome that is not one, a day not happened
/// yet or before the snag was raised, `fixed` without a photo, `withdrawn`
/// without a note, a note that does not fit, a photo that is not an image
/// document of the work, a snag not in this work or already closed; and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn snag_close(open: State<'_, OpenWork>, closure: SnagClosureDraft) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    snag_close_with(&open, &closure, today, &account::display_name())
}

/// What [`snag_raise`] does once the state is in hand, signed by
/// `author_name`.
pub fn snag_raise_with(
    open: &OpenWork,
    draft: &SnagDraft,
    today: NaiveDate,
    author_name: &str,
) -> Result<WorkSnapshot> {
    let raised_on = not_after_today(
        validate::date("A snag's day", &draft.raised_on)?,
        today,
        "a snag is raised on a day that has",
    )?;
    let due_on = validate::optional_date("A snag's due day", given(draft.due_on.as_deref()))?;
    if let Some(due_on) = &due_on {
        if *due_on < raised_on {
            return Err(invalid(due_before_raised(&raised_on)));
        }
    }
    let new = NewSnag {
        raised_on,
        title: title(&draft.title)?,
        description: text("A snag's description", draft.description.as_deref())?,
        stage_id: draft.stage_id.trim().to_string(),
        activity_id: given(draft.activity_id.as_deref()).map(str::to_string),
        person_id: given(draft.person_id.as_deref()).map(str::to_string),
        due_on,
        photo_hash: photo(draft.photo_hash.as_deref())?,
        author_name: author_name.to_string(),
    };
    with_work(open, |state| {
        refuse_unless_in_folder(&state.folder, new.photo_hash.as_deref())?;
        snags::raise(&state.conn, &new)?;
        repo::snapshot(&state.conn)
    })
}

/// What [`snag_close`] does once the state is in hand, signed by
/// `author_name`.
pub fn snag_close_with(
    open: &OpenWork,
    draft: &SnagClosureDraft,
    today: NaiveDate,
    author_name: &str,
) -> Result<WorkSnapshot> {
    let outcome = outcome(&draft.outcome)?;
    let closed_on = not_after_today(
        validate::date("A snag's closing day", &draft.closed_on)?,
        today,
        "a snag is closed on a day that has",
    )?;
    let photo_hash = photo(draft.photo_hash.as_deref())?;
    let note = text("A closing note", draft.note.as_deref())?;
    match outcome {
        Outcome::Fixed if photo_hash.is_none() => return Err(invalid(FIXED_NEEDS_PHOTO)),
        Outcome::Withdrawn if note.is_none() => return Err(invalid(WITHDRAWN_NEEDS_NOTE)),
        _ => {}
    }
    let new = NewClosure {
        snag_id: draft.snag_id.trim().to_string(),
        outcome,
        closed_on,
        photo_hash,
        note,
        author_name: author_name.to_string(),
    };
    with_work(open, |state| {
        refuse_unless_in_folder(&state.folder, new.photo_hash.as_deref())?;
        snags::close(&state.conn, &new)?;
        repo::snapshot(&state.conn)
    })
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// A value the form may have left empty: trimmed, and nothing is none.
fn given(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// A title: trimmed, not empty, one line, at most [`MAX_TITLE_CHARS`].
fn title(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid(TITLE_NEEDED));
    }
    if value.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(format!(
            "A snag's title is at most {MAX_TITLE_CHARS} characters."
        )));
    }
    if has_control(value, false) {
        return Err(invalid(
            "A snag's title is one line, with no control character.",
        ));
    }
    Ok(value.to_string())
}

/// A photo by hash: 64 lowercase hex digits, or none. Whether it names an
/// image document of the work is the file's to say (`db::snags`).
fn photo(value: Option<&str>) -> Result<Option<String>> {
    match given(value) {
        None => Ok(None),
        Some(hash) if intake::is_hash(hash) => Ok(Some(hash.to_string())),
        Some(_) => Err(invalid(NOT_A_PHOTO)),
    }
}

/// The photo's file is in the work's own `documents/`.
fn refuse_unless_in_folder(folder: &std::path::Path, hash: Option<&str>) -> Result<()> {
    match hash {
        Some(hash) if intake::original(folder, hash).is_none() => Err(invalid(NOT_A_PHOTO)),
        _ => Ok(()),
    }
}

fn outcome(value: &str) -> Result<Outcome> {
    match value {
        "fixed" => Ok(Outcome::Fixed),
        "withdrawn" => Ok(Outcome::Withdrawn),
        _ => Err(invalid(OUTCOME_UNKNOWN)),
    }
}
