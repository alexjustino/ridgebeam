//! The commands for purchases (G2): what to order, and what happened to it.
//!
//! A purchase is plan: added, written whole and removed at any time — the
//! plan's approval does not lock it, since buying is the work, not its scope —
//! except that a purchase something has happened to is not removed, and its
//! lead time, stage and activity are fixed once it has been ordered. What
//! happened — `ordered`, `delivered`, `cancelled` (the order fell through) —
//! is a fact: there is no command that edits or removes one, and the order
//! of what can happen is the host's and the schema's both (`db::
//! purchase_events`).
//!
//! A lead time crosses the boundary as whole calendar days (`leadDays`, 0 to
//! 365) — suppliers quote calendar days — and is checked here to be whole.
//! "Today", for an event's day, is the host's clock in local time. The day to
//! order by, what to order this week, what is late to order and what is late
//! to arrive are the domain's, computed every time; nothing here computes
//! them.
//!
//! # Changelog of this boundary
//!
//! - G2: `purchase_add`, `purchase_update`, `purchase_remove`,
//!   `purchase_event_add`.

use chrono::NaiveDate;
use tauri::State;

use crate::commands::change_orders::{has_control, not_after_today};
use crate::commands::work::change_work;
use crate::contract::{PurchaseDraft, PurchaseEventDraft, WorkSnapshot};
use crate::db::purchase_events::{self, Kind, NewEvent};
use crate::db::purchases::{self, PurchaseFields};
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The longest name a purchase keeps.
pub const MAX_NAME_CHARS: usize = 200;

/// The longest quantity a purchase keeps, in words.
pub const MAX_QUANTITY_CHARS: usize = 60;

/// The longest supplier a purchase keeps.
pub const MAX_SUPPLIER_CHARS: usize = 120;

/// The longest note on a purchase.
pub const MAX_NOTE_CHARS: usize = 2000;

/// The longest note on what happened to a purchase.
pub const MAX_EVENT_NOTE_CHARS: usize = 500;

/// The longest lead time, in calendar days.
pub const MAX_LEAD_DAYS: i64 = 365;

/// The sentence for a purchase with no name.
pub const NAME_NEEDED: &str = "A purchase needs a name: say what is to be bought.";

/// The sentence for a lead time that does not fit.
pub const LEAD_DAYS: &str = "A lead time is a whole number of calendar days, from 0 to 365.";

/// The sentence for a change that does not say which purchase.
pub const PURCHASE_ID_NEEDED: &str = "A change to a purchase says which purchase.";

/// The sentence for an event that does not say which purchase.
pub const EVENT_PURCHASE_NEEDED: &str = "Say which purchase was ordered, delivered or cancelled.";

/// The sentence for a kind of event that is not one.
pub const KIND_UNKNOWN: &str = "A purchase is marked as ordered, delivered or cancelled.";

/// Add a purchase: what, on which stage (and optionally which of its
/// activities), how much, from whom and how long the supplier takes.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (a name, a quantity,
/// a supplier, a lead time, a note), a stage or an activity not in this work,
/// or an activity of another stage; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn purchase_add(open: State<'_, OpenWork>, draft: PurchaseDraft) -> Result<WorkSnapshot> {
    purchase_add_with(&open, &draft)
}

/// Write a purchase whole: `null` clears its activity, quantity, supplier and
/// note. Once it has been ordered, only its name, quantity, supplier and note
/// change: its lead time, stage and activity are fixed.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, a draft that names
/// no purchase, a purchase, a stage or an activity not in this work, an
/// activity of another stage, or a change to the lead time, the stage or the
/// activity of a purchase that has been ordered; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn purchase_update(open: State<'_, OpenWork>, draft: PurchaseDraft) -> Result<WorkSnapshot> {
    purchase_update_with(&open, &draft)
}

/// Remove a purchase nothing has happened to.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a purchase not in this work, or one that has
/// been ordered; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn purchase_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    purchase_remove_with(&open, &id)
}

/// Record what happened to a purchase, on a day that has happened: ordered,
/// delivered, or the order fell through (`cancelled`).
///
/// # Errors
///
/// [`Error::InvalidInput`] for a kind that is not one, a day that is not one
/// or is after today, a note that does not fit, a purchase not in this work,
/// or an event the order of what can happen does not allow — delivered or
/// cancelled without an open order, ordered twice, anything after delivered,
/// a day before the event it follows; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn purchase_event_add(
    open: State<'_, OpenWork>,
    event: PurchaseEventDraft,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    purchase_event_add_with(&open, &event, today, &account::display_name())
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

/// A lead time: whole calendar days, 0 to [`MAX_LEAD_DAYS`].
fn lead_days(value: f64) -> Result<i64> {
    if value.is_finite() && value.fract() == 0.0 && (0.0..=MAX_LEAD_DAYS as f64).contains(&value) {
        Ok(value as i64)
    } else {
        Err(invalid(LEAD_DAYS))
    }
}

/// A purchase's fields, checked.
fn fields(draft: &PurchaseDraft) -> Result<PurchaseFields> {
    Ok(PurchaseFields {
        stage_id: draft.stage_id.trim().to_string(),
        activity_id: given(draft.activity_id.as_deref()).map(str::to_string),
        name: line("A purchase's name", Some(&draft.name), MAX_NAME_CHARS)?
            .ok_or_else(|| invalid(NAME_NEEDED))?,
        quantity: line(
            "A purchase's quantity",
            draft.quantity.as_deref(),
            MAX_QUANTITY_CHARS,
        )?,
        supplier: line(
            "A purchase's supplier",
            draft.supplier.as_deref(),
            MAX_SUPPLIER_CHARS,
        )?,
        lead_days: lead_days(draft.lead_days)?,
        note: note("A purchase's note", draft.note.as_deref(), MAX_NOTE_CHARS)?,
    })
}

fn kind(value: &str) -> Result<Kind> {
    match value.trim() {
        "ordered" => Ok(Kind::Ordered),
        "delivered" => Ok(Kind::Delivered),
        "cancelled" => Ok(Kind::Cancelled),
        _ => Err(invalid(KIND_UNKNOWN)),
    }
}

/// What [`purchase_add`] does once the state is in hand.
pub fn purchase_add_with(open: &OpenWork, draft: &PurchaseDraft) -> Result<WorkSnapshot> {
    let fields = fields(draft)?;
    change_work(open, |conn| purchases::add(conn, &fields).map(|_| ()))
}

/// What [`purchase_update`] does once the state is in hand.
pub fn purchase_update_with(open: &OpenWork, draft: &PurchaseDraft) -> Result<WorkSnapshot> {
    let id = given(draft.id.as_deref()).ok_or_else(|| invalid(PURCHASE_ID_NEEDED))?;
    let fields = fields(draft)?;
    change_work(open, |conn| purchases::update(conn, id, &fields))
}

/// What [`purchase_remove`] does once the state is in hand.
pub fn purchase_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| purchases::remove(conn, id.trim()))
}

/// What [`purchase_event_add`] does once the state, today and the author are
/// in hand.
pub fn purchase_event_add_with(
    open: &OpenWork,
    draft: &PurchaseEventDraft,
    today: NaiveDate,
    author: &str,
) -> Result<WorkSnapshot> {
    let new = NewEvent {
        purchase_id: given(Some(&draft.purchase_id))
            .ok_or_else(|| invalid(EVENT_PURCHASE_NEEDED))?
            .to_string(),
        kind: kind(&draft.kind)?,
        day: not_after_today(
            validate::date(
                "The day of an order, a delivery or a cancellation",
                &draft.day,
            )?,
            today,
            "a purchase is marked on a day that has",
        )?,
        note: note(
            "A note on what happened",
            draft.note.as_deref(),
            MAX_EVENT_NOTE_CHARS,
        )?,
        author_name: author.to_string(),
    };
    change_work(open, |conn| purchase_events::append(conn, &new).map(|_| ()))
}
