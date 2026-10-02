//! Funding (E2): where the money comes from — the funds the work expects,
//! each on a day. The money that actually arrived is `db::funding_receipts`,
//! which holds no statement that edits or removes a row.
//!
//! A fund is plan, not fact: it is added, written whole and removed at any
//! time, approved plan or not — funding is not the plan's scope. The one lock
//! is the ledger's: a fund a receipt names is not removed (`invalid_input`
//! with the sentence), since money received is a fact and keeps what it was
//! received against. It can still be changed — a tranche revised is still
//! the same tranche.
//!
//! The funds are one sequence for the work, 1..n ([`FUNDING`]): a new one is
//! added at the end, and a removal closes the gap it leaves.
//!
//! # Changelog of this repository
//!
//! - E2: funds listed, added, written whole and removed; the lock that keeps
//!   a fund a receipt names; work migration 014.

use rusqlite::{params, Connection};

use crate::contract::Funding;
use crate::db::order::FUNDING;
use crate::db::work::{exists, found};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a fund id that is not in this work.
pub const FUNDING_NOT_FOUND: &str = "That fund is not in this work.";

/// The sentence for removing a fund a receipt names.
pub const FUNDING_RECEIVED: &str =
    "Money has been received against that fund, and money received is a fact: the fund cannot be removed.";

/// A fund about to be written; every field already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FundingFields {
    /// What it is.
    pub label: String,
    /// Where it comes from.
    pub source: Option<String>,
    /// How much, minor units, more than 0.
    pub amount_cents: i64,
    /// The day it is expected.
    pub expected_on: String,
    /// More words.
    pub note: Option<String>,
}

/// Every fund, by position.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Funding>> {
    let funds = conn
        .prepare(
            "SELECT id, position, label, source, amount_cents, expected_on, note
             FROM funding ORDER BY position",
        )?
        .query_map([], |row| {
            Ok(Funding {
                id: row.get(0)?,
                position: row.get(1)?,
                label: row.get(2)?,
                source: row.get(3)?,
                amount_cents: row.get(4)?,
                expected_on: row.get(5)?,
                note: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(funds)
}

/// Add a fund at the end; returns its id.
///
/// # Errors
///
/// [`Error::Database`] when the row cannot be written.
pub fn add(conn: &Connection, fields: &FundingFields) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO funding
           (id, position, label, source, amount_cents, expected_on, note, created_at)
         VALUES (?1, (SELECT coalesce(max(position), 0) + 1 FROM funding),
                 ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            fields.label,
            fields.source,
            fields.amount_cents,
            fields.expected_on,
            fields.note,
            now()
        ],
    )?;
    Ok(id)
}

/// Write a fund's fields whole — received against or not.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a fund not in this work.
pub fn update(conn: &Connection, id: &str, fields: &FundingFields) -> Result<()> {
    let changed = conn.execute(
        "UPDATE funding SET label = ?2, source = ?3, amount_cents = ?4, expected_on = ?5,
                            note = ?6
         WHERE id = ?1",
        params![
            id,
            fields.label,
            fields.source,
            fields.amount_cents,
            fields.expected_on,
            fields.note
        ],
    )?;
    found(changed, FUNDING_NOT_FOUND)
}

/// Remove a fund no receipt names, and close the gap it leaves.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a fund not in this work, or one a receipt
/// names.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM funding WHERE id = ?1", id)? {
        return Err(Error::InvalidInput(FUNDING_NOT_FOUND.into()));
    }
    if exists(
        &tx,
        "SELECT 1 FROM funding_receipt WHERE funding_id = ?1",
        id,
    )? {
        return Err(Error::InvalidInput(FUNDING_RECEIVED.into()));
    }
    tx.execute("DELETE FROM funding WHERE id = ?1", [id])?;
    FUNDING.close_gaps(&tx, None)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::funding_receipts::{self, NewReceipt};
    use crate::db::work::snapshot;
    use crate::db::work::tests::a_work;

    fn fields(label: &str, amount_cents: i64, expected_on: &str) -> FundingFields {
        FundingFields {
            label: label.into(),
            source: None,
            amount_cents,
            expected_on: expected_on.into(),
            note: None,
        }
    }

    fn receive(conn: &Connection, funding: Option<&str>, amount_cents: i64, day: &str) -> i64 {
        funding_receipts::append(
            conn,
            &NewReceipt {
                day: day.into(),
                funding_id: funding.map(str::to_string),
                amount_cents,
                note: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap()
    }

    /// Two funds and a receipt against the first.
    struct Funded {
        conn: Connection,
        savings: String,
        tranche: String,
    }

    fn funded() -> Funded {
        let conn = a_work();
        let savings = add(&conn, &fields("Savings", 2_000_000, "2026-10-01")).unwrap();
        let tranche = add(
            &conn,
            &fields("Loan, first tranche", 5_000_000, "2026-11-02"),
        )
        .unwrap();
        receive(&conn, Some(&savings), 2_000_000, "2026-10-01");
        Funded {
            conn,
            savings,
            tranche,
        }
    }

    #[test]
    fn funds_are_listed_by_position_written_whole_and_removed_closing_the_gap() {
        let conn = a_work();
        let first = add(&conn, &fields("Savings", 100, "2026-10-01")).unwrap();
        let second = add(&conn, &fields("Tranche 1", 200, "2026-11-01")).unwrap();
        let third = add(&conn, &fields("Tranche 2", 300, "2026-12-01")).unwrap();

        update(
            &conn,
            &second,
            &FundingFields {
                label: "Loan, tranche 1".into(),
                source: Some("The bank".into()),
                amount_cents: 250,
                expected_on: "2026-11-09".into(),
                note: Some("Released after the slab.".into()),
            },
        )
        .unwrap();
        let wire = serde_json::to_value(snapshot(&conn).unwrap().funding).unwrap();
        assert_eq!(
            wire[1],
            serde_json::json!({
                "id": second, "position": 2, "label": "Loan, tranche 1", "source": "The bank",
                "amountCents": 250, "expectedOn": "2026-11-09",
                "note": "Released after the slab."
            })
        );
        assert_eq!(
            wire[0]["source"],
            serde_json::Value::Null,
            "null, not absent"
        );
        assert_eq!(wire[0]["note"], serde_json::Value::Null);

        remove(&conn, &first).unwrap();
        let plan = snapshot(&conn).unwrap();
        let order: Vec<_> = plan
            .funding
            .iter()
            .map(|f| (f.position, f.id.clone()))
            .collect();
        assert_eq!(order, vec![(1, second), (2, third)]);

        let nobody = crate::db::new_id();
        for refused in [
            update(&conn, &nobody, &fields("X", 1, "2026-10-01")),
            remove(&conn, &nobody),
        ] {
            assert_eq!(refused.unwrap_err().to_string(), FUNDING_NOT_FOUND);
        }
    }

    #[test]
    fn a_fund_a_receipt_names_is_changed_but_never_removed() {
        let f = funded();
        update(
            &f.conn,
            &f.savings,
            &fields("Savings on hand", 2_100_000, "2026-10-01"),
        )
        .expect("still plan: it can be changed");
        let refused = remove(&f.conn, &f.savings).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), FUNDING_RECEIVED);

        let refused = f
            .conn
            .execute("DELETE FROM funding WHERE id = ?1", [&f.savings])
            .unwrap_err();
        assert!(
            refused.to_string().contains("FOREIGN KEY"),
            "the schema refuses it again: {refused}"
        );

        // Reversed in full, the receipt still names the fund: still a fact.
        funding_receipts::reverse(&f.conn, 1, "2026-10-02", "x").unwrap();
        assert_eq!(
            remove(&f.conn, &f.savings).unwrap_err().to_string(),
            FUNDING_RECEIVED
        );
        remove(&f.conn, &f.tranche).expect("nothing received against it");
        assert_eq!(snapshot(&f.conn).unwrap().funding.len(), 1);
    }

    #[test]
    fn a_receipt_names_a_fund_of_this_work_or_none() {
        let f = funded();
        let unplanned = receive(&f.conn, None, 50_000, "2026-10-03");
        assert_eq!(unplanned, 2, "one sequence, continuing");
        let refused = funding_receipts::append(
            &f.conn,
            &NewReceipt {
                day: "2026-10-03".into(),
                funding_id: Some(crate::db::new_id()),
                amount_cents: 1,
                note: None,
                author_name: "x".into(),
            },
        )
        .unwrap_err();
        assert_eq!(refused.to_string(), FUNDING_NOT_FOUND);

        let ledger = snapshot(&f.conn).unwrap().funding_receipts;
        let wire = serde_json::to_value(&ledger).unwrap();
        assert_eq!(wire[0]["fundingId"], f.savings.as_str());
        assert_eq!(wire[1]["fundingId"], serde_json::Value::Null);
        assert_eq!(wire[1]["reversesSeq"], serde_json::Value::Null);
        assert_eq!(wire[1]["note"], serde_json::Value::Null);
        assert_eq!(wire[1]["authorName"], "Synthetic author");
        assert_eq!(ledger.len(), 2);
    }

    #[test]
    fn a_receipt_is_reversed_once_in_full_on_or_after_its_day_and_a_reversal_is_never_reversed() {
        let f = funded();
        receive(&f.conn, Some(&f.tranche), 1_500_000, "2026-10-05");

        let refused = funding_receipts::reverse(&f.conn, 2, "2026-10-04", "x").unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "Receipt #2 arrived on 2026-10-05: it is reversed on that day or later."
        );

        let reversal = funding_receipts::reverse(&f.conn, 2, "2026-10-05", "x").unwrap();
        assert_eq!(reversal, 3);
        let ledger = snapshot(&f.conn).unwrap().funding_receipts;
        let r = &ledger[2];
        assert_eq!(
            (
                r.amount_cents,
                r.reverses_seq,
                r.funding_id.as_deref(),
                r.day.as_str()
            ),
            (-1_500_000, Some(2), Some(f.tranche.as_str()), "2026-10-05")
        );
        assert_eq!(
            ledger.iter().map(|r| r.amount_cents).sum::<i64>(),
            2_000_000
        );

        for (seq, sentence) in [
            (2, "Receipt #2 has already been reversed by #3.".to_string()),
            (
                3,
                "Receipt #3 is itself a reversal; it cannot be reversed.".to_string(),
            ),
            (99, "There is no receipt #99 to reverse.".to_string()),
        ] {
            let refused = funding_receipts::reverse(&f.conn, seq, "2026-10-09", "x").unwrap_err();
            assert_eq!(refused.kind(), "money_reversal");
            assert_eq!(refused.to_string(), sentence);
        }
    }

    fn insert_receipt(
        conn: &Connection,
        seq: i64,
        amount: i64,
        reverses: Option<i64>,
        funding: Option<&str>,
        day: &str,
    ) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO funding_receipt (id, seq, day, funding_id, amount_cents, reverses_seq,
                                          author_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'x', 't')",
            params![crate::db::new_id(), seq, day, funding, amount, reverses],
        )
    }

    /// The reversal rules are the schema's as well as the host's.
    #[test]
    fn the_schema_refuses_a_reversal_that_is_partial_repeats_moves_fund_or_comes_first() {
        let f = funded();
        let (savings, tranche) = (Some(f.savings.as_str()), Some(f.tranche.as_str()));
        let day = "2026-10-02";
        for (case, amount, reverses, funding, day) in [
            (
                "larger than the original",
                -2_000_001,
                Some(1),
                savings,
                day,
            ),
            ("smaller than the original", -1, Some(1), savings, day),
            ("positive, naming a receipt", 100, Some(1), savings, day),
            ("negative, naming nothing", -100, None, savings, day),
            (
                "of a receipt that is not there",
                -100,
                Some(7),
                savings,
                day,
            ),
            ("for another fund", -2_000_000, Some(1), tranche, day),
            ("for no fund", -2_000_000, Some(1), None, day),
            (
                "dated before the money arrived",
                -2_000_000,
                Some(1),
                savings,
                "2026-09-30",
            ),
            ("nothing received", 0, None, savings, day),
        ] {
            let refused = insert_receipt(&f.conn, 2, amount, reverses, funding, day);
            assert!(refused.is_err(), "{case}");
        }
        insert_receipt(&f.conn, 2, -2_000_000, Some(1), savings, day).expect("the one reversal");
        let refused = insert_receipt(&f.conn, 3, -2_000_000, Some(1), savings, day).unwrap_err();
        assert!(
            refused.to_string().contains("funding: reversal"),
            "a second reversal: {refused}"
        );
        let refused = insert_receipt(&f.conn, 3, -1, Some(2), savings, day).unwrap_err();
        assert!(
            refused.to_string().contains("funding: reversal"),
            "a reversal of a reversal: {refused}"
        );
    }

    /// Every way SQL can rewrite the ledger, with `recursive_triggers` on and off.
    #[test]
    fn every_update_delete_replace_and_upsert_on_the_receipts_is_refused_whatever_the_pragmas() {
        let f = funded();
        receive(&f.conn, None, 70_000, "2026-10-02");
        let before = snapshot(&f.conn).unwrap().funding_receipts;
        let first = before[0].id.clone();
        let other = crate::db::new_id();

        let attacks = [
            "UPDATE funding_receipt SET amount_cents = 1".to_string(),
            "UPDATE funding_receipt SET day = '2026-01-01' WHERE seq = 1".to_string(),
            "UPDATE funding_receipt SET funding_id = NULL WHERE seq = 1".to_string(),
            "UPDATE OR REPLACE funding_receipt SET seq = 1 WHERE seq = 2".to_string(),
            "DELETE FROM funding_receipt".to_string(),
            "DELETE FROM funding_receipt WHERE seq = 2".to_string(),
            format!(
                "INSERT OR REPLACE INTO funding_receipt (id, seq, day, amount_cents, author_name, created_at)
                 VALUES ('{first}', 1, '2026-10-05', 1, 'x', 't')"
            ),
            format!(
                "REPLACE INTO funding_receipt (id, seq, day, amount_cents, author_name, created_at)
                 VALUES ('{other}', 2, '2026-10-05', 1, 'x', 't')"
            ),
            format!(
                "INSERT INTO funding_receipt (id, seq, day, amount_cents, author_name, created_at)
                 VALUES ('{first}', 1, '2026-10-05', 1, 'x', 't')
                 ON CONFLICT (id) DO UPDATE SET amount_cents = 1"
            ),
            format!(
                "INSERT INTO funding_receipt (id, seq, day, amount_cents, author_name, created_at)
                 VALUES ('{other}', 9, '2026-10-05', 1, 'x', 't')"
            ),
        ];
        for recursive in ["ON", "OFF"] {
            f.conn
                .pragma_update(None, "recursive_triggers", recursive)
                .unwrap();
            for attack in &attacks {
                let refused = f
                    .conn
                    .execute(attack, [])
                    .expect_err(&format!("recursive_triggers {recursive}: {attack}"));
                assert!(
                    refused.to_string().contains("funding: append-only"),
                    "recursive_triggers {recursive}: `{attack}` refused for the wrong reason: {refused}"
                );
            }
        }
        assert_eq!(snapshot(&f.conn).unwrap().funding_receipts, before);
    }

    /// Funds are plan: the schema keeps their shape, not their history.
    #[test]
    fn the_schema_refuses_a_fund_of_nothing_a_blank_label_or_a_day_that_does_not_exist() {
        let f = funded();
        for sql in [
            "UPDATE funding SET amount_cents = 0",
            "UPDATE funding SET amount_cents = -5",
            "UPDATE funding SET amount_cents = 1.5",
            "UPDATE funding SET label = '  '",
            "UPDATE funding SET source = ''",
            "UPDATE funding SET note = ''",
            "UPDATE funding SET expected_on = '2026-02-30'",
            "UPDATE funding SET expected_on = '2026-2-3'",
        ] {
            assert!(f.conn.execute(sql, []).is_err(), "{sql}");
        }
        let long = format!("UPDATE funding SET label = '{}'", "x".repeat(201));
        assert!(f.conn.execute(&long, []).is_err(), "a label past 200");
    }

    /// The rule in `db::funding_receipts`' header, checked against its source.
    #[test]
    fn the_module_that_writes_the_receipts_holds_no_update_delete_or_replace() {
        let source = include_str!("funding_receipts.rs");
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
            "db/funding_receipts.rs must write by INSERT only: {offending:?}"
        );
        assert!(source.contains("INSERT INTO funding_receipt"));
    }
}
