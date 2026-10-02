//! The commands for funding (E2): where the money comes from, and the money
//! that arrived.
//!
//! A fund is plan: added, written whole and removed at any time — the plan's
//! approval does not lock it, since funding is not the plan's scope — except
//! that a fund a receipt names is not removed. A receipt is a fact: there is
//! no command that edits or removes one, and `funding_receipt_reverse` writes
//! the negative receipt that undoes one, once.
//!
//! Amounts cross the boundary as whole minor units (`amountCents`) and are
//! checked here to be whole and more than 0. "Today", for a receipt's day, is
//! the host's clock in local time — the second guard behind the domain's.
//! Whether the money lasts is the domain's, computed every time; nothing here
//! projects anything.
//!
//! # Changelog of this boundary
//!
//! - E2: `funding_add`, `funding_update`, `funding_remove`,
//!   `funding_receipt_add`, `funding_receipt_reverse`.

use chrono::NaiveDate;
use tauri::State;

use crate::commands::work::change_work;
use crate::contract::{FundingDraft, FundingReceiptDraft, WorkSnapshot};
use crate::db::funding::{self, FundingFields};
use crate::db::funding_receipts::{self, NewReceipt};
use crate::error::{Error, Result};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The longest label a fund keeps, and the longest source.
pub const MAX_LABEL_CHARS: usize = 200;

/// The longest note on a fund.
pub const MAX_NOTE_CHARS: usize = 2000;

/// The longest note on a receipt — a line of the ledger.
pub const MAX_RECEIPT_NOTE_CHARS: usize = 200;

/// The sentence for a fund's amount that does not fit.
pub const FUNDING_AMOUNT: &str = "A fund's amount is more than zero, in whole cents.";

/// The sentence for an amount received that does not fit.
pub const RECEIPT_AMOUNT: &str = "An amount received is more than zero, in whole cents.";

/// The sentence for a change that does not say which fund.
pub const FUNDING_ID_NEEDED: &str = "A change to a fund says which fund.";

/// Add a fund the work expects.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit (a label, a source,
/// an amount, a day, a note); and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn funding_add(open: State<'_, OpenWork>, draft: FundingDraft) -> Result<WorkSnapshot> {
    funding_add_with(&open, &draft)
}

/// Write a fund whole: `null` clears its source and its note.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, a draft that names
/// no fund, or a fund not in this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn funding_update(open: State<'_, OpenWork>, draft: FundingDraft) -> Result<WorkSnapshot> {
    funding_update_with(&open, &draft)
}

/// Remove a fund no receipt names.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a fund not in this work, or one money has been
/// received against; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn funding_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    funding_remove_with(&open, &id)
}

/// Record money received, on a day that has happened — against a fund, or
/// none for money that arrived unplanned.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a day that is not one or is after today, an
/// amount that is not more than zero in whole cents, a note that does not fit,
/// or a fund not in this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn funding_receipt_add(
    open: State<'_, OpenWork>,
    draft: FundingReceiptDraft,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    funding_receipt_add_with(&open, &draft, today, &account::display_name())
}

/// Reverse money received, in full, on a day that has happened and is not
/// before it arrived.
///
/// # Errors
///
/// [`Error::MoneyReversal`] for a receipt that is not there, is itself a
/// reversal, or has already been reversed; [`Error::InvalidInput`] for a day
/// that is not one, is after today, or is before the money arrived; and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn funding_receipt_reverse(
    open: State<'_, OpenWork>,
    seq: i64,
    day: String,
) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    funding_receipt_reverse_with(&open, seq, &day, today, &account::display_name())
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// Whether a text holds a control character other than a line break or a tab.
fn has_control(value: &str, line_breaks: bool) -> bool {
    value
        .chars()
        .any(|c| c.is_control() && !(line_breaks && matches!(c, '\n' | '\r' | '\t')))
}

/// A line of text: trimmed, empty is none, at most `max` characters, one
/// line with no control character.
fn line(what: &str, value: Option<&str>, max: usize) -> Result<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
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
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
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

/// An amount more than 0, whole, with the sentence of what it is.
fn amount(value: f64, sentence: &str) -> Result<i64> {
    validate::amount_cents(value, true).map_err(|_| invalid(sentence))
}

/// A fund's fields, checked.
fn fields(draft: &FundingDraft) -> Result<FundingFields> {
    Ok(FundingFields {
        label: line("A fund's label", Some(&draft.label), MAX_LABEL_CHARS)?
            .ok_or_else(|| invalid("A fund needs a label: say what the money is."))?,
        source: line("A fund's source", draft.source.as_deref(), MAX_LABEL_CHARS)?,
        amount_cents: amount(draft.amount_cents, FUNDING_AMOUNT)?,
        expected_on: validate::date("The day a fund is expected", &draft.expected_on)?,
        note: note("A fund's note", draft.note.as_deref(), MAX_NOTE_CHARS)?,
    })
}

/// A day that has happened, by the host's clock.
fn not_after_today(day: String, today: NaiveDate, rule: &str) -> Result<String> {
    if day > today.format("%Y-%m-%d").to_string() {
        return Err(invalid(format!("{day} has not happened yet: {rule}.")));
    }
    Ok(day)
}

/// What [`funding_add`] does once the state is in hand.
pub fn funding_add_with(open: &OpenWork, draft: &FundingDraft) -> Result<WorkSnapshot> {
    let fields = fields(draft)?;
    change_work(open, |conn| funding::add(conn, &fields).map(|_| ()))
}

/// What [`funding_update`] does once the state is in hand.
pub fn funding_update_with(open: &OpenWork, draft: &FundingDraft) -> Result<WorkSnapshot> {
    let id = draft
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| invalid(FUNDING_ID_NEEDED))?;
    let fields = fields(draft)?;
    change_work(open, |conn| funding::update(conn, id, &fields))
}

/// What [`funding_remove`] does once the state is in hand.
pub fn funding_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| funding::remove(conn, id))
}

/// What [`funding_receipt_add`] does once the state, today and the author are
/// in hand.
pub fn funding_receipt_add_with(
    open: &OpenWork,
    draft: &FundingReceiptDraft,
    today: NaiveDate,
    author: &str,
) -> Result<WorkSnapshot> {
    let new = NewReceipt {
        day: not_after_today(
            validate::date("The day money was received", &draft.day)?,
            today,
            "money received is recorded on the day it arrived, or later",
        )?,
        funding_id: draft
            .funding_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string),
        amount_cents: amount(draft.amount_cents, RECEIPT_AMOUNT)?,
        note: line(
            "A receipt's note",
            draft.note.as_deref(),
            MAX_RECEIPT_NOTE_CHARS,
        )?,
        author_name: author.to_string(),
    };
    change_work(open, |conn| {
        funding_receipts::append(conn, &new).map(|_| ())
    })
}

/// What [`funding_receipt_reverse`] does once the state, today and the author
/// are in hand.
pub fn funding_receipt_reverse_with(
    open: &OpenWork,
    seq: i64,
    day: &str,
    today: NaiveDate,
    author: &str,
) -> Result<WorkSnapshot> {
    let day = not_after_today(
        validate::date("The day of a reversal", day)?,
        today,
        "a reversal is recorded on a day that has happened",
    )?;
    change_work(open, |conn| {
        funding_receipts::reverse(conn, seq, &day, author).map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plan::{activity_add_with, stage_add_with};
    use crate::commands::schedule::baseline_take_with;
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::{work_close_with, work_get_with};
    use crate::contract::BaselineRowDraft;
    use serde_json::json;

    const AUTHOR: &str = "A. Owner (synthetic)";

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
    }

    fn fund(value: serde_json::Value) -> FundingDraft {
        serde_json::from_value(value).unwrap()
    }

    fn receipt(value: serde_json::Value) -> FundingReceiptDraft {
        serde_json::from_value(value).unwrap()
    }

    /// The e2e's shape in the host: savings now and a tranche to come, the
    /// tranche partly received early, a reversal, and the wire as the
    /// interface reads it.
    #[test]
    fn funds_are_planned_received_and_reversed_and_cross_the_wire_in_camel_case() {
        let (_db, open, _scratch) = host_with_a_work();

        let plan = funding_add_with(
            &open,
            &fund(json!({
                "label": "  Savings  ", "source": "Our account", "amountCents": 2000000,
                "expectedOn": "2026-10-01"
            })),
        )
        .unwrap();
        let savings = plan.funding[0].id.clone();
        let plan = funding_add_with(
            &open,
            &fund(json!({
                "label": "Loan, first tranche", "amountCents": 5000000,
                "expectedOn": "2026-10-30", "note": "Released after the slab.\nBy the bank."
            })),
        )
        .unwrap();
        let tranche = plan.funding[1].id.clone();
        let wire = serde_json::to_value(&plan).unwrap();
        assert_eq!(
            wire["funding"][0],
            json!({
                "id": savings, "position": 1, "label": "Savings", "source": "Our account",
                "amountCents": 2000000, "expectedOn": "2026-10-01", "note": null
            })
        );
        assert_eq!(wire["funding"][1]["source"], json!(null));
        assert_eq!(wire["fundingReceipts"], json!([]), "present, and empty");

        funding_receipt_add_with(
            &open,
            &receipt(json!({ "fundingId": savings, "amountCents": 2000000, "day": "2026-10-01" })),
            today(),
            AUTHOR,
        )
        .unwrap();
        let plan = funding_receipt_add_with(
            &open,
            &receipt(json!({
                "fundingId": tranche, "amountCents": 1500000, "day": "2026-10-09",
                "note": "Part, early"
            })),
            today(),
            AUTHOR,
        )
        .unwrap();
        let wire = serde_json::to_value(&plan.funding_receipts[1]).unwrap();
        let created = wire["createdAt"].clone();
        assert_eq!(
            wire,
            json!({
                "id": plan.funding_receipts[1].id, "seq": 2, "day": "2026-10-09",
                "fundingId": tranche, "amountCents": 1500000, "note": "Part, early",
                "reversesSeq": null, "authorName": AUTHOR, "createdAt": created
            })
        );

        let plan = funding_receipt_reverse_with(&open, 2, "2026-10-09", today(), AUTHOR).unwrap();
        let reversal = serde_json::to_value(plan.funding_receipts.last().unwrap()).unwrap();
        assert_eq!(
            (
                &reversal["seq"],
                &reversal["amountCents"],
                &reversal["reversesSeq"],
                &reversal["fundingId"],
                &reversal["note"]
            ),
            (
                &json!(3),
                &json!(-1500000),
                &json!(2),
                &json!(tranche),
                &json!(null)
            )
        );
        assert_eq!(
            plan.funding_receipts
                .iter()
                .map(|r| r.amount_cents)
                .sum::<i64>(),
            2_000_000
        );

        let refused =
            funding_receipt_reverse_with(&open, 2, "2026-10-09", today(), AUTHOR).unwrap_err();
        assert_eq!(refused.kind(), "money_reversal");
        assert_eq!(
            refused.to_string(),
            "Receipt #2 has already been reversed by #3."
        );

        // Written whole: the note and the source are cleared by `null`.
        let plan = funding_update_with(
            &open,
            &fund(json!({
                "id": tranche, "label": "Loan, tranche 1", "source": null,
                "amountCents": 4500000, "expectedOn": "2026-11-06", "note": null
            })),
        )
        .unwrap();
        let t = &plan.funding[1];
        assert_eq!(
            (
                t.label.as_str(),
                t.amount_cents,
                t.expected_on.as_str(),
                &t.note
            ),
            ("Loan, tranche 1", 4_500_000, "2026-11-06", &None)
        );
        work_close_with(&open);
    }

    #[test]
    fn a_receipt_on_a_day_not_yet_happened_or_of_nothing_is_refused_and_nothing_is_written() {
        let (_db, open, _scratch) = host_with_a_work();
        let long = "n".repeat(201);
        for (draft, sentence) in [
            (
                json!({ "amountCents": 100, "day": "2026-10-10" }),
                "2026-10-10 has not happened yet: money received is recorded on the day it arrived, or later.".to_string(),
            ),
            (json!({ "amountCents": 0, "day": "2026-10-09" }), RECEIPT_AMOUNT.to_string()),
            (json!({ "amountCents": -100, "day": "2026-10-09" }), RECEIPT_AMOUNT.to_string()),
            (json!({ "amountCents": 10.5, "day": "2026-10-09" }), RECEIPT_AMOUNT.to_string()),
            (
                json!({ "amountCents": 100, "day": "2026-10-09", "note": long }),
                "A receipt's note is at most 200 characters.".to_string(),
            ),
            (
                json!({ "amountCents": 100, "day": "2026-10-09", "fundingId": crate::db::new_id() }),
                funding::FUNDING_NOT_FOUND.to_string(),
            ),
        ] {
            let refused =
                funding_receipt_add_with(&open, &receipt(draft.clone()), today(), AUTHOR)
                    .unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{draft}");
            assert_eq!(refused.to_string(), sentence, "{draft}");
        }
        let refused = funding_receipt_add_with(
            &open,
            &receipt(json!({ "amountCents": 1, "day": "9 Oct" })),
            today(),
            AUTHOR,
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert!(work_get_with(&open).unwrap().funding_receipts.is_empty());

        // A reversal dated after today, or before the money arrived.
        funding_receipt_add_with(
            &open,
            &receipt(json!({ "amountCents": 100, "day": "2026-10-08" })),
            today(),
            AUTHOR,
        )
        .unwrap();
        let refused =
            funding_receipt_reverse_with(&open, 1, "2026-10-10", today(), AUTHOR).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "2026-10-10 has not happened yet: a reversal is recorded on a day that has happened."
        );
        let refused =
            funding_receipt_reverse_with(&open, 1, "2026-10-07", today(), AUTHOR).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "Receipt #1 arrived on 2026-10-08: it is reversed on that day or later."
        );
        assert_eq!(work_get_with(&open).unwrap().funding_receipts.len(), 1);
        work_close_with(&open);
    }

    #[test]
    fn a_fund_that_does_not_fit_is_refused_with_its_sentence() {
        let (_db, open, _scratch) = host_with_a_work();
        let base = json!({ "label": "Savings", "amountCents": 100, "expectedOn": "2026-10-01" });
        let with = |key: &str, value: serde_json::Value| {
            let mut draft = base.clone();
            draft[key] = value;
            fund(draft)
        };
        for (draft, sentence) in [
            (
                with("label", json!("   ")),
                "A fund needs a label: say what the money is.",
            ),
            (
                with("label", json!("x".repeat(201))),
                "A fund's label is at most 200 characters.",
            ),
            (
                with("label", json!("Two\nlines")),
                "A fund's label is one line, with no control character.",
            ),
            (
                with("source", json!("s".repeat(201))),
                "A fund's source is at most 200 characters.",
            ),
            (
                with("note", json!("n".repeat(2001))),
                "A fund's note is at most 2000 characters.",
            ),
            (with("amountCents", json!(0)), FUNDING_AMOUNT),
            (with("amountCents", json!(0.5)), FUNDING_AMOUNT),
        ] {
            let refused = funding_add_with(&open, &draft).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), sentence);
        }
        assert_eq!(
            funding_add_with(&open, &with("expectedOn", json!("2026-02-30")))
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
        assert_eq!(
            funding_update_with(&open, &fund(base.clone()))
                .unwrap_err()
                .to_string(),
            FUNDING_ID_NEEDED
        );
        assert_eq!(
            funding_update_with(&open, &with("id", json!(crate::db::new_id())))
                .unwrap_err()
                .to_string(),
            funding::FUNDING_NOT_FOUND
        );
        assert!(work_get_with(&open).unwrap().funding.is_empty());
        work_close_with(&open);
    }

    /// Funding is not the plan's scope: an approved plan with no replanning
    /// open still takes, changes and loses funds.
    #[test]
    fn funding_is_not_locked_by_the_plans_approval_and_a_received_fund_is_not_removed() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let rows: Vec<BaselineRowDraft> =
            vec![serde_json::from_value(json!({ "activityId": tiling })).unwrap()];
        baseline_take_with(&open, &rows, None).unwrap();
        assert!(work_get_with(&open).unwrap().work.approved_at.is_some());

        let draft = json!({ "label": "Savings", "amountCents": 100, "expectedOn": "2026-10-01" });
        let plan = funding_add_with(&open, &fund(draft.clone())).unwrap();
        let savings = plan.funding[0].id.clone();
        let plan = funding_add_with(&open, &fund(draft.clone())).unwrap();
        let spare = plan.funding[1].id.clone();
        let mut whole = draft.clone();
        whole["id"] = json!(savings);
        whole["amountCents"] = json!(250);
        funding_update_with(&open, &fund(whole)).expect("approved, and still changed");

        funding_receipt_add_with(
            &open,
            &receipt(json!({ "fundingId": savings, "amountCents": 250, "day": "2026-10-01" })),
            today(),
            AUTHOR,
        )
        .unwrap();
        let refused = funding_remove_with(&open, &savings).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), funding::FUNDING_RECEIVED);

        let plan = funding_remove_with(&open, &spare).expect("nothing received against it");
        assert_eq!(plan.funding.len(), 1);
        assert_eq!(plan.funding[0].position, 1);
        work_close_with(&open);
    }

    #[test]
    fn funding_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        assert_eq!(
            funding_remove_with(&open, "x").unwrap_err().kind(),
            "no_work_open"
        );
        assert_eq!(
            funding_receipt_reverse_with(&open, 1, "2026-10-09", today(), AUTHOR)
                .unwrap_err()
                .kind(),
            "no_work_open"
        );
    }
}
