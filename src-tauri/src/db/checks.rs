//! Checks, gates, and a stage's lifecycle.
//!
//! A stage is **planned**, then **started**, then **closed** — two moments on
//! the stage row, decided by the person. Each move passes a gate: the start
//! gate to start, the close gate to close. A gate is a list of checks, and it
//! is **passed** when every check's latest answer is `yes` or `na`; an
//! unanswered check, or one whose latest answer is `no`, **holds** it. A gate
//! with no check holds nothing — the readiness rule `stage.checks` is what says
//! a stage has none (the domain's).
//!
//! The host refuses a start or a close while its gate is held, as the second
//! guard behind the domain, with a sentence naming every item that holds it
//! (`stage_gate_open`). A start is not undone — the schema refuses it too. A
//! close is reopened.
//!
//! **A closed stage is read-only until it is reopened**: its name, its
//! activities and their rooms, its checks, and any dependency that would make
//! it wait are refused as `stage_closed`. What the site did in it is still
//! written in the diary: a fact is not a change to the plan.
//!
//! Answers themselves are written by `db::check_answers`, which holds no
//! statement that edits or removes a row.
//!
//! # Changelog of this repository
//!
//! - F5: checks added, renamed, removed, the usual ones added; gates held and
//!   passed; start, close, reopen.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Check;
use crate::db::check_answers::CHECK_NOT_FOUND;
use crate::db::order::CHECKS;
use crate::db::work::{exists, refuse_if_stage_closed, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// One of a stage's two gates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    /// Answered before the stage starts.
    Start,
    /// Answered before the stage closes.
    Close,
}

impl Gate {
    /// The word the file and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Gate::Start => "start",
            Gate::Close => "close",
        }
    }
}

/// The sentence for removing a check that has been answered.
pub const CHECK_HAS_ANSWERS: &str =
    "That check has been answered, and its answers are facts: it can be renamed, not removed.";

/// The sentence for removing a stage whose checks have been answered.
pub const STAGE_HAS_ANSWERS: &str =
    "That stage's checks have been answered, and answers are facts: the stage cannot be removed.";

/// Every check, by stage position, start gate before close, then position.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Check>> {
    let checks = conn
        .prepare(
            "SELECT c.id, c.stage_id, c.gate, c.position, c.name
             FROM stage_check c JOIN stage s ON s.id = c.stage_id
             ORDER BY s.position, CASE c.gate WHEN 'start' THEN 0 ELSE 1 END, c.position",
        )?
        .query_map([], |row| {
            Ok(Check {
                id: row.get(0)?,
                stage_id: row.get(1)?,
                gate: row.get(2)?,
                position: row.get(3)?,
                name: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(checks)
}

/// The stage a check belongs to, refusing when the check is not in this work
/// or its stage is closed.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an unknown check; [`Error::StageClosed`] for a
/// check of a closed stage.
pub fn refuse_if_check_closed(conn: &Connection, check_id: &str) -> Result<String> {
    let stage: String = conn
        .query_row(
            "SELECT stage_id FROM stage_check WHERE id = ?1",
            [check_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(CHECK_NOT_FOUND.into()))?;
    refuse_if_stage_closed(conn, &stage)?;
    Ok(stage)
}

/// Add a check at the end of a stage's gate; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage not in this work;
/// [`Error::StageClosed`] for a closed one.
pub fn add(conn: &Connection, stage_id: &str, gate: Gate, name: &str) -> Result<String> {
    if !exists(conn, "SELECT 1 FROM stage WHERE id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    refuse_if_stage_closed(conn, stage_id)?;
    insert(conn, stage_id, gate, name)
}

fn insert(conn: &Connection, stage_id: &str, gate: Gate, name: &str) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO stage_check (id, stage_id, gate, position, name, created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT coalesce(max(position), 0) + 1 FROM stage_check
                  WHERE stage_id = ?2 AND gate = ?3),
                 ?4, ?5)",
        params![id, stage_id, gate.as_str(), name, now()],
    )?;
    Ok(id)
}

/// Add the usual checks — names the interface already put in the person's
/// language — skipping any the gate already has (by name, ignoring case).
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage not in this work;
/// [`Error::StageClosed`] for a closed one.
pub fn add_defaults(
    conn: &Connection,
    stage_id: &str,
    start: &[String],
    close: &[String],
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM stage WHERE id = ?1", stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    refuse_if_stage_closed(&tx, stage_id)?;
    for (gate, names) in [(Gate::Start, start), (Gate::Close, close)] {
        let mut have: HashSet<String> = tx
            .prepare("SELECT name FROM stage_check WHERE stage_id = ?1 AND gate = ?2")?
            .query_map(params![stage_id, gate.as_str()], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .map(|name| name.to_lowercase())
            .collect();
        for name in names {
            if have.insert(name.to_lowercase()) {
                insert(&tx, stage_id, gate, name)?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Rename a check — allowed even when it has answers.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a check not in this work;
/// [`Error::StageClosed`] for a check of a closed stage.
pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<()> {
    refuse_if_check_closed(conn, id)?;
    conn.execute(
        "UPDATE stage_check SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    Ok(())
}

/// Remove a check that has never been answered; the checks after it in its
/// gate close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a check not in this work or one with answers;
/// [`Error::StageClosed`] for a check of a closed stage.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    refuse_if_check_closed(&tx, id)?;
    if exists(&tx, "SELECT 1 FROM check_answer WHERE check_id = ?1", id)? {
        return Err(Error::InvalidInput(CHECK_HAS_ANSWERS.into()));
    }
    let scope = CHECKS.scope_of(&tx, id)?;
    tx.execute("DELETE FROM stage_check WHERE id = ?1", [id])?;
    CHECKS.close_gaps(&tx, scope.as_deref())?;
    tx.commit()?;
    Ok(())
}

/// Refuse to remove a stage whose checks were answered. Called by
/// `db::work::remove_stage` inside its transaction.
///
/// # Errors
///
/// [`Error::InvalidInput`] when an answer exists.
pub fn refuse_if_stage_answered(conn: &Connection, stage_id: &str) -> Result<()> {
    if exists(
        conn,
        "SELECT 1 FROM check_answer a JOIN stage_check c ON c.id = a.check_id
         WHERE c.stage_id = ?1",
        stage_id,
    )? {
        return Err(Error::InvalidInput(STAGE_HAS_ANSWERS.into()));
    }
    Ok(())
}

/// What holds a gate: each check whose latest answer is not `yes` or `na`,
/// with that latest answer (`None` when never answered), in order.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn holding(
    conn: &Connection,
    stage_id: &str,
    gate: Gate,
) -> Result<Vec<(String, Option<String>)>> {
    let items = conn
        .prepare(
            "SELECT c.name,
                    (SELECT a.answer FROM check_answer a WHERE a.check_id = c.id
                     ORDER BY a.seq DESC LIMIT 1)
             FROM stage_check c
             WHERE c.stage_id = ?1 AND c.gate = ?2
             ORDER BY c.position",
        )?
        .query_map(params![stage_id, gate.as_str()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|(_, latest)| !matches!(latest.as_deref(), Some("yes" | "na")))
        .collect();
    Ok(items)
}

/// The sentence for a held gate, naming every item that holds it.
pub fn held_sentence(gate: Gate, items: &[(String, Option<String>)]) -> String {
    let named: Vec<String> = items
        .iter()
        .map(|(name, latest)| match latest.as_deref() {
            None => format!("{name} (not answered)"),
            Some(answer) => format!("{name} (answered {answer})"),
        })
        .collect();
    let (count, verb) = if items.len() == 1 {
        ("1 item".to_string(), "holds")
    } else {
        (format!("{} items", items.len()), "hold")
    };
    format!(
        "{count} {verb} the {} gate: {}.",
        gate.as_str(),
        named.join("; ")
    )
}

/// The stage's name and its two moments.
fn stage_row(conn: &Connection, id: &str) -> Result<(String, Option<String>, Option<String>)> {
    conn.query_row(
        "SELECT name, started_at, closed_at FROM stage WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()?
    .ok_or_else(|| Error::InvalidInput(STAGE_NOT_FOUND.into()))
}

fn refuse_if_held(conn: &Connection, id: &str, gate: Gate) -> Result<()> {
    let items = holding(conn, id, gate)?;
    if items.is_empty() {
        Ok(())
    } else {
        Err(Error::StageGateOpen(held_sentence(gate, &items)))
    }
}

/// Start a planned stage, now, once its start gate is passed.
///
/// # Errors
///
/// [`Error::StageGateOpen`] while the start gate is held;
/// [`Error::InvalidInput`] for a stage not in this work or already started.
pub fn start(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (_, started_at, _) = stage_row(&tx, id)?;
    if started_at.is_some() {
        return Err(Error::InvalidInput(
            "That stage has already started.".into(),
        ));
    }
    refuse_if_held(&tx, id, Gate::Start)?;
    tx.execute(
        "UPDATE stage SET started_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Close a started stage, now, once its close gate is passed.
///
/// # Errors
///
/// [`Error::StageGateOpen`] while the close gate is held;
/// [`Error::InvalidInput`] for a stage not in this work, not started, or
/// already closed.
pub fn close(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (_, started_at, closed_at) = stage_row(&tx, id)?;
    if started_at.is_none() {
        return Err(Error::InvalidInput(
            "A stage is started before it is closed.".into(),
        ));
    }
    if closed_at.is_some() {
        return Err(Error::InvalidInput("That stage is already closed.".into()));
    }
    refuse_if_held(&tx, id, Gate::Close)?;
    tx.execute(
        "UPDATE stage SET closed_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Reopen a closed stage: open again, and editable. Its start stays.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage not in this work or not closed.
pub fn reopen(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (_, _, closed_at) = stage_row(&tx, id)?;
    if closed_at.is_none() {
        return Err(Error::InvalidInput("That stage is not closed.".into()));
    }
    tx.execute("UPDATE stage SET closed_at = NULL WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::check_answers::{self, NewAnswer};
    use crate::db::order::Direction;
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_activity, add_stage, remove_stage, snapshot};

    fn answer(conn: &Connection, check: &str, answer: &str, reason: Option<&str>) -> i64 {
        check_answers::append(
            conn,
            &NewAnswer {
                check_id: check.into(),
                answer: answer.into(),
                reason: reason.map(str::to_string),
                photo_hash: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap()
    }

    /// A stage with two start checks and two close checks.
    fn gated(conn: &Connection) -> (String, [String; 4]) {
        let stage = add_stage(conn, "Tiling").unwrap();
        let ids = [
            add(conn, &stage, Gate::Start, "The materials are on site").unwrap(),
            add(conn, &stage, Gate::Start, "The area is clear").unwrap(),
            add(conn, &stage, Gate::Close, "The work was inspected").unwrap(),
            add(conn, &stage, Gate::Close, "Photos were taken").unwrap(),
        ];
        (stage, ids)
    }

    fn state(conn: &Connection, stage: &str) -> (bool, bool) {
        let s = snapshot(conn)
            .unwrap()
            .stages
            .into_iter()
            .find(|s| s.id == stage)
            .unwrap();
        (s.started_at.is_some(), s.closed_at.is_some())
    }

    #[test]
    fn an_unanswered_item_holds_the_gate_and_the_refusal_names_it() {
        let conn = a_work();
        let (stage, [materials, ..]) = gated(&conn);
        answer(&conn, &materials, "yes", None);

        let refused = start(&conn, &stage).unwrap_err();

        assert_eq!(refused.kind(), "stage_gate_open");
        assert_eq!(
            refused.to_string(),
            "1 item holds the start gate: The area is clear (not answered)."
        );
        assert_eq!(state(&conn, &stage), (false, false));
    }

    #[test]
    fn a_no_holds_the_gate_and_yes_or_na_pass_it() {
        let conn = a_work();
        let (stage, [materials, area, ..]) = gated(&conn);
        answer(&conn, &materials, "no", Some("Only half the tiles came."));
        answer(&conn, &area, "na", Some("The room is empty already."));

        assert_eq!(
            start(&conn, &stage).unwrap_err().to_string(),
            "1 item holds the start gate: The materials are on site (answered no)."
        );

        answer(&conn, &materials, "yes", None);
        start(&conn, &stage).expect("yes and n/a pass the gate");
        assert_eq!(state(&conn, &stage), (true, false));
    }

    /// Append semantics: the latest answer counts, whatever came before it.
    #[test]
    fn a_latest_no_after_an_earlier_yes_holds_the_gate() {
        let conn = a_work();
        let (stage, [materials, area, inspected, photos]) = gated(&conn);
        for check in [&materials, &area] {
            answer(&conn, check, "yes", None);
        }
        start(&conn, &stage).unwrap();
        assert_eq!(answer(&conn, &inspected, "yes", None), 1);
        answer(&conn, &photos, "yes", None);
        assert_eq!(answer(&conn, &inspected, "no", Some("A cracked tile.")), 2);

        let refused = close(&conn, &stage).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "1 item holds the close gate: The work was inspected (answered no)."
        );

        assert_eq!(answer(&conn, &inspected, "yes", Some("Replaced.")), 3);
        close(&conn, &stage).unwrap();
        assert_eq!(state(&conn, &stage), (true, true));
        let seqs: Vec<i64> = snapshot(&conn)
            .unwrap()
            .check_answers
            .iter()
            .filter(|a| a.check_id == inspected)
            .map(|a| a.seq)
            .collect();
        assert_eq!(seqs, vec![1, 2, 3], "every answer kept, in order");
    }

    #[test]
    fn a_planned_stage_cannot_close_a_started_one_cannot_start_again_and_a_closed_one_reopens() {
        let conn = a_work();
        let stage = add_stage(&conn, "Painting").unwrap();

        assert_eq!(
            close(&conn, &stage).unwrap_err().to_string(),
            "A stage is started before it is closed."
        );
        start(&conn, &stage).expect("a gate with no check holds nothing");
        assert_eq!(
            start(&conn, &stage).unwrap_err().to_string(),
            "That stage has already started."
        );
        assert_eq!(
            reopen(&conn, &stage).unwrap_err().to_string(),
            "That stage is not closed."
        );
        close(&conn, &stage).unwrap();
        assert_eq!(
            close(&conn, &stage).unwrap_err().to_string(),
            "That stage is already closed."
        );
        reopen(&conn, &stage).unwrap();
        assert_eq!(
            state(&conn, &stage),
            (true, false),
            "reopened; the start stays"
        );
        close(&conn, &stage).expect("and closed again");
    }

    /// A start is not undone, even by SQL; a close without a start cannot be
    /// written either.
    #[test]
    fn the_schema_refuses_undoing_a_start_and_a_close_without_one() {
        let conn = a_work();
        let stage = add_stage(&conn, "Painting").unwrap();
        let refused = conn.execute("UPDATE stage SET closed_at = 't' WHERE id = ?1", [&stage]);
        assert!(refused.is_err(), "closed without being started");

        start(&conn, &stage).unwrap();
        for sql in [
            "UPDATE stage SET started_at = NULL WHERE id = ?1",
            "UPDATE stage SET started_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
        ] {
            let refused = conn.execute(sql, [&stage]).unwrap_err();
            assert!(refused.to_string().contains("checks: append-only"), "{sql}");
        }
    }

    #[test]
    fn checks_are_added_per_gate_moved_within_their_gate_renamed_and_removed() {
        let conn = a_work();
        let (_, [materials, area, inspected, _]) = gated(&conn);

        CHECKS.move_one(&conn, &area, Direction::Up).unwrap();
        CHECKS.move_one(&conn, &inspected, Direction::Up).unwrap();
        rename(&conn, &materials, "Tiles and adhesive are on site").unwrap();

        let rows: Vec<(String, i64, String)> = list(&conn)
            .unwrap()
            .into_iter()
            .map(|c| (c.gate, c.position, c.name))
            .collect();
        assert_eq!(
            rows,
            vec![
                ("start".into(), 1, "The area is clear".into()),
                ("start".into(), 2, "Tiles and adhesive are on site".into()),
                ("close".into(), 1, "The work was inspected".into()),
                ("close".into(), 2, "Photos were taken".into()),
            ],
            "the first close check did not move up into the start gate"
        );

        remove(&conn, &area).unwrap();
        let positions: Vec<i64> = list(&conn)
            .unwrap()
            .iter()
            .filter(|c| c.gate == "start")
            .map(|c| c.position)
            .collect();
        assert_eq!(positions, vec![1]);
    }

    #[test]
    fn a_check_with_answers_is_renamed_but_never_removed_and_neither_is_its_stage() {
        let conn = a_work();
        let (stage, [materials, ..]) = gated(&conn);
        answer(&conn, &materials, "yes", None);

        let refused = remove(&conn, &materials).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), CHECK_HAS_ANSWERS);
        rename(&conn, &materials, "Everything is on site").expect("a rename keeps the facts");

        assert_eq!(
            remove_stage(&conn, &stage).unwrap_err().to_string(),
            STAGE_HAS_ANSWERS
        );
        assert_eq!(list(&conn).unwrap().len(), 4);
    }

    #[test]
    fn the_usual_checks_are_added_once_whatever_the_case_of_what_is_already_there() {
        let conn = a_work();
        let stage = add_stage(&conn, "Tiling").unwrap();
        add(&conn, &stage, Gate::Start, "the materials are on site").unwrap();
        let start_names: Vec<String> = [
            "The previous stage is closed",
            "The materials are on site",
            "The area is clear and protected",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let close_names: Vec<String> = ["The work was inspected", "Photos were taken"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        add_defaults(&conn, &stage, &start_names, &close_names).unwrap();
        add_defaults(&conn, &stage, &start_names, &close_names).unwrap();

        let checks = list(&conn).unwrap();
        assert_eq!(checks.iter().filter(|c| c.gate == "start").count(), 3);
        assert_eq!(checks.iter().filter(|c| c.gate == "close").count(), 2);
    }

    /// A closed stage is read-only until it is reopened.
    #[test]
    fn a_closed_stage_refuses_changes_to_its_rows_and_reopened_accepts_them() {
        let conn = a_work();
        let stage = add_stage(&conn, "Tiling").unwrap();
        let tile = add_activity(&conn, &stage, "Tile").unwrap();
        let check = add(&conn, &stage, Gate::Close, "Inspected").unwrap();
        answer(&conn, &check, "yes", None);
        start(&conn, &stage).unwrap();
        close(&conn, &stage).unwrap();

        for (case, refused) in [
            (
                "add a check",
                add(&conn, &stage, Gate::Start, "Late").map(|_| ()),
            ),
            ("rename a check", rename(&conn, &check, "X")),
            ("remove a check", remove(&conn, &check)),
            (
                "add the usual checks",
                add_defaults(&conn, &stage, &["A".into()], &[]),
            ),
            (
                "add an activity",
                add_activity(&conn, &stage, "Grout").map(|_| ()),
            ),
            (
                "rename the stage",
                crate::db::work::rename_stage(&conn, &stage, "X"),
            ),
            (
                "remove an activity",
                crate::db::work::remove_activity(&conn, &tile),
            ),
            (
                "change an activity",
                crate::db::work::update_activity(
                    &conn,
                    &tile,
                    &crate::db::work::ActivityChange {
                        duration_days: Some(Some(3)),
                        ..Default::default()
                    },
                ),
            ),
            (
                "set an activity's rooms",
                crate::db::rooms::set_activity_rooms(&conn, &tile, &[]),
            ),
        ] {
            let error = refused.expect_err(case);
            assert_eq!(error.kind(), "stage_closed", "{case}");
            assert_eq!(
                error.to_string(),
                "“Tiling” is closed. Reopen it to change it."
            );
        }

        answer(
            &conn,
            &check,
            "no",
            Some("A fact after the close is still a fact."),
        );
        reopen(&conn, &stage).unwrap();
        add_activity(&conn, &stage, "Grout").expect("reopened: editable again");
    }

    /// Every way SQL can rewrite an answer, with `recursive_triggers` on and
    /// off.
    #[test]
    fn every_update_delete_replace_and_upsert_on_an_answer_is_refused_whatever_the_pragmas() {
        let conn = a_work();
        let (_, [materials, area, ..]) = gated(&conn);
        answer(&conn, &materials, "yes", None);
        answer(&conn, &materials, "no", Some("Half came."));
        let before = snapshot(&conn).unwrap().check_answers;
        let first = before[0].id.clone();
        let other = crate::db::new_id();

        let attacks = [
            "UPDATE check_answer SET answer = 'yes'".to_string(),
            "UPDATE check_answer SET reason = NULL".to_string(),
            format!("UPDATE OR REPLACE check_answer SET seq = 2 WHERE id = '{first}'"),
            "DELETE FROM check_answer".to_string(),
            format!("DELETE FROM check_answer WHERE id = '{first}'"),
            format!(
                "INSERT OR REPLACE INTO check_answer
                   (id, check_id, seq, answer, author_name, answered_at)
                 VALUES ('{first}', '{materials}', 1, 'yes', 'x', 't')"
            ),
            format!(
                "REPLACE INTO check_answer (id, check_id, seq, answer, author_name, answered_at)
                 VALUES ('{other}', '{materials}', 2, 'yes', 'x', 't')"
            ),
            format!(
                "INSERT INTO check_answer (id, check_id, seq, answer, author_name, answered_at)
                 VALUES ('{first}', '{materials}', 1, 'yes', 'x', 't')
                 ON CONFLICT (id) DO UPDATE SET answer = 'yes'"
            ),
            // Out of sequence: a gap, and a second first answer.
            format!(
                "INSERT INTO check_answer (id, check_id, seq, answer, author_name, answered_at)
                 VALUES ('{other}', '{materials}', 5, 'yes', 'x', 't')"
            ),
            format!(
                "INSERT INTO check_answer (id, check_id, seq, answer, author_name, answered_at)
                 VALUES ('{other}', '{area}', 2, 'yes', 'x', 't')"
            ),
        ];
        for recursive in ["ON", "OFF"] {
            conn.pragma_update(None, "recursive_triggers", recursive)
                .unwrap();
            for attack in &attacks {
                let refused = conn
                    .execute(attack, [])
                    .expect_err(&format!("recursive_triggers {recursive}: {attack}"));
                assert!(
                    refused.to_string().contains("checks: append-only"),
                    "recursive_triggers {recursive}: `{attack}` refused for the wrong reason: {refused}"
                );
            }
        }
        assert_eq!(snapshot(&conn).unwrap().check_answers, before);
    }

    #[test]
    fn the_schema_refuses_not_applicable_without_its_reason() {
        let conn = a_work();
        let (_, [materials, ..]) = gated(&conn);
        let refused = conn.execute(
            "INSERT INTO check_answer (id, check_id, seq, answer, author_name, answered_at)
             VALUES (?1, ?2, 1, 'na', 'x', 't')",
            [crate::db::new_id(), materials],
        );
        assert!(refused
            .unwrap_err()
            .to_string()
            .contains("CHECK constraint failed"));
    }

    /// The rule in `db::check_answers`' header, checked against its source.
    #[test]
    fn the_module_that_writes_answers_holds_no_update_delete_or_replace() {
        let source = include_str!("check_answers.rs");
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
            "db/check_answers.rs must write by INSERT only: {offending:?}"
        );
        assert!(source.contains("INSERT INTO check_answer"));
    }
}
