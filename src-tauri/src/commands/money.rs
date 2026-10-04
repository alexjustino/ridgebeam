//! The commands for money: cost lines (planned), commitments (committed), and
//! the payments ledger (paid).
//!
//! Amounts cross the boundary as whole minor units (`amount_cents`) and are
//! checked here to be whole — money never passes through a fraction; the
//! interface formats them in the work's currency. A payment is a fact: there is
//! no command that edits or removes one, and `payment_reverse` writes the
//! negative payment that undoes one, with the reason. A receipt, or a quote's
//! document, is an image copied in by the photo pipeline under its caps (a PDF
//! is slice F7's), or one the work already holds, by hash.
//!
//! "Today", for a payment's day, is the host's clock in local time — the second
//! guard behind the domain's. Paid over committed is allowed and flagged by the
//! domain, never refused here.
//!
//! # Changelog of this boundary
//!
//! - F6: `cost_line_add`, `cost_line_update`, `cost_line_remove`,
//!   `commitment_add`, `commitment_update`, `commitment_remove`,
//!   `payment_add`, `payment_reverse`.
//! - F8: once the plan is approved, the cost lines are locked until a
//!   replanning is open (`plan_approved`) — planned money is compared between
//!   baselines. Commitments and payments are facts, and stay free.
//! - F9: a cost line may be added with no amount, and its amount taken away
//!   (`amount_cents: null`, `CostLinePatch.amountCents: null`) — "not priced
//!   yet", which is not 0.

use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use rusqlite::OptionalExtension;
use tauri::State;

use crate::commands::documents::file_it;
use crate::commands::work::{change_work, with_work};
use crate::contract::{CommitmentPatch, CostLinePatch, DocumentTarget, PaymentDraft, WorkSnapshot};
use crate::db::money::{self, CommitmentFields};
use crate::db::payments::{self, NewPayment};
use crate::db::replanning::refuse_if_plan_locked;
use crate::db::work as repo;
use crate::error::{Error, Result};
use crate::files::intake::{self, Accept, CopyIn, NOT_A_PHOTO};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The longest label a cost line or a commitment keeps.
pub const MAX_LABEL_CHARS: usize = 120;

/// The longest "what for" a payment keeps — and a reversal's reason.
pub const MAX_WHAT_FOR_CHARS: usize = 200;

/// Add a cost line to a stage, or to one of its activities.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a label or an amount that does not fit, a stage
/// or an activity not in this work, or an activity of another stage;
/// [`Error::StageClosed`] for a closed stage; and the errors of every work
/// command.
///
/// [`Error::PlanApproved`] when the plan is approved and no replanning is
/// open.
#[tauri::command(rename_all = "snake_case")]
pub fn cost_line_add(
    open: State<'_, OpenWork>,
    stage_id: String,
    activity_id: Option<String>,
    label: String,
    amount_cents: Option<f64>,
) -> Result<WorkSnapshot> {
    cost_line_add_with(
        &open,
        &stage_id,
        activity_id.as_deref(),
        &label,
        amount_cents,
    )
}

/// Change a cost line's label or amount.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit or a line not in this
/// work; [`Error::StageClosed`] for a closed stage; and the errors of every
/// work command.
///
/// [`Error::PlanApproved`] when the plan is approved and no replanning is
/// open, and the patch gives the line another label or amount.
#[tauri::command(rename_all = "snake_case")]
pub fn cost_line_update(
    open: State<'_, OpenWork>,
    id: String,
    patch: CostLinePatch,
) -> Result<WorkSnapshot> {
    cost_line_update_with(&open, &id, &patch)
}

/// Remove a cost line.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a line not in this work; [`Error::StageClosed`]
/// for a closed stage; and the errors of every work command.
///
/// [`Error::PlanApproved`] when the plan is approved and no replanning is
/// open.
#[tauri::command(rename_all = "snake_case")]
pub fn cost_line_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    cost_line_remove_with(&open, &id)
}

/// Add a commitment — a quote or contract accepted — to a stage, with its
/// document copied in from a path, or one the work holds, or none.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, a stage or a person
/// not in this work, both a path and a hash, or a hash naming no image of this
/// work; [`Error::PhotoRefused`] for a document refused under the caps; and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn commitment_add(
    open: State<'_, OpenWork>,
    stage_id: String,
    person_id: Option<String>,
    label: String,
    amount_cents: f64,
    agreed_on: String,
    document_path: Option<String>,
    document_hash: Option<String>,
) -> Result<WorkSnapshot> {
    commitment_add_with(
        &open,
        &stage_id,
        &CommitmentDraft {
            person_id: person_id.as_deref(),
            label: &label,
            amount_cents,
            agreed_on: &agreed_on,
            document_path: document_path.as_deref(),
            document_hash: document_hash.as_deref(),
        },
    )
}

/// Change a commitment, while nothing has been paid against it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit, a commitment that has
/// been paid against, or one not in this work; [`Error::PhotoRefused`] for a
/// document refused under the caps; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn commitment_update(
    open: State<'_, OpenWork>,
    id: String,
    patch: CommitmentPatch,
) -> Result<WorkSnapshot> {
    commitment_update_with(&open, &id, &patch)
}

/// Remove a commitment nothing has been paid against.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a commitment that has been paid against or one
/// not in this work; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn commitment_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    change_work(&open, |conn| money::remove_commitment(conn, &id))
}

/// Record a payment, dated today or earlier.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a day that is not one or is after today, an
/// amount that is not more than zero in whole cents, a stage, a person or a
/// commitment not in this work, a commitment of another stage, or a receipt
/// named both ways; [`Error::PhotoRefused`] for a receipt refused under the
/// caps (nothing is written); and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn payment_add(open: State<'_, OpenWork>, draft: PaymentDraft) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    payment_add_with(&open, &draft, today, &account::display_name())
}

/// Reverse a payment in full, today, saying why.
///
/// # Errors
///
/// [`Error::MoneyReversal`] for a payment that is not there, is itself a
/// reversal, or has already been reversed; [`Error::InvalidInput`] for a
/// missing or overlong reason; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn payment_reverse(open: State<'_, OpenWork>, seq: i64, note: String) -> Result<WorkSnapshot> {
    let today = chrono::Local::now().date_naive();
    payment_reverse_with(&open, seq, &note, today, &account::display_name())
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// A label: trimmed, not empty, at most 120 characters.
pub(crate) fn label(what: &str, value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid(format!("{what} needs a label.")));
    }
    if value.chars().count() > MAX_LABEL_CHARS {
        return Err(invalid(format!(
            "{what}'s label is at most {MAX_LABEL_CHARS} characters."
        )));
    }
    Ok(value.to_string())
}

/// A short text of the ledger: trimmed, empty is none, at most 200 characters,
/// no control characters.
fn ledger_text(what: &str, value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_WHAT_FOR_CHARS {
        return Err(invalid(format!(
            "{what} is at most {MAX_WHAT_FOR_CHARS} characters."
        )));
    }
    if value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(invalid(format!(
            "{what} holds a control character that cannot be kept."
        )));
    }
    Ok(Some(value.to_string()))
}

/// An image named by a path or by a hash, checked before the work is touched.
enum Image {
    None,
    Path(PathBuf),
    Hash(String),
}

fn image(path: Option<&str>, hash: Option<&str>) -> Result<Image> {
    match (path, hash) {
        (Some(_), Some(_)) => Err(invalid("One image, by its path or by its hash, not both.")),
        (Some(path), None) => {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                Ok(Image::Path(path))
            } else {
                Err(invalid("An image is chosen by its full path."))
            }
        }
        (None, Some(hash)) if intake::is_hash(hash) => Ok(Image::Hash(hash.to_string())),
        (None, Some(_)) => Err(invalid(NOT_A_PHOTO)),
        (None, None) => Ok(Image::None),
    }
}

/// The file's hash in the work — copied in by `copy` (with what was copied),
/// or found there.
fn place(
    copy: &mut CopyIn,
    folder: &Path,
    image: &Image,
) -> Result<Option<(String, Option<intake::Copied>)>> {
    match image {
        Image::None => Ok(None),
        Image::Path(path) => {
            let copied = copy.copy(path, Accept::Documents)?;
            Ok(Some((copied.hash.clone(), Some(copied))))
        }
        Image::Hash(hash) => {
            if intake::original(folder, hash).is_none() {
                return Err(invalid(NOT_A_PHOTO));
            }
            Ok(Some((hash.clone(), None)))
        }
    }
}

fn today_text() -> String {
    chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

/// What [`cost_line_add`] does once the state is in hand.
pub fn cost_line_add_with(
    open: &OpenWork,
    stage_id: &str,
    activity_id: Option<&str>,
    label_text: &str,
    amount_cents: Option<f64>,
) -> Result<WorkSnapshot> {
    let label = label("A cost line", label_text)?;
    let amount = amount_cents
        .map(|a| validate::amount_cents(a, false))
        .transpose()?;
    change_work(open, |conn| {
        refuse_if_plan_locked(conn)?;
        money::add_cost_line(conn, stage_id, activity_id, &label, amount).map(|_| ())
    })
}

/// What [`cost_line_update`] does once the state is in hand.
pub fn cost_line_update_with(
    open: &OpenWork,
    id: &str,
    patch: &CostLinePatch,
) -> Result<WorkSnapshot> {
    let label = patch
        .label
        .as_deref()
        .map(|l| label("A cost line", l))
        .transpose()?;
    let amount = patch
        .amount_cents
        .map(|a| a.map(|a| validate::amount_cents(a, false)).transpose())
        .transpose()?;
    change_work(open, |conn| {
        if cost_line_would_change(conn, id, label.as_deref(), amount)? {
            refuse_if_plan_locked(conn)?;
        }
        money::update_cost_line(conn, id, label.as_deref(), amount)
    })
}

/// What [`cost_line_remove`] does once the state is in hand.
pub fn cost_line_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| {
        refuse_if_plan_locked(conn)?;
        money::remove_cost_line(conn, id)
    })
}

/// Whether a cost line would read differently after the change — a patch
/// that repeats what the line holds changes nothing, and is not refused as a
/// change to an approved plan. A line not in this work is not refused here:
/// the update says so.
fn cost_line_would_change(
    conn: &rusqlite::Connection,
    id: &str,
    label: Option<&str>,
    amount_cents: Option<Option<i64>>,
) -> Result<bool> {
    let held: Option<(String, Option<i64>)> = conn
        .query_row(
            "SELECT label, amount_cents FROM cost_line WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((held_label, held_amount)) = held else {
        return Ok(false);
    };
    Ok(label.is_some_and(|new| new != held_label)
        || amount_cents.is_some_and(|new| new != held_amount))
}

/// A commitment as the interface sent it.
pub struct CommitmentDraft<'a> {
    /// Who it was agreed with.
    pub person_id: Option<&'a str>,
    /// What it is.
    pub label: &'a str,
    /// How much, whole minor units.
    pub amount_cents: f64,
    /// The day it was agreed.
    pub agreed_on: &'a str,
    /// A document to copy in.
    pub document_path: Option<&'a str>,
    /// A document the work holds.
    pub document_hash: Option<&'a str>,
}

/// What [`commitment_add`] does once the state is in hand.
pub fn commitment_add_with(
    open: &OpenWork,
    stage_id: &str,
    draft: &CommitmentDraft<'_>,
) -> Result<WorkSnapshot> {
    let label = label("A commitment", draft.label)?;
    let amount_cents = validate::amount_cents(draft.amount_cents, false)?;
    let agreed_on = validate::date("A commitment's day", draft.agreed_on)?;
    let document = image(draft.document_path, draft.document_hash)?;
    with_work(open, |state| {
        let mut copy = CopyIn::new(&state.folder);
        let placed = place(&mut copy, &state.folder, &document)?;
        let id = money::add_commitment(
            &state.conn,
            stage_id,
            &CommitmentFields {
                person_id: draft.person_id.map(str::to_string),
                label: label.clone(),
                amount_cents,
                agreed_on: agreed_on.clone(),
                document_hash: placed.as_ref().map(|(hash, _)| hash.clone()),
            },
        )?;
        copy.keep();
        if let Some((hash, copied)) = &placed {
            file_it(
                &state.conn,
                hash,
                copied.as_ref(),
                "quote",
                &today_text(),
                &account::display_name(),
                &DocumentTarget {
                    target_kind: "commitment".into(),
                    target_id: id,
                },
            );
        }
        repo::snapshot(&state.conn)
    })
}

/// What [`commitment_update`] does once the state is in hand.
pub fn commitment_update_with(
    open: &OpenWork,
    id: &str,
    patch: &CommitmentPatch,
) -> Result<WorkSnapshot> {
    let new_label = patch
        .label
        .as_deref()
        .map(|l| label("A commitment", l))
        .transpose()?;
    let amount = patch
        .amount_cents
        .map(|a| validate::amount_cents(a, false))
        .transpose()?;
    let agreed_on = patch
        .agreed_on
        .as_deref()
        .map(|d| validate::date("A commitment's day", d))
        .transpose()?;
    let document = match (&patch.document_path, &patch.document_hash) {
        (None, None) => None,
        (None, Some(None)) => Some(Image::None),
        (path, hash) => Some(image(path.as_deref(), hash.clone().flatten().as_deref())?),
    };
    with_work(open, |state| {
        let mut fields = money::unlocked(&state.conn, id)?;
        let mut copy = CopyIn::new(&state.folder);
        if let Some(person) = &patch.person_id {
            fields.person_id = person.clone();
        }
        if let Some(label) = &new_label {
            fields.label = label.clone();
        }
        if let Some(amount) = amount {
            fields.amount_cents = amount;
        }
        if let Some(day) = &agreed_on {
            fields.agreed_on = day.clone();
        }
        let mut placed = None;
        if let Some(document) = &document {
            placed = place(&mut copy, &state.folder, document)?;
            fields.document_hash = placed.as_ref().map(|(hash, _)| hash.clone());
        }
        money::update_commitment(&state.conn, id, &fields)?;
        copy.keep();
        if let Some((hash, copied)) = &placed {
            file_it(
                &state.conn,
                hash,
                copied.as_ref(),
                "quote",
                &today_text(),
                &account::display_name(),
                &DocumentTarget {
                    target_kind: "commitment".into(),
                    target_id: id.to_string(),
                },
            );
        }
        repo::snapshot(&state.conn)
    })
}

/// What [`payment_add`] does once the state, today and the author are in hand.
pub fn payment_add_with(
    open: &OpenWork,
    draft: &PaymentDraft,
    today: NaiveDate,
    author: &str,
) -> Result<WorkSnapshot> {
    let day = validate::date("A payment's day", &draft.day)?;
    if day > today.format("%Y-%m-%d").to_string() {
        return Err(invalid(format!(
            "{day} has not happened yet: a payment is recorded on the day it was made, or later."
        )));
    }
    let amount_cents = validate::amount_cents(draft.amount_cents, true)?;
    let what_for = ledger_text("What a payment was for", draft.what_for.as_deref())?;
    let receipt = image(draft.receipt_path.as_deref(), draft.receipt_hash.as_deref())?;
    with_work(open, |state| {
        let mut copy = CopyIn::new(&state.folder);
        let placed = place(&mut copy, &state.folder, &receipt)?;
        let seq = payments::append(
            &state.conn,
            &NewPayment {
                day: day.clone(),
                person_id: draft.person_id.clone(),
                stage_id: draft.stage_id.clone(),
                commitment_id: draft.commitment_id.clone(),
                amount_cents,
                what_for: what_for.clone(),
                receipt_hash: placed.as_ref().map(|(hash, _)| hash.clone()),
                author_name: author.to_string(),
            },
        )?;
        copy.keep();
        // The receipt is a document of the work, linked to the payment by its
        // seq (F7).
        if let Some((hash, copied)) = &placed {
            file_it(
                &state.conn,
                hash,
                copied.as_ref(),
                "receipt",
                &today.format("%Y-%m-%d").to_string(),
                author,
                &DocumentTarget {
                    target_kind: "payment".into(),
                    target_id: seq.to_string(),
                },
            );
        }
        repo::snapshot(&state.conn)
    })
}

/// What [`payment_reverse`] does once the state, today and the author are in
/// hand.
pub fn payment_reverse_with(
    open: &OpenWork,
    seq: i64,
    note: &str,
    today: NaiveDate,
    author: &str,
) -> Result<WorkSnapshot> {
    let why = ledger_text("A reversal's reason", Some(note))?
        .ok_or_else(|| invalid("A reversal says why."))?;
    let day = today.format("%Y-%m-%d").to_string();
    change_work(open, |conn| {
        payments::reverse(conn, seq, &why, &day, author).map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plan::{activity_add_with, person_add_with, stage_add_with};
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;
    use crate::db::lock;
    use crate::db::testing::Scratch;
    use crate::files::intake::tests::{hostile_corpus, png};

    const AUTHOR: &str = "A. Owner (synthetic)";

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
    }

    fn payment(stage: &str, amount: f64) -> PaymentDraft {
        serde_json::from_value(serde_json::json!({
            "day": "2026-10-08", "stageId": stage, "amountCents": amount
        }))
        .unwrap()
    }

    fn folder_entries(open: &OpenWork) -> Vec<String> {
        let folder = lock(&open.0).as_ref().unwrap().folder.clone();
        let mut names: Vec<String> = std::fs::read_dir(folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with("work.sqlite3"))
            .collect();
        names.sort();
        names
    }

    /// The e2e's numbers, in the host: planned 2 000.00, committed 1 500.00,
    /// paid 1 000.00 then 1 700.00 (over committed: allowed), reversed back to
    /// 1 000.00.
    #[test]
    fn planned_committed_and_paid_are_written_in_whole_cents_and_a_reversal_undoes_a_payment() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let activity = activity_add_with(&open, &stage, "Lay the floor tile")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let tiler = person_add_with(&open, "A. Tiler").unwrap().people[0]
            .id
            .clone();

        cost_line_add_with(&open, &stage, Some(&activity), "Tiles", Some(120_000.0)).unwrap();
        let plan = cost_line_add_with(&open, &stage, None, "Labour", Some(80_000.0)).unwrap();
        assert_eq!(
            plan.cost_lines
                .iter()
                .filter_map(|c| c.amount_cents)
                .sum::<i64>(),
            200_000
        );

        let plan = commitment_add_with(
            &open,
            &stage,
            &CommitmentDraft {
                person_id: Some(&tiler),
                label: "Tiler's quote",
                amount_cents: 150_000.0,
                agreed_on: "2026-10-01",
                document_path: None,
                document_hash: None,
            },
        )
        .unwrap();
        let quote = plan.commitments[0].id.clone();
        let wire = serde_json::to_value(&plan.commitments[0]).unwrap();
        assert_eq!(wire["amountCents"], 150_000);
        assert_eq!(wire["agreedOn"], "2026-10-01");
        assert_eq!(wire["locked"], false);

        let mut first = payment(&stage, 100_000.0);
        first.person_id = Some(tiler.clone());
        first.commitment_id = Some(quote.clone());
        first.what_for = Some("First half".into());
        payment_add_with(&open, &first, today(), AUTHOR).unwrap();
        let mut second = first.clone();
        second.amount_cents = 70_000.0;
        let plan = payment_add_with(&open, &second, today(), AUTHOR).unwrap();
        assert_eq!(
            plan.payments.iter().map(|p| p.amount_cents).sum::<i64>(),
            170_000
        );
        assert!(
            plan.commitments[0].locked,
            "paid over committed is allowed; the quote is fixed"
        );

        let refused = payment_reverse_with(&open, 2, "   ", today(), AUTHOR).unwrap_err();
        assert_eq!(refused.to_string(), "A reversal says why.");
        let plan = payment_reverse_with(&open, 2, "Paid twice.", today(), AUTHOR).unwrap();
        let reversal = plan.payments.last().unwrap();
        let wire = serde_json::to_value(reversal).unwrap();
        assert_eq!(wire["seq"], 3);
        assert_eq!(wire["amountCents"], -70_000);
        assert_eq!(wire["reversesSeq"], 2);
        assert_eq!(wire["whatFor"], "Paid twice.");
        assert_eq!(wire["day"], "2026-10-09", "reversed today");
        assert_eq!(wire["authorName"], AUTHOR);
        assert_eq!(
            plan.payments.iter().map(|p| p.amount_cents).sum::<i64>(),
            100_000
        );

        let refused = payment_reverse_with(&open, 2, "Again.", today(), AUTHOR).unwrap_err();
        assert_eq!(refused.kind(), "money_reversal");
        work_close_with(&open);
    }

    #[test]
    fn a_payment_of_nothing_a_fraction_of_a_cent_a_future_day_or_no_stage_is_refused() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();

        let mut future = payment(&stage, 100.0);
        future.day = "2026-10-10".into();
        let long = "w".repeat(201);
        for draft in [
            payment(&stage, 0.0),
            payment(&stage, -100.0),
            payment(&stage, 10.5),
            future,
            payment("", 100.0),
            payment(&crate::db::new_id(), 100.0),
            PaymentDraft {
                person_id: Some(crate::db::new_id()),
                ..payment(&stage, 100.0)
            },
            PaymentDraft {
                commitment_id: Some(crate::db::new_id()),
                ..payment(&stage, 100.0)
            },
            PaymentDraft {
                what_for: Some(long.clone()),
                ..payment(&stage, 100.0)
            },
            PaymentDraft {
                receipt_hash: Some("..".into()),
                ..payment(&stage, 100.0)
            },
        ] {
            let refused = payment_add_with(&open, &draft, today(), AUTHOR).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{draft:?}: {refused}");
        }
        for amount in [-1.0, 0.5] {
            assert_eq!(
                cost_line_add_with(&open, &stage, None, "Tiles", Some(amount))
                    .unwrap_err()
                    .kind(),
                "invalid_input"
            );
        }
        cost_line_add_with(&open, &stage, None, "Contingency", Some(0.0))
            .expect("zero is planned too");
        assert!(crate::commands::work::work_get_with(&open)
            .unwrap()
            .payments
            .is_empty());
        work_close_with(&open);
    }

    /// A receipt is an image through the photo pipeline: a hostile file is the
    /// payment refused, nothing written; a good one is copied by hash.
    #[test]
    fn a_receipt_is_copied_in_under_the_caps_and_a_hostile_one_refuses_the_payment() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let source = Scratch::create();
        let (name, bytes, words) = hostile_corpus().remove(1);
        let hostile = source.path().join(name);
        std::fs::write(&hostile, bytes).unwrap();

        let refused = payment_add_with(
            &open,
            &PaymentDraft {
                receipt_path: Some(hostile.to_string_lossy().into_owned()),
                ..payment(&stage, 100_000.0)
            },
            today(),
            AUTHOR,
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "photo_refused");
        assert!(refused.to_string().contains(name) && refused.to_string().contains(words));
        assert!(crate::commands::work::work_get_with(&open)
            .unwrap()
            .payments
            .is_empty());
        assert_eq!(
            folder_entries(&open),
            Vec::<String>::new(),
            "nothing written"
        );

        let receipt = source.path().join("receipt.png");
        let receipt_bytes = png(300, 400);
        std::fs::write(&receipt, &receipt_bytes).unwrap();
        let plan = payment_add_with(
            &open,
            &PaymentDraft {
                receipt_path: Some(receipt.to_string_lossy().into_owned()),
                ..payment(&stage, 100_000.0)
            },
            today(),
            AUTHOR,
        )
        .unwrap();
        let hash = intake::sha256_hex(&receipt_bytes);
        assert_eq!(
            plan.payments[0].receipt_hash.as_deref(),
            Some(hash.as_str())
        );
        assert_eq!(folder_entries(&open), vec!["documents", "thumbnails"]);

        // The same image, as a quote's document, by hash: nothing copied twice.
        let plan = commitment_add_with(
            &open,
            &stage,
            &CommitmentDraft {
                person_id: None,
                label: "Quote",
                amount_cents: 1.0,
                agreed_on: "2026-10-01",
                document_path: None,
                document_hash: Some(&hash),
            },
        )
        .unwrap();
        assert_eq!(
            plan.commitments[0].document_hash.as_deref(),
            Some(hash.as_str())
        );
        work_close_with(&open);
    }

    #[test]
    fn a_commitment_is_patched_until_it_is_paid_against() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let tiler = person_add_with(&open, "A. Tiler").unwrap().people[0]
            .id
            .clone();
        let quote = commitment_add_with(
            &open,
            &stage,
            &CommitmentDraft {
                person_id: None,
                label: "Quote",
                amount_cents: 100.0,
                agreed_on: "2026-10-01",
                document_path: None,
                document_hash: None,
            },
        )
        .unwrap()
        .commitments[0]
            .id
            .clone();

        let patch: CommitmentPatch = serde_json::from_value(serde_json::json!({
            "personId": tiler, "amountCents": 150000, "label": "Tiler's quote"
        }))
        .unwrap();
        let plan = commitment_update_with(&open, &quote, &patch).unwrap();
        let c = &plan.commitments[0];
        assert_eq!(
            (
                c.person_id.as_deref(),
                c.amount_cents,
                c.label.as_str(),
                c.agreed_on.as_str()
            ),
            (Some(tiler.as_str()), 150_000, "Tiler's quote", "2026-10-01")
        );

        let mut paid = payment(&stage, 1.0);
        paid.commitment_id = Some(quote.clone());
        payment_add_with(&open, &paid, today(), AUTHOR).unwrap();
        let refused = commitment_update_with(&open, &quote, &patch).unwrap_err();
        assert_eq!(refused.to_string(), money::COMMITMENT_LOCKED);
        work_close_with(&open);
    }

    #[test]
    fn money_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        assert_eq!(
            payment_reverse_with(&open, 1, "why", today(), AUTHOR)
                .unwrap_err()
                .kind(),
            "no_work_open"
        );
    }
}
