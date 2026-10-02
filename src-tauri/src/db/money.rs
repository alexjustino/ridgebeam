//! Planned and committed money: cost lines and commitments. Paid money — the
//! ledger — is `db::payments`, which holds no statement that edits or removes
//! a row.
//!
//! - A **cost line** is the plan's: an amount on a stage or on one of its
//!   activities, edited freely — except on a closed stage, which is read-only
//!   until it is reopened (`stage_closed`).
//! - A **commitment** is agreed with somebody: editable and removable until a
//!   payment names it; from then on it is part of what was paid against, and
//!   fixed (`invalid_input` with the sentence). A closed stage still takes
//!   commitments: an agreement is closer to a fact than to a plan edit.
//!
//! Amounts are whole minor units of the work's currency, 0 or more. A cost
//! line may have none yet — "not priced yet", which is not 0 (F9: a template's
//! lines are labels).
//!
//! # Changelog of this repository
//!
//! - F6: cost lines and commitments added, changed, removed; the locks that
//!   keep what was paid from disappearing (a paid stage, person or commitment
//!   is not removed).
//! - F9: a cost line's amount may be `None` — added without one, or its price
//!   taken away.
//! - D2: each commitment carries its payment plan (`db::milestones`), by
//!   position; a commitment removed while unpaid takes its plan with it.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::{Commitment, CostLine};
use crate::db::milestones;
use crate::db::payments::COMMITMENT_NOT_FOUND;
use crate::db::work::{
    exists, refuse_if_stage_closed, ACTIVITY_NOT_FOUND, PERSON_NOT_FOUND, STAGE_NOT_FOUND,
};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a cost line id that is not in this work.
pub const COST_LINE_NOT_FOUND: &str = "That cost line is not in this work.";

/// The sentence for a cost line naming an activity of another stage.
pub const ACTIVITY_OF_ANOTHER_STAGE: &str = "That activity is not in that stage.";

/// The sentence for changing a commitment that has been paid against.
pub const COMMITMENT_LOCKED: &str =
    "That commitment has been paid against: it can no longer be changed or removed.";

/// The sentence for removing a stage with payments.
pub const STAGE_HAS_PAYMENTS: &str =
    "That stage has payments, and payments are facts: the stage cannot be removed.";

/// The sentence for removing a person named in the money.
pub const PERSON_IN_THE_MONEY: &str =
    "That person is named in a commitment or a payment: they cannot be removed while the money names them.";

/// Every cost line, by stage position, then as written.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn cost_lines(conn: &Connection) -> Result<Vec<CostLine>> {
    let lines = conn
        .prepare(
            "SELECT c.id, c.stage_id, c.activity_id, c.label, c.amount_cents
             FROM cost_line c JOIN stage s ON s.id = c.stage_id
             ORDER BY s.position, c.created_at, c.id",
        )?
        .query_map([], |row| {
            Ok(CostLine {
                id: row.get(0)?,
                stage_id: row.get(1)?,
                activity_id: row.get(2)?,
                label: row.get(3)?,
                amount_cents: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(lines)
}

/// Every commitment, by stage position, then as agreed; each says whether a
/// payment names it, and carries its payment plan.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn commitments(conn: &Connection) -> Result<Vec<Commitment>> {
    let mut plans = milestones::by_commitment(conn)?;
    let commitments = conn
        .prepare(
            "SELECT c.id, c.stage_id, c.person_id, c.label, c.amount_cents, c.agreed_on,
                    c.document_hash,
                    EXISTS (SELECT 1 FROM payment p WHERE p.commitment_id = c.id)
             FROM commitment c JOIN stage s ON s.id = c.stage_id
             ORDER BY s.position, c.agreed_on, c.created_at, c.id",
        )?
        .query_map([], |row| {
            Ok(Commitment {
                id: row.get(0)?,
                stage_id: row.get(1)?,
                person_id: row.get(2)?,
                label: row.get(3)?,
                amount_cents: row.get(4)?,
                agreed_on: row.get(5)?,
                document_hash: row.get(6)?,
                locked: row.get(7)?,
                milestones: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut commitment: Commitment| {
            commitment.milestones = plans.remove(&commitment.id).unwrap_or_default();
            commitment
        })
        .collect();
    Ok(commitments)
}

/// Add a cost line to a stage, or to one of its activities; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage or an activity not in this work, or an
/// activity of another stage; [`Error::StageClosed`] for a closed stage.
pub fn add_cost_line(
    conn: &Connection,
    stage_id: &str,
    activity_id: Option<&str>,
    label: &str,
    amount_cents: Option<i64>,
) -> Result<String> {
    if !exists(conn, "SELECT 1 FROM stage WHERE id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    if let Some(activity) = activity_id {
        let stage: String = conn
            .query_row(
                "SELECT stage_id FROM activity WHERE id = ?1",
                [activity],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::InvalidInput(ACTIVITY_NOT_FOUND.into()))?;
        if stage != stage_id {
            return Err(Error::InvalidInput(ACTIVITY_OF_ANOTHER_STAGE.into()));
        }
    }
    refuse_if_stage_closed(conn, stage_id)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO cost_line (id, stage_id, activity_id, label, amount_cents, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, stage_id, activity_id, label, amount_cents, now()],
    )?;
    Ok(id)
}

fn cost_line_stage(conn: &Connection, id: &str) -> Result<String> {
    conn.query_row(
        "SELECT stage_id FROM cost_line WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| Error::InvalidInput(COST_LINE_NOT_FOUND.into()))
}

/// Change a cost line's label or amount; `None` leaves a field alone, and
/// `Some(None)` takes the amount away.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a line not in this work; [`Error::StageClosed`]
/// for a line of a closed stage.
pub fn update_cost_line(
    conn: &Connection,
    id: &str,
    label: Option<&str>,
    amount_cents: Option<Option<i64>>,
) -> Result<()> {
    refuse_if_stage_closed(conn, &cost_line_stage(conn, id)?)?;
    let tx = conn.unchecked_transaction()?;
    if let Some(label) = label {
        tx.execute(
            "UPDATE cost_line SET label = ?2 WHERE id = ?1",
            params![id, label],
        )?;
    }
    if let Some(amount_cents) = amount_cents {
        tx.execute(
            "UPDATE cost_line SET amount_cents = ?2 WHERE id = ?1",
            params![id, amount_cents],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Remove a cost line.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a line not in this work; [`Error::StageClosed`]
/// for a line of a closed stage.
pub fn remove_cost_line(conn: &Connection, id: &str) -> Result<()> {
    refuse_if_stage_closed(conn, &cost_line_stage(conn, id)?)?;
    conn.execute("DELETE FROM cost_line WHERE id = ?1", [id])?;
    Ok(())
}

/// A commitment about to be written or changed; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitmentFields {
    /// Who it was agreed with.
    pub person_id: Option<String>,
    /// What it is.
    pub label: String,
    /// How much, minor units.
    pub amount_cents: i64,
    /// The day it was agreed.
    pub agreed_on: String,
    /// The document, by hash.
    pub document_hash: Option<String>,
}

fn refuse_unknown_person(conn: &Connection, person: Option<&str>) -> Result<()> {
    if let Some(person) = person {
        if !exists(conn, "SELECT 1 FROM person WHERE id = ?1", person)? {
            return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
        }
    }
    Ok(())
}

/// Add a commitment to a stage; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage or a person not in this work.
pub fn add_commitment(
    conn: &Connection,
    stage_id: &str,
    fields: &CommitmentFields,
) -> Result<String> {
    if !exists(conn, "SELECT 1 FROM stage WHERE id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    refuse_unknown_person(conn, fields.person_id.as_deref())?;
    let id = new_id();
    conn.execute(
        "INSERT INTO commitment
           (id, stage_id, person_id, label, amount_cents, agreed_on, document_hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            stage_id,
            fields.person_id,
            fields.label,
            fields.amount_cents,
            fields.agreed_on,
            fields.document_hash,
            now()
        ],
    )?;
    Ok(id)
}

/// The commitment as it is, refusing one a payment names.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a commitment not in this work, or one that has
/// been paid against.
pub fn unlocked(conn: &Connection, id: &str) -> Result<CommitmentFields> {
    let fields = conn
        .query_row(
            "SELECT person_id, label, amount_cents, agreed_on, document_hash
             FROM commitment WHERE id = ?1",
            [id],
            |row| {
                Ok(CommitmentFields {
                    person_id: row.get(0)?,
                    label: row.get(1)?,
                    amount_cents: row.get(2)?,
                    agreed_on: row.get(3)?,
                    document_hash: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(COMMITMENT_NOT_FOUND.into()))?;
    if exists(conn, "SELECT 1 FROM payment WHERE commitment_id = ?1", id)? {
        return Err(Error::InvalidInput(COMMITMENT_LOCKED.into()));
    }
    Ok(fields)
}

/// Write a commitment's fields whole, while nothing is paid against it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a commitment not in this work, one that has
/// been paid against, or a person not in this work.
pub fn update_commitment(conn: &Connection, id: &str, fields: &CommitmentFields) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    unlocked(&tx, id)?;
    refuse_unknown_person(&tx, fields.person_id.as_deref())?;
    tx.execute(
        "UPDATE commitment SET person_id = ?2, label = ?3, amount_cents = ?4, agreed_on = ?5,
                               document_hash = ?6
         WHERE id = ?1",
        params![
            id,
            fields.person_id,
            fields.label,
            fields.amount_cents,
            fields.agreed_on,
            fields.document_hash
        ],
    )?;
    tx.commit()?;
    Ok(())
}

/// Remove a commitment nothing has been paid against.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a commitment not in this work, or one that has
/// been paid against.
pub fn remove_commitment(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    unlocked(&tx, id)?;
    tx.execute("DELETE FROM commitment WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Refuse removing a stage the ledger names. Called by
/// `db::work::remove_stage` inside its transaction.
///
/// # Errors
///
/// [`Error::InvalidInput`] when a payment names the stage.
pub fn refuse_if_stage_paid(conn: &Connection, stage_id: &str) -> Result<()> {
    if exists(conn, "SELECT 1 FROM payment WHERE stage_id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_HAS_PAYMENTS.into()));
    }
    Ok(())
}

/// Refuse removing a person a commitment or a payment names. Called by
/// `db::work::remove_person`.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the money names the person.
pub fn refuse_if_person_in_the_money(conn: &Connection, person_id: &str) -> Result<()> {
    if exists(
        conn,
        "SELECT 1 FROM commitment WHERE person_id = ?1
         UNION ALL SELECT 1 FROM payment WHERE person_id = ?1",
        person_id,
    )? {
        return Err(Error::InvalidInput(PERSON_IN_THE_MONEY.into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::payments::{self, NewPayment};
    use crate::db::work::tests::a_work;
    use crate::db::work::{
        add_activity, add_person, add_stage, remove_person, remove_stage, snapshot,
    };

    struct Money {
        conn: Connection,
        stage: String,
        activity: String,
        tiler: String,
        quote: String,
    }

    fn money() -> Money {
        let conn = a_work();
        let stage = add_stage(&conn, "Tiling").unwrap();
        let activity = add_activity(&conn, &stage, "Lay the floor tile").unwrap();
        let tiler = add_person(&conn, "A. Tiler").unwrap();
        let quote = add_commitment(
            &conn,
            &stage,
            &CommitmentFields {
                person_id: Some(tiler.clone()),
                label: "Tiler's quote".into(),
                amount_cents: 150_000,
                agreed_on: "2026-10-01".into(),
                document_hash: None,
            },
        )
        .unwrap();
        Money {
            conn,
            stage,
            activity,
            tiler,
            quote,
        }
    }

    fn pay(m: &Money, amount_cents: i64, commitment: bool) -> i64 {
        payments::append(
            &m.conn,
            &NewPayment {
                day: "2026-10-05".into(),
                person_id: Some(m.tiler.clone()),
                stage_id: m.stage.clone(),
                commitment_id: commitment.then(|| m.quote.clone()),
                amount_cents,
                what_for: Some("First half".into()),
                receipt_hash: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn cost_lines_sit_on_a_stage_or_its_activity_and_are_changed_and_removed() {
        let m = money();
        let tiles =
            add_cost_line(&m.conn, &m.stage, Some(&m.activity), "Tiles", Some(120_000)).unwrap();
        let labour = add_cost_line(&m.conn, &m.stage, None, "Labour", Some(80_000)).unwrap();

        update_cost_line(&m.conn, &labour, None, Some(Some(85_000))).unwrap();
        let lines = snapshot(&m.conn).unwrap().cost_lines;
        let wire = serde_json::to_value(&lines).unwrap();
        assert_eq!(wire[0]["activityId"], m.activity.as_str());
        assert_eq!(wire[0]["amountCents"], 120_000);
        assert_eq!(wire[1]["activityId"], serde_json::Value::Null);
        assert_eq!(wire[1]["amountCents"], 85_000);

        remove_cost_line(&m.conn, &tiles).unwrap();
        assert_eq!(snapshot(&m.conn).unwrap().cost_lines.len(), 1);

        let other = add_stage(&m.conn, "Painting").unwrap();
        assert_eq!(
            add_cost_line(&m.conn, &other, Some(&m.activity), "Tiles", Some(1))
                .unwrap_err()
                .to_string(),
            ACTIVITY_OF_ANOTHER_STAGE
        );
    }

    #[test]
    fn a_cost_line_on_a_closed_stage_is_refused_and_a_payment_is_not() {
        let m = money();
        let line = add_cost_line(&m.conn, &m.stage, None, "Labour", Some(80_000)).unwrap();
        crate::db::checks::start(&m.conn, &m.stage).unwrap();
        crate::db::checks::close(&m.conn, &m.stage).unwrap();

        for refused in [
            add_cost_line(&m.conn, &m.stage, None, "Late", Some(1)).map(|_| ()),
            update_cost_line(&m.conn, &line, Some("X"), None),
            remove_cost_line(&m.conn, &line),
        ] {
            assert_eq!(refused.unwrap_err().kind(), "stage_closed");
        }
        assert_eq!(
            pay(&m, 50_000, true),
            1,
            "money paid is a fact, closed stage or not"
        );
    }

    #[test]
    fn a_commitment_is_changed_while_nothing_is_paid_and_fixed_from_the_first_payment() {
        let m = money();
        let mut fields = unlocked(&m.conn, &m.quote).unwrap();
        fields.amount_cents = 160_000;
        update_commitment(&m.conn, &m.quote, &fields).unwrap();
        assert!(!snapshot(&m.conn).unwrap().commitments[0].locked);

        pay(&m, 100_000, true);

        let commitment = &snapshot(&m.conn).unwrap().commitments[0];
        assert!(commitment.locked);
        assert_eq!(commitment.amount_cents, 160_000);
        for refused in [
            update_commitment(&m.conn, &m.quote, &fields),
            remove_commitment(&m.conn, &m.quote),
        ] {
            let error = refused.unwrap_err();
            assert_eq!(error.kind(), "invalid_input");
            assert_eq!(error.to_string(), COMMITMENT_LOCKED);
        }
    }

    #[test]
    fn a_paid_stage_or_a_person_in_the_money_is_not_removed() {
        let m = money();
        assert_eq!(
            remove_person(&m.conn, &m.tiler).unwrap_err().to_string(),
            PERSON_IN_THE_MONEY,
            "named by a commitment"
        );
        pay(&m, 10_000, false);
        assert_eq!(
            remove_stage(&m.conn, &m.stage).unwrap_err().to_string(),
            STAGE_HAS_PAYMENTS
        );

        let unpaid = add_stage(&m.conn, "Painting").unwrap();
        add_commitment(
            &m.conn,
            &unpaid,
            &CommitmentFields {
                person_id: None,
                label: "Painter's quote".into(),
                amount_cents: 1,
                agreed_on: "2026-10-01".into(),
                document_hash: None,
            },
        )
        .unwrap();
        remove_stage(&m.conn, &unpaid).expect("nothing paid: the commitment goes with the stage");
        assert_eq!(snapshot(&m.conn).unwrap().commitments.len(), 1);
    }

    #[test]
    fn a_payment_against_a_commitment_of_another_stage_is_refused() {
        let m = money();
        let other = add_stage(&m.conn, "Painting").unwrap();
        let refused = payments::append(
            &m.conn,
            &NewPayment {
                day: "2026-10-05".into(),
                person_id: None,
                stage_id: other,
                commitment_id: Some(m.quote.clone()),
                amount_cents: 1,
                what_for: None,
                receipt_hash: None,
                author_name: "x".into(),
            },
        )
        .unwrap_err();
        assert_eq!(refused.to_string(), payments::COMMITMENT_OF_ANOTHER_STAGE);
    }

    #[test]
    fn a_payment_is_reversed_once_in_full_and_a_reversal_is_never_reversed() {
        let m = money();
        pay(&m, 100_000, true);
        let second = pay(&m, 70_000, true);

        let reversal =
            payments::reverse(&m.conn, second, "Paid twice by mistake.", "2026-10-06", "x")
                .unwrap();

        let ledger = snapshot(&m.conn).unwrap().payments;
        let r = ledger.iter().find(|p| p.seq == reversal).unwrap();
        assert_eq!(
            (r.amount_cents, r.reverses_seq, r.what_for.as_deref()),
            (-70_000, Some(second), Some("Paid twice by mistake."))
        );
        assert_eq!(
            r.commitment_id.as_deref(),
            Some(m.quote.as_str()),
            "the same commitment"
        );
        assert_eq!(ledger.iter().map(|p| p.amount_cents).sum::<i64>(), 100_000);

        for (seq, sentence) in [
            (
                second,
                format!("Payment #{second} has already been reversed by #{reversal}."),
            ),
            (
                reversal,
                format!("Payment #{reversal} is itself a reversal; it cannot be reversed."),
            ),
            (99, "There is no payment #99 to reverse.".to_string()),
        ] {
            let refused = payments::reverse(&m.conn, seq, "Again.", "2026-10-06", "x").unwrap_err();
            assert_eq!(refused.kind(), "money_reversal");
            assert_eq!(refused.to_string(), sentence);
        }
    }

    fn insert_payment(
        conn: &Connection,
        seq: i64,
        amount: i64,
        reverses: Option<i64>,
        stage: &str,
    ) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO payment (id, seq, day, stage_id, amount_cents, what_for, reverses_seq,
                                  author_name, created_at)
             VALUES (?1, ?2, '2026-10-05', ?3, ?4, 'why', ?5, 'x', 't')",
            params![new_id(), seq, stage, amount, reverses],
        )
    }

    /// The reversal rules are the schema's as well as the host's.
    #[test]
    fn the_schema_refuses_a_reversal_that_exceeds_repeats_or_is_positive() {
        let m = money();
        insert_payment(&m.conn, 1, 50_000, None, &m.stage).unwrap();
        let other = add_stage(&m.conn, "Painting").unwrap();

        for (case, amount, reverses, stage) in [
            ("larger than the original", -50_001, Some(1), &m.stage),
            ("positive, naming a payment", 100, Some(1), &m.stage),
            ("negative, naming nothing", -100, None, &m.stage),
            ("of a payment that is not there", -100, Some(7), &m.stage),
            ("for another stage", -100, Some(1), &other),
        ] {
            assert!(
                insert_payment(&m.conn, 2, amount, reverses, stage).is_err(),
                "{case}"
            );
        }
        insert_payment(&m.conn, 2, -20_000, Some(1), &m.stage).expect("a partial reversal fits");
        let refused = insert_payment(&m.conn, 3, -10_000, Some(1), &m.stage).unwrap_err();
        assert!(
            refused.to_string().contains("money: reversal"),
            "a second reversal: {refused}"
        );
        let refused = insert_payment(&m.conn, 3, -1, Some(2), &m.stage).unwrap_err();
        assert!(
            refused.to_string().contains("money: reversal"),
            "a reversal of a reversal"
        );
        assert!(
            insert_payment(&m.conn, 3, 0, None, &m.stage).is_err(),
            "nothing paid"
        );
    }

    /// Every way SQL can rewrite the ledger, with `recursive_triggers` on and off.
    #[test]
    fn every_update_delete_replace_and_upsert_on_the_ledger_is_refused_whatever_the_pragmas() {
        let m = money();
        pay(&m, 100_000, true);
        pay(&m, 70_000, false);
        let before = snapshot(&m.conn).unwrap().payments;
        let first = before[0].id.clone();
        let other = new_id();
        let stage = &m.stage;

        let attacks = [
            "UPDATE payment SET amount_cents = 1".to_string(),
            "UPDATE payment SET day = '2026-01-01' WHERE seq = 1".to_string(),
            "UPDATE OR REPLACE payment SET seq = 1 WHERE seq = 2".to_string(),
            "DELETE FROM payment".to_string(),
            "DELETE FROM payment WHERE seq = 2".to_string(),
            format!(
                "INSERT OR REPLACE INTO payment (id, seq, day, stage_id, amount_cents, author_name, created_at)
                 VALUES ('{first}', 1, '2026-10-05', '{stage}', 1, 'x', 't')"
            ),
            format!(
                "REPLACE INTO payment (id, seq, day, stage_id, amount_cents, author_name, created_at)
                 VALUES ('{other}', 2, '2026-10-05', '{stage}', 1, 'x', 't')"
            ),
            format!(
                "INSERT INTO payment (id, seq, day, stage_id, amount_cents, author_name, created_at)
                 VALUES ('{first}', 1, '2026-10-05', '{stage}', 1, 'x', 't')
                 ON CONFLICT (id) DO UPDATE SET amount_cents = 1"
            ),
            format!(
                "INSERT INTO payment (id, seq, day, stage_id, amount_cents, author_name, created_at)
                 VALUES ('{other}', 9, '2026-10-05', '{stage}', 1, 'x', 't')"
            ),
        ];
        for recursive in ["ON", "OFF"] {
            m.conn
                .pragma_update(None, "recursive_triggers", recursive)
                .unwrap();
            for attack in &attacks {
                let refused = m
                    .conn
                    .execute(attack, [])
                    .expect_err(&format!("recursive_triggers {recursive}: {attack}"));
                assert!(
                    refused.to_string().contains("money: append-only"),
                    "recursive_triggers {recursive}: `{attack}` refused for the wrong reason: {refused}"
                );
            }
        }
        assert_eq!(snapshot(&m.conn).unwrap().payments, before);
    }

    /// The rule in `db::payments`' header, checked against its source.
    #[test]
    fn the_module_that_writes_the_ledger_holds_no_update_delete_or_replace() {
        let source = include_str!("payments.rs");
        let forbidden = ["update", "delete", "replace"];
        let offending: Vec<(usize, &str)> = source
            .lines()
            .enumerate()
            .filter(|(_, line)| !line.trim_start().starts_with("//"))
            .filter(|(_, line)| {
                line.split(|c: char| !c.is_ascii_alphanumeric())
                    .any(|word| forbidden.contains(&word.to_ascii_lowercase().as_str()))
            })
            .map(|(number, line)| (number + 1, line))
            .collect();
        assert!(
            offending.is_empty(),
            "db/payments.rs must write by INSERT only: {offending:?}"
        );
        assert!(source.contains("INSERT INTO payment"));
    }
}
