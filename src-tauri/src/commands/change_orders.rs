//! The commands for change orders (E1): raise one, decide one.
//!
//! A change order is a record, not a plan edit: raising one needs no open
//! replanning, only an approved plan — before approval there are none, and the
//! plan is changed freely. Deciding one is once: approved, declined or
//! withdrawn. An approval writes the change into the plan inside a replanning
//! (opened with the reason `Change order #N — title`, or the one already
//! open), in the same transaction as the decision; the person then reviews the
//! plan and takes the next baseline, as always.
//!
//! What a change does to the finish is the domain's, computed from the
//! schedule before anybody decides; the interface sends it with the decision
//! (`finishBefore`, `finishAfter`, `daysDelta`) and the host keeps it as the
//! fact of that moment — it never computes a schedule. "Today", for a day not
//! yet happened, is the host's clock in local time.
//!
//! # Changelog of this boundary
//!
//! - E1: `change_order_raise`, `change_order_decide`.

use chrono::NaiveDate;
use tauri::State;

use crate::commands::work::change_work;
use crate::contract::{
    ChangeEffect, ChangeEffectDraft, ChangeOrderDecisionDraft, ChangeOrderDraft, WorkSnapshot,
};
use crate::db::change_effects::MAX_EFFECTS;
use crate::db::change_orders::{self, AskedBy, NewChangeOrder, NewDecision, Outcome};
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate::{self, MAX_AMOUNT_CENTS};

/// The longest title a change order keeps.
pub const MAX_TITLE_CHARS: usize = 200;

/// The longest description of a change, and the longest note on a decision.
pub const MAX_TEXT_CHARS: usize = 2000;

/// The longest name of somebody, not a person of the plan, who asked.
pub const MAX_ASKED_BY_NAME_CHARS: usize = 120;

/// The most working days a decision may say a change moved the finish, either
/// way — far past any work of this kind.
pub const MAX_DAYS_DELTA: i64 = 36_500;

/// The sentence for who asked, when it is none of the three.
pub const ASKED_BY_UNKNOWN: &str =
    "A change is asked for by the owner, by a person of the plan, or by somebody else, named.";

/// The sentence for a change a person asked for that does not say which.
pub const ASKED_BY_PERSON_NEEDED: &str =
    "A change asked for by a person of the plan says which person.";

/// The sentence for a change somebody else asked for that does not name them.
pub const ASKED_BY_NAME_NEEDED: &str = "A change asked for by somebody else needs their name.";

/// The sentence for an effect of a kind that is not one.
pub const EFFECT_KIND_UNKNOWN: &str =
    "A change adds an activity, changes an activity's duration, or removes an activity.";

/// The sentence for a duration change or a removal that names no activity.
pub const EFFECT_ACTIVITY_NEEDED: &str =
    "A change to an activity's duration, or its removal, names the activity.";

/// The sentence for an outcome that is not one.
pub const OUTCOME_UNKNOWN: &str = "A change order is approved, declined or withdrawn.";

/// The sentence for a cost that does not fit.
pub const COST_NOT_WHOLE: &str =
    "A change's cost is a whole number of cents — below zero when it saves money.";

/// The sentence for days that do not fit.
pub const DAYS_NOT_WHOLE: &str =
    "The working days a change moves the finish are a whole number, below zero when it finishes earlier.";

/// Raise a change order on an approved plan: who asked, the stage it lands
/// in, what it costs, what it does to the plan.
///
/// # Errors
///
/// [`Error::InvalidInput`] before the plan is approved, for a value that does
/// not fit (a day not happened yet, a title, a description, who asked, a
/// cost, an effect), a stage, a person or an activity not in this work, a
/// duration outside its activity's range, an activity a payment milestone is
/// earned by, or an activity named against itself; [`Error::StageClosed`] for
/// a closed stage, or a target in one; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn change_order_raise(
    open: State<'_, OpenWork>,
    draft: ChangeOrderDraft,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    change_order_raise_with(&open, &draft, today, &account::display_name())
}

/// Decide a change order, once: approved — written into the plan inside a
/// replanning, with its cost line — declined, or withdrawn.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (an outcome, a day
/// not happened yet or before the change was raised, a note, a finish date,
/// the days), a change order not in this work or already decided; for an
/// approval, the plan's own refusals as each effect is written, among them
/// [`Error::StageClosed`] and [`Error::DependencyCycle`] — on any of them
/// nothing is written; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn change_order_decide(
    open: State<'_, OpenWork>,
    decision: ChangeOrderDecisionDraft,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    change_order_decide_with(&open, &decision, today, &account::display_name())
}

/// What [`change_order_raise`] does once the state is in hand, signed by
/// `author_name`.
pub fn change_order_raise_with(
    open: &OpenWork,
    draft: &ChangeOrderDraft,
    today: NaiveDate,
    author_name: &str,
) -> Result<WorkSnapshot> {
    let new = NewChangeOrder {
        raised_on: not_after_today(
            validate::date("A change order's day", &draft.raised_on)?,
            today,
            "a change order is raised on a day that has",
        )?,
        title: title(&draft.title)?,
        description: text("A change's description", draft.description.as_deref())?,
        asked_by: asked_by(draft)?,
        stage_id: draft.stage_id.clone(),
        cost_cents: draft.cost_cents.map(cost_cents).transpose()?,
        effects: effects(&draft.effects)?,
        author_name: author_name.to_string(),
    };
    change_work(open, |conn| change_orders::raise(conn, &new).map(|_| ()))
}

/// What [`change_order_decide`] does once the state is in hand, signed by
/// `author_name`.
pub fn change_order_decide_with(
    open: &OpenWork,
    draft: &ChangeOrderDecisionDraft,
    today: NaiveDate,
    author_name: &str,
) -> Result<WorkSnapshot> {
    let new = NewDecision {
        change_order_id: draft.id.clone(),
        outcome: outcome(&draft.outcome)?,
        decided_on: not_after_today(
            validate::date("A decision's day", &draft.decided_on)?,
            today,
            "a change order is decided on a day that has",
        )?,
        note: text("A decision's note", draft.note.as_deref())?,
        finish_before: validate::optional_date(
            "The finish before the change",
            draft.finish_before.as_deref(),
        )?,
        finish_after: validate::optional_date(
            "The finish with the change",
            draft.finish_after.as_deref(),
        )?,
        days_delta: draft.days_delta.map(days_delta).transpose()?,
        author_name: author_name.to_string(),
    };
    change_work(open, |conn| change_orders::decide(conn, &new))
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// A day that has happened, by the host's clock.
fn not_after_today(day: String, today: NaiveDate, rule: &str) -> Result<String> {
    if day > today.format("%Y-%m-%d").to_string() {
        return Err(invalid(format!("{day} has not happened yet: {rule}.")));
    }
    Ok(day)
}

/// Whether a text holds a control character other than a line break or a tab.
fn has_control(value: &str, line_breaks: bool) -> bool {
    value
        .chars()
        .any(|c| c.is_control() && !(line_breaks && matches!(c, '\n' | '\r' | '\t')))
}

/// A title: trimmed, not empty, one line, at most [`MAX_TITLE_CHARS`].
fn title(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid("A change order needs a title: say what changes."));
    }
    if value.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(format!(
            "A change order's title is at most {MAX_TITLE_CHARS} characters."
        )));
    }
    if has_control(value, false) {
        return Err(invalid(
            "A change order's title is one line, with no control character.",
        ));
    }
    Ok(value.to_string())
}

/// A longer text: trimmed, empty is none, at most [`MAX_TEXT_CHARS`], no
/// control characters but line breaks and tabs.
fn text(what: &str, value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(format!(
            "{what} is at most {MAX_TEXT_CHARS} characters."
        )));
    }
    if has_control(value, true) {
        return Err(invalid(format!(
            "{what} holds a control character that cannot be kept."
        )));
    }
    Ok(Some(value.to_string()))
}

/// Who asked, from the draft: the person's id is read only when a person
/// asked, and the name only when somebody else did — a field the form left
/// behind from another choice is not kept.
fn asked_by(draft: &ChangeOrderDraft) -> Result<AskedBy> {
    match draft.asked_by.as_str() {
        "owner" => Ok(AskedBy::Owner),
        "person" => draft
            .asked_by_person_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| AskedBy::Person(id.to_string()))
            .ok_or_else(|| invalid(ASKED_BY_PERSON_NEEDED)),
        "other" => {
            let name = draft
                .asked_by_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| invalid(ASKED_BY_NAME_NEEDED))?;
            if name.chars().count() > MAX_ASKED_BY_NAME_CHARS {
                return Err(invalid(format!(
                    "The name of who asked is at most {MAX_ASKED_BY_NAME_CHARS} characters."
                )));
            }
            if has_control(name, false) {
                return Err(invalid(
                    "The name of who asked is one line, with no control character.",
                ));
            }
            Ok(AskedBy::Other(name.to_string()))
        }
        _ => Err(invalid(ASKED_BY_UNKNOWN)),
    }
}

/// A cost: a whole number of cents, signed, within the bound of every amount.
fn cost_cents(value: f64) -> Result<i64> {
    let bound = MAX_AMOUNT_CENTS as f64;
    if value.is_finite() && value.fract() == 0.0 && (-bound..=bound).contains(&value) {
        Ok(value as i64)
    } else {
        Err(invalid(COST_NOT_WHOLE))
    }
}

/// Days a change moves the finish: whole, signed, within [`MAX_DAYS_DELTA`].
fn days_delta(value: f64) -> Result<i64> {
    let bound = MAX_DAYS_DELTA as f64;
    if value.is_finite() && value.fract() == 0.0 && (-bound..=bound).contains(&value) {
        Ok(value as i64)
    } else {
        Err(invalid(DAYS_NOT_WHOLE))
    }
}

fn outcome(value: &str) -> Result<Outcome> {
    match value {
        "approved" => Ok(Outcome::Approved),
        "declined" => Ok(Outcome::Declined),
        "withdrawn" => Ok(Outcome::Withdrawn),
        _ => Err(invalid(OUTCOME_UNKNOWN)),
    }
}

/// The effects as the interface sent them, read into their shape: at most
/// [`MAX_EFFECTS`], each a kind it knows, with what that kind needs. Whether
/// the ids are in this work is the file's to say (`db::change_effects`).
fn effects(drafts: &[ChangeEffectDraft]) -> Result<Vec<ChangeEffect>> {
    if drafts.len() > MAX_EFFECTS {
        return Err(invalid(format!(
            "A change order does at most {MAX_EFFECTS} things to the plan; raise another for the rest."
        )));
    }
    drafts.iter().map(effect).collect()
}

fn effect(draft: &ChangeEffectDraft) -> Result<ChangeEffect> {
    let id = |value: Option<&str>| {
        value
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
    };
    let duration = |value: Option<f64>| validate::duration_days(value.unwrap_or(0.0));
    match draft.kind.as_str() {
        "add" => Ok(ChangeEffect::Add {
            name: validate::name("activity", draft.name.as_deref().unwrap_or(""))?,
            duration_days: duration(draft.duration_days)?,
            after: id(draft.after.as_deref()),
        }),
        "duration" => Ok(ChangeEffect::Duration {
            activity_id: id(draft.activity_id.as_deref())
                .ok_or_else(|| invalid(EFFECT_ACTIVITY_NEEDED))?,
            duration_days: duration(draft.duration_days)?,
        }),
        "remove" => Ok(ChangeEffect::Remove {
            activity_id: id(draft.activity_id.as_deref())
                .ok_or_else(|| invalid(EFFECT_ACTIVITY_NEEDED))?,
        }),
        _ => Err(invalid(EFFECT_KIND_UNKNOWN)),
    }
}
