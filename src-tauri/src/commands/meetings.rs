//! The commands for site meetings (G1): close a meeting, writing its minutes;
//! close an action between meetings.
//!
//! An open meeting is the interface's — its agenda, the attendees ticked, the
//! notes and actions being written live on screen until the person closes it.
//! What is decided in the meeting goes through the product's own commands as
//! it happens. [`meeting_close`] then writes the minutes in one transaction:
//! the meeting, who was there, each item with what was said and done, the
//! actions raised and the earlier actions closed at it, on its day. Any
//! refusal writes nothing. The minutes are never edited; a mistake is said in
//! the next meeting's minutes.
//!
//! Minutes with nobody ticked are taken: who attended is what the person
//! ticked. A meeting needs no approved plan. "Today", for a day not yet
//! happened, is the host's clock in local time.
//!
//! Which actions are open or overdue, and the agenda itself, are the domain's,
//! computed every time; nothing here stores them.
//!
//! # Changelog of this boundary
//!
//! - G1: `meeting_close`, `meeting_action_close`.

use chrono::NaiveDate;
use tauri::State;

use crate::commands::change_orders::{has_control, not_after_today};
use crate::commands::work::with_work;
use crate::contract::{
    ActionClosureDraft, AttendeeDraft, CarriedClosureDraft, MeetingActionDraft, MeetingItemDraft,
    MinutesDraft, WorkSnapshot,
};
use crate::db::meetings::{
    self, Attendee, CarriedClosure, NewAction, NewActionClosure, NewItem, NewMinutes, Outcome,
    ITEM_KINDS,
};
use crate::db::work as repo;
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate::MAX_NAME_CHARS;

/// The longest notes a meeting keeps.
pub const MAX_NOTES_CHARS: usize = 4000;

/// The longest title an item keeps, and the longest action.
pub const MAX_TITLE_CHARS: usize = 200;

/// The longest note an item keeps.
pub const MAX_ITEM_NOTE_CHARS: usize = 2000;

/// The longest outcome an item keeps.
pub const MAX_OUTCOME_CHARS: usize = 200;

/// The longest id an item refers to.
pub const MAX_REF_CHARS: usize = 64;

/// The longest note an action's closure keeps.
pub const MAX_CLOSURE_NOTE_CHARS: usize = 500;

/// The most attendees, items, actions and closures one set of minutes holds.
pub const MAX_ATTENDEES: usize = 100;
/// See [`MAX_ATTENDEES`].
pub const MAX_ITEMS: usize = 500;
/// See [`MAX_ATTENDEES`].
pub const MAX_ACTIONS: usize = 200;
/// See [`MAX_ATTENDEES`].
pub const MAX_CLOSURES: usize = 500;

/// The sentence for an outcome that is not one.
pub const OUTCOME_UNKNOWN: &str = "An action is closed as done or dropped.";

/// The sentence for an attendee with both a person and a name, or neither.
pub fn attendee_one_of(position: usize) -> String {
    format!("Attendee {position} is a person of the plan or somebody named: one of the two.")
}

/// The sentence for an item of a kind that is not one.
pub fn item_kind_unknown(position: usize) -> String {
    format!(
        "Item {position} is not a kind of agenda item: an item is an action carried, a decision, a change order, a snag, a payment, why the work is late, the next two weeks, a gate, or something else."
    )
}

/// The sentence for an item with no title.
pub fn item_title_needed(position: usize) -> String {
    format!("Item {position} needs a title: say what it was about.")
}

/// The sentence for an action with no words.
pub fn action_text_needed(position: usize) -> String {
    format!("Action {position} needs words: say what is to be done.")
}

/// The sentence for an action on a person and on somebody named.
pub fn action_on_both(position: usize) -> String {
    format!("Action {position} is on a person of the plan or on somebody named, not both.")
}

/// Close a meeting: its minutes written whole — who was there, each item with
/// what was said and done, the actions raised and the earlier actions closed
/// at it — or, on any refusal, nothing.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (a day not happened
/// yet, an attendee with both a person and a
/// name or neither, an item of a kind that is not one, a text over its limit,
/// an action due before the meeting, more of anything than minutes hold), a
/// person not in this work, a person or a name twice, a closure of an action not in this
/// work or already closed; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn meeting_close(open: State<'_, OpenWork>, minutes: MinutesDraft) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    meeting_close_with(&open, &minutes, today, &account::display_name())
}

/// Close an action between meetings, once: done or dropped.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an outcome that is not one, a day not happened
/// yet or before the meeting that raised the action, a note over its limit, an
/// action not in this work or already closed; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn meeting_action_close(
    open: State<'_, OpenWork>,
    closure: ActionClosureDraft,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    meeting_action_close_with(&open, &closure, today, &account::display_name())
}

/// What [`meeting_close`] does once the state is in hand, signed by
/// `author_name`.
pub fn meeting_close_with(
    open: &OpenWork,
    draft: &MinutesDraft,
    today: NaiveDate,
    author_name: &str,
) -> Result<WorkSnapshot> {
    let held_on = not_after_today(
        crate::validate::date("A meeting's day", &draft.held_on)?,
        today,
        "a meeting is held on a day that has",
    )?;
    let notes = notes(draft.notes.as_deref())?;
    for (count, max, what) in [
        (draft.attendees.len(), MAX_ATTENDEES, "attendees"),
        (draft.items.len(), MAX_ITEMS, "items"),
        (draft.actions.len(), MAX_ACTIONS, "actions"),
        (draft.closures.len(), MAX_CLOSURES, "closed actions"),
    ] {
        if count > max {
            return Err(invalid(format!(
                "Minutes hold at most {max} {what}; these have {count}."
            )));
        }
    }
    let attendees = draft
        .attendees
        .iter()
        .enumerate()
        .map(|(index, attendee)| attendee_of(index + 1, attendee))
        .collect::<Result<Vec<_>>>()?;
    let items = draft
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| item_of(index + 1, item))
        .collect::<Result<Vec<_>>>()?;
    let actions = draft
        .actions
        .iter()
        .enumerate()
        .map(|(index, action)| action_of(index + 1, action))
        .collect::<Result<Vec<_>>>()?;
    let closures = draft
        .closures
        .iter()
        .map(carried_of)
        .collect::<Result<Vec<_>>>()?;
    let new = NewMinutes {
        held_on,
        notes,
        attendees,
        items,
        actions,
        closures,
        author_name: author_name.to_string(),
    };
    with_work(open, |state| {
        meetings::record(&state.conn, &new)?;
        repo::snapshot(&state.conn)
    })
}

/// What [`meeting_action_close`] does once the state is in hand, signed by
/// `author_name`.
pub fn meeting_action_close_with(
    open: &OpenWork,
    draft: &ActionClosureDraft,
    today: NaiveDate,
    author_name: &str,
) -> Result<WorkSnapshot> {
    let outcome = outcome(&draft.outcome)?;
    let closed_on = not_after_today(
        crate::validate::date("An action's closing day", &draft.closed_on)?,
        today,
        "an action is closed on a day that has",
    )?;
    let new = NewActionClosure {
        action_id: draft.action_id.trim().to_string(),
        outcome,
        closed_on,
        note: text(
            "A closing note",
            draft.note.as_deref(),
            MAX_CLOSURE_NOTE_CHARS,
        )?,
        author_name: author_name.to_string(),
    };
    with_work(open, |state| {
        meetings::close_action(&state.conn, &new)?;
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

/// One line: trimmed, `needed` when empty, at most `max` characters, no
/// control character. `what` is the sentence's subject (`Item 2's title`).
fn line(what: &str, value: &str, max: usize, needed: impl FnOnce() -> String) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid(needed()));
    }
    if value.chars().count() > max {
        return Err(invalid(format!("{what} is at most {max} characters.")));
    }
    if has_control(value, false) {
        return Err(invalid(format!(
            "{what} is one line, with no control character."
        )));
    }
    Ok(value.to_string())
}

/// A longer text: trimmed, empty is none, at most `max` characters, no control
/// characters but line breaks and tabs.
fn text(what: &str, value: Option<&str>, max: usize) -> Result<Option<String>> {
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

/// The meeting's notes: [`text`], said in the plural.
fn notes(value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = given(value) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_NOTES_CHARS {
        return Err(invalid(format!(
            "A meeting's notes are at most {MAX_NOTES_CHARS} characters."
        )));
    }
    if has_control(value, true) {
        return Err(invalid(
            "A meeting's notes hold a control character that cannot be kept.",
        ));
    }
    Ok(Some(value.to_string()))
}

/// Somebody named, on an attendee or an action.
fn named(what: &str, value: &str) -> Result<String> {
    line(what, value, MAX_NAME_CHARS, || format!("{what} is empty."))
}

/// An attendee: a person of the plan or somebody named — exactly one.
fn attendee_of(position: usize, draft: &AttendeeDraft) -> Result<Attendee> {
    match (
        given(draft.person_id.as_deref()),
        given(draft.name.as_deref()),
    ) {
        (Some(person), None) => Ok(Attendee::Person(person.to_string())),
        (None, Some(name)) => Ok(Attendee::Named(named(
            &format!("Attendee {position}'s name"),
            name,
        )?)),
        _ => Err(invalid(attendee_one_of(position))),
    }
}

/// An item as it was taken.
fn item_of(position: usize, draft: &MeetingItemDraft) -> Result<NewItem> {
    if !ITEM_KINDS.contains(&draft.kind.as_str()) {
        return Err(invalid(item_kind_unknown(position)));
    }
    let ref_id = match given(draft.ref_id.as_deref()) {
        None => None,
        Some(id) => Some(line(
            &format!("Item {position}'s reference"),
            id,
            MAX_REF_CHARS,
            String::new,
        )?),
    };
    Ok(NewItem {
        kind: draft.kind.clone(),
        ref_id,
        title: line(
            &format!("Item {position}'s title"),
            &draft.title,
            MAX_TITLE_CHARS,
            || item_title_needed(position),
        )?,
        note: text(
            &format!("Item {position}'s note"),
            draft.note.as_deref(),
            MAX_ITEM_NOTE_CHARS,
        )?,
        outcome: text(
            &format!("Item {position}'s outcome"),
            draft.outcome.as_deref(),
            MAX_OUTCOME_CHARS,
        )?,
    })
}

/// An action raised: what, on whom (a person, somebody named, or nobody — not
/// both), by when.
fn action_of(position: usize, draft: &MeetingActionDraft) -> Result<NewAction> {
    let text = line(
        &format!("Action {position}"),
        &draft.text,
        MAX_TITLE_CHARS,
        || action_text_needed(position),
    )?;
    let on = match (
        given(draft.person_id.as_deref()),
        given(draft.name.as_deref()),
    ) {
        (Some(_), Some(_)) => return Err(invalid(action_on_both(position))),
        (Some(person), None) => Some(Attendee::Person(person.to_string())),
        (None, Some(name)) => Some(Attendee::Named(named(
            &format!("The name on action {position}"),
            name,
        )?)),
        (None, None) => None,
    };
    let due_on = crate::validate::optional_date(
        &format!("Action {position}'s due day"),
        given(draft.due_on.as_deref()),
    )?;
    Ok(NewAction { text, on, due_on })
}

/// An earlier action closed at this meeting.
fn carried_of(draft: &CarriedClosureDraft) -> Result<CarriedClosure> {
    Ok(CarriedClosure {
        action_id: draft.action_id.trim().to_string(),
        outcome: outcome(&draft.outcome)?,
        note: text(
            "A closing note",
            draft.note.as_deref(),
            MAX_CLOSURE_NOTE_CHARS,
        )?,
    })
}

fn outcome(value: &str) -> Result<Outcome> {
    match value {
        "done" => Ok(Outcome::Done),
        "dropped" => Ok(Outcome::Dropped),
        _ => Err(invalid(OUTCOME_UNKNOWN)),
    }
}
