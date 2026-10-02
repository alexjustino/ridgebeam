//! Change orders (E1): nothing changes without a price and a date.
//!
//! After the plan is approved, a change somebody asks for is raised on record
//! — who asked, the stage it lands in, what it costs, what it does to the plan
//! — and decided once: approved, declined or withdrawn. Before approval there
//! are none: the plan is still being written, and is changed freely.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the ledger's writer, for the same reason: a change order and
//! its decision are facts. A mistake is withdrawn and raised again, and the
//! record keeps both. A test (`db::change_orders_tests`) reads this file's
//! source and fails if a line of code in it names any of those three words;
//! the schema refuses them again with triggers (work migration 013).
//!
//! An approval writes the change into the plan, in one transaction with its
//! decision: it opens a replanning with the reason `Change order #N — title`,
//! or joins the one open (whose reason is not rewritten); it writes the effects
//! through the plan's own functions (`db::change_effects`); and when the
//! change is priced at 0 or more it adds a cost line on its stage, labelled
//! `Change order #N`. Any refusal writes nothing. The person then reviews the
//! plan and takes the next baseline, as always. A saving — a negative amount —
//! adds no line: a planned amount is never negative, so the plan's own lines
//! are lowered by hand in the same replanning, and the decision keeps the
//! amount.
//!
//! What the change does to the finish is not computed here: the domain
//! computes it from the schedule, the interface sends it with the decision,
//! and the decision keeps it as the fact of that moment.
//!
//! # Changelog of this repository
//!
//! - E1: `raise`, `decide`, `list`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::{ChangeEffect, ChangeOrder, ChangeOrderDecision};
use crate::db::work::{exists, refuse_if_stage_closed, PERSON_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{change_effects, money, new_id, now, replanning};
use crate::error::{Error, Result};

/// The sentence for a change order raised before the plan is approved.
pub const NOT_APPROVED_YET: &str =
    "The plan is not approved yet, so there is no change order to raise: change the plan freely.";

/// The sentence for a change order id that is not in this work.
pub const CHANGE_ORDER_NOT_FOUND: &str = "That change order is not in this work.";

/// Who asked for a change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AskedBy {
    /// The owner.
    Owner,
    /// A person of the plan, by id.
    Person(String),
    /// Somebody else, by name.
    Other(String),
}

/// A change order about to be raised; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewChangeOrder {
    /// `YYYY-MM-DD`, not after today.
    pub raised_on: String,
    /// 1 to 200 characters.
    pub title: String,
    /// Up to 2000 characters.
    pub description: Option<String>,
    /// Who asked.
    pub asked_by: AskedBy,
    /// The stage it lands in.
    pub stage_id: String,
    /// Signed whole minor units; `None` when not priced.
    pub cost_cents: Option<i64>,
    /// What it does to the plan, at most 50.
    pub effects: Vec<ChangeEffect>,
    /// The account that raised it.
    pub author_name: String,
}

/// How a change order is decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Written into the plan, inside a replanning.
    Approved,
    /// Not wanted.
    Declined,
    /// Taken back by whoever asked — or raised by mistake.
    Withdrawn,
}

impl Outcome {
    /// The word the file and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Approved => "approved",
            Outcome::Declined => "declined",
            Outcome::Withdrawn => "withdrawn",
        }
    }
}

/// A decision about to be recorded; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDecision {
    /// The change order.
    pub change_order_id: String,
    /// How it is decided.
    pub outcome: Outcome,
    /// `YYYY-MM-DD`, not after today.
    pub decided_on: String,
    /// Why, up to 2000 characters.
    pub note: Option<String>,
    /// The finish before the change, as the schedule says it now.
    pub finish_before: Option<String>,
    /// The finish with the change.
    pub finish_after: Option<String>,
    /// The working days between them, signed.
    pub days_delta: Option<i64>,
    /// The account that decides it.
    pub author_name: String,
}

/// The reason of the replanning an approval opens.
pub fn replanning_reason(number: i64, title: &str) -> String {
    format!("Change order #{number} — {title}")
}

/// The label of the cost line an approval adds.
pub fn cost_line_label(number: i64) -> String {
    format!("Change order #{number}")
}

/// The sentence for a change order decided a second time.
pub fn already_decided(number: i64, outcome: &str, day: &str) -> String {
    format!(
        "Change order #{number} was already {outcome} on {day}: a change order is decided once."
    )
}

/// The sentence for a decision dated before the change was raised.
pub fn decided_before_raised(number: i64, raised_on: &str) -> String {
    format!(
        "Change order #{number} was raised on {raised_on}: it cannot be decided before that day."
    )
}

/// Raise a change order; returns its number.
///
/// # Errors
///
/// [`Error::InvalidInput`] before the plan is approved ([`NOT_APPROVED_YET`]),
/// for a stage or a person not in this work, or an effect `change_effects`
/// refuses; [`Error::StageClosed`] for a closed stage, or a target in one;
/// [`Error::Database`] when the row cannot be written.
pub fn raise(conn: &Connection, new: &NewChangeOrder) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    if !replanning::approved(&tx)? {
        return Err(Error::InvalidInput(NOT_APPROVED_YET.into()));
    }
    if !exists(&tx, "SELECT 1 FROM stage WHERE id = ?1", &new.stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    refuse_if_stage_closed(&tx, &new.stage_id)?;
    let (asked_by, person, name) = match &new.asked_by {
        AskedBy::Owner => ("owner", None, None),
        AskedBy::Person(id) => {
            if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", id)? {
                return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
            }
            ("person", Some(id.as_str()), None)
        }
        AskedBy::Other(name) => ("other", None, Some(name.as_str())),
    };
    change_effects::check(&tx, &new.effects)?;
    let effects = serde_json::to_string(&new.effects)
        .map_err(|_| Error::InvalidInput("The effects of a change could not be kept.".into()))?;

    let number: i64 = tx.query_row(
        "SELECT coalesce(max(number), 0) + 1 FROM change_order",
        [],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO change_order
           (id, number, raised_on, title, description, asked_by, asked_by_person_id,
            asked_by_name, stage_id, cost_cents, effects, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            new_id(),
            number,
            new.raised_on,
            new.title,
            new.description,
            asked_by,
            person,
            name,
            new.stage_id,
            new.cost_cents,
            effects,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!(
        "change order #{number} was raised with {} effects",
        new.effects.len()
    );
    Ok(number)
}

/// What a decision needs to know of the change it decides.
struct Raised {
    number: i64,
    title: String,
    raised_on: String,
    stage_id: String,
    cost_cents: Option<i64>,
    effects: Vec<ChangeEffect>,
}

/// Decide a change order, once. An approval writes the change into the plan
/// inside a replanning, in the same transaction; a decline or a withdrawal
/// writes the decision alone.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a change order not in this work, one already
/// decided, or a day before it was raised; for an approval, the refusals of
/// the plan's own functions as each effect is written (an activity no longer
/// in the work, a duration outside its range, an activity a milestone is
/// earned by), [`Error::StageClosed`] and [`Error::DependencyCycle`]. Nothing
/// is written on any of them.
pub fn decide(conn: &Connection, new: &NewDecision) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let raised = raised(&tx, &new.change_order_id)?;
    let decided: Option<(String, String)> = tx
        .query_row(
            "SELECT outcome, decided_on FROM change_order_decision WHERE change_order_id = ?1",
            [&new.change_order_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((outcome, day)) = decided {
        return Err(Error::InvalidInput(already_decided(
            raised.number,
            &outcome,
            &day,
        )));
    }
    if new.decided_on < raised.raised_on {
        return Err(Error::InvalidInput(decided_before_raised(
            raised.number,
            &raised.raised_on,
        )));
    }

    let replanning_id = if new.outcome == Outcome::Approved {
        if !replanning::approved(&tx)? {
            return Err(Error::InvalidInput(NOT_APPROVED_YET.into()));
        }
        let replanning_id = match replanning::current(&tx)? {
            Some(open) => open.id,
            None => replanning::open_within(
                &tx,
                &replanning_reason(raised.number, &raised.title),
                &new.author_name,
            )?,
        };
        change_effects::apply(&tx, &raised.stage_id, &raised.effects)?;
        if let Some(amount) = raised.cost_cents.filter(|amount| *amount >= 0) {
            money::add_cost_line(
                &tx,
                &raised.stage_id,
                None,
                &cost_line_label(raised.number),
                Some(amount),
            )?;
        }
        Some(replanning_id)
    } else {
        None
    };

    tx.execute(
        "INSERT INTO change_order_decision
           (change_order_id, outcome, decided_on, note, finish_before, finish_after, days_delta,
            cost_cents, replanning_id, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            new.change_order_id,
            new.outcome.as_str(),
            new.decided_on,
            new.note,
            new.finish_before,
            new.finish_after,
            new.days_delta,
            raised.cost_cents,
            replanning_id,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!(
        "change order #{} was {}",
        raised.number,
        new.outcome.as_str()
    );
    Ok(())
}

fn raised(conn: &Connection, id: &str) -> Result<Raised> {
    let row = conn
        .query_row(
            "SELECT number, title, raised_on, stage_id, cost_cents, effects
             FROM change_order WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(CHANGE_ORDER_NOT_FOUND.into()))?;
    let (number, title, raised_on, stage_id, cost_cents, effects) = row;
    Ok(Raised {
        number,
        title,
        raised_on,
        stage_id,
        cost_cents,
        effects: effects_from(&effects, 5)?,
    })
}

/// The effects column read back into its shape; a column that is not one is
/// a database error, as any other value the schema should have refused.
fn effects_from(text: &str, column: usize) -> rusqlite::Result<Vec<ChangeEffect>> {
    serde_json::from_str(text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

/// Every change order, by number, each with its decision or `None`.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read, or an effects column does
/// not hold effects.
pub fn list(conn: &Connection) -> Result<Vec<ChangeOrder>> {
    let orders = conn
        .prepare(
            "SELECT c.id, c.number, c.raised_on, c.title, c.description, c.asked_by,
                    c.asked_by_person_id, c.asked_by_name, c.stage_id, c.cost_cents, c.effects,
                    c.author_name, c.created_at,
                    d.outcome, d.decided_on, d.note, d.finish_before, d.finish_after,
                    d.days_delta, d.cost_cents, d.replanning_id, d.author_name, d.created_at
             FROM change_order c
             LEFT JOIN change_order_decision d ON d.change_order_id = c.id
             ORDER BY c.number",
        )?
        .query_map([], |row| {
            let outcome: Option<String> = row.get(13)?;
            let decision = match outcome {
                None => None,
                Some(outcome) => Some(ChangeOrderDecision {
                    outcome,
                    decided_on: row.get(14)?,
                    note: row.get(15)?,
                    finish_before: row.get(16)?,
                    finish_after: row.get(17)?,
                    days_delta: row.get(18)?,
                    cost_cents: row.get(19)?,
                    replanning_id: row.get(20)?,
                    author_name: row.get(21)?,
                    created_at: row.get(22)?,
                }),
            };
            Ok(ChangeOrder {
                id: row.get(0)?,
                number: row.get(1)?,
                raised_on: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                asked_by: row.get(5)?,
                asked_by_person_id: row.get(6)?,
                asked_by_name: row.get(7)?,
                stage_id: row.get(8)?,
                cost_cents: row.get(9)?,
                effects: effects_from(&row.get::<_, String>(10)?, 10)?,
                author_name: row.get(11)?,
                created_at: row.get(12)?,
                decision,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(orders)
}
