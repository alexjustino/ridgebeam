//! A commitment's payment plan: its milestones (D2).
//!
//! A milestone is a share of a commitment's amount, in basis points, earned by
//! a fact of the work — the commitment agreed (`advance`), its stage started or
//! closed, or one of the stage's activities finished. The host stores the plan
//! and nothing it means: what is earned, paid, due now and paid ahead is the
//! domain's, from the stage's lifecycle and the diary, every time.
//!
//! The rules the host answers with a sentence, each also held by the schema
//! (work migration 011):
//!
//! - the shares of one commitment add up to at most 100 % — the rest is "not in
//!   the plan yet";
//! - an `activity_finished` milestone names an activity of the commitment's
//!   stage, and no other trigger names one;
//! - once a payment names the commitment — a reversal included — its plan is
//!   fixed: nothing added, changed, moved or removed ([`PLAN_LOCKED`], in the
//!   words of F6's [`crate::db::money::COMMITMENT_LOCKED`]).
//!
//! Neither a closed stage nor an approved plan refuses a milestone: money is
//! not a plan edit, and a payment plan is an agreement, not what a baseline
//! records.
//!
//! # Changelog of this repository
//!
//! - D2: milestones listed per commitment, added, changed, moved (via
//!   `db::order`), removed; the usual plan written in one transaction; an
//!   activity a milestone is earned by is not removed.
//! - E4: the trigger `retention` (work migration 016, which rebuilds the
//!   table with every row and trigger kept); it names no activity.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::Milestone;
use crate::db::money::ACTIVITY_OF_ANOTHER_STAGE;
use crate::db::order::MILESTONES;
use crate::db::payments::COMMITMENT_NOT_FOUND;
use crate::db::work::{exists, ACTIVITY_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The sentence for a milestone id that is not in this work.
pub const MILESTONE_NOT_FOUND: &str = "That milestone is not in this work.";

/// The sentence for changing the payment plan of a commitment paid against.
pub const PLAN_LOCKED: &str =
    "That commitment has been paid against: its payment plan can no longer be changed.";

/// The sentence for an `activity_finished` milestone with no activity.
pub const ACTIVITY_NEEDED: &str =
    "A milestone earned when an activity is finished names that activity.";

/// The sentence for an activity on a milestone earned by anything else.
pub const ACTIVITY_NOT_WANTED: &str =
    "Only a milestone earned when an activity is finished names an activity.";

/// The sentence for the usual plan on a commitment that already has one.
pub const PLAN_ALREADY_THERE: &str =
    "That commitment already has a payment plan: the usual one is for a commitment with none.";

/// The sentence for the usual plan on a stage with no activity.
pub const NO_ACTIVITY_FOR_THE_USUAL_PLAN: &str =
    "The usual plan pays when the stage's last activity is finished, and that stage has no activity yet.";

/// The sentence for an activity a milestone is earned by, asked to go.
pub const ACTIVITY_EARNS_A_MILESTONE: &str =
    "A payment milestone is earned when that activity is finished: change or remove the milestone before removing the activity.";

/// Every basis point there is: 100 %.
pub const WHOLE_BP: i64 = 10_000;

/// The sentence for a plan that would hold more than 100 %.
pub fn over_whole(total_bp: i64) -> String {
    format!(
        "That would put {} of the commitment in its payment plan, and a plan holds at most 100 %.",
        percent(total_bp)
    )
}

/// Basis points as a person reads them: `3000` is `30 %`, `3050` is `30.5 %`.
fn percent(bp: i64) -> String {
    let whole = bp / 100;
    let hundredths = bp % 100;
    if hundredths == 0 {
        format!("{whole} %")
    } else if hundredths % 10 == 0 {
        format!("{whole}.{} %", hundredths / 10)
    } else {
        format!("{whole}.{hundredths:02} %")
    }
}

/// A milestone as it is written; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MilestoneFields {
    /// What it is.
    pub label: String,
    /// 1 to 10 000.
    pub share_bp: i64,
    /// One of the five triggers.
    pub trigger: String,
    /// The activity, for `activity_finished`.
    pub activity_id: Option<String>,
}

/// Every commitment's milestones, by position, keyed by commitment.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn by_commitment(conn: &Connection) -> Result<HashMap<String, Vec<Milestone>>> {
    let rows = conn
        .prepare(
            "SELECT commitment_id, id, position, label, share_bp, trigger, activity_id
             FROM payment_milestone ORDER BY commitment_id, position",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Milestone {
                    id: row.get(1)?,
                    position: row.get(2)?,
                    label: row.get(3)?,
                    share_bp: row.get(4)?,
                    trigger: row.get(5)?,
                    activity_id: row.get(6)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut plans: HashMap<String, Vec<Milestone>> = HashMap::new();
    for (commitment, milestone) in rows {
        plans.entry(commitment).or_default().push(milestone);
    }
    Ok(plans)
}

/// The commitment's stage, refusing a commitment not in this work or one a
/// payment names.
fn unlocked_stage(conn: &Connection, commitment_id: &str) -> Result<String> {
    let stage: String = conn
        .query_row(
            "SELECT stage_id FROM commitment WHERE id = ?1",
            [commitment_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(COMMITMENT_NOT_FOUND.into()))?;
    if exists(
        conn,
        "SELECT 1 FROM payment WHERE commitment_id = ?1",
        commitment_id,
    )? {
        return Err(Error::InvalidInput(PLAN_LOCKED.into()));
    }
    Ok(stage)
}

/// The commitment a milestone belongs to, refusing a milestone not in this
/// work or one whose commitment a payment names.
fn unlocked_commitment(conn: &Connection, id: &str) -> Result<(String, String)> {
    let commitment = MILESTONES
        .scope_of(conn, id)?
        .ok_or_else(|| Error::InvalidInput(MILESTONE_NOT_FOUND.into()))?;
    let stage = unlocked_stage(conn, &commitment)?;
    Ok((commitment, stage))
}

/// Refuse a milestone whose trigger and activity do not agree, or whose
/// activity is not of the stage.
fn refuse_unless_consistent(conn: &Connection, stage_id: &str, m: &MilestoneFields) -> Result<()> {
    match (m.trigger.as_str(), m.activity_id.as_deref()) {
        ("activity_finished", None) => Err(Error::InvalidInput(ACTIVITY_NEEDED.into())),
        ("activity_finished", Some(activity)) => {
            let stage: String = conn
                .query_row(
                    "SELECT stage_id FROM activity WHERE id = ?1",
                    [activity],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::InvalidInput(ACTIVITY_NOT_FOUND.into()))?;
            if stage == stage_id {
                Ok(())
            } else {
                Err(Error::InvalidInput(ACTIVITY_OF_ANOTHER_STAGE.into()))
            }
        }
        (_, Some(_)) => Err(Error::InvalidInput(ACTIVITY_NOT_WANTED.into())),
        (_, None) => Ok(()),
    }
}

/// Refuse a plan that would hold more than 100 % with `share_bp` in it —
/// `except`, the milestone being changed, counted at its new share only.
fn refuse_if_over_whole(
    conn: &Connection,
    commitment_id: &str,
    share_bp: i64,
    except: Option<&str>,
) -> Result<()> {
    let others: i64 = conn.query_row(
        "SELECT coalesce(sum(share_bp), 0) FROM payment_milestone
         WHERE commitment_id = ?1 AND id IS NOT ?2",
        params![commitment_id, except],
        |row| row.get(0),
    )?;
    if others + share_bp > WHOLE_BP {
        return Err(Error::InvalidInput(over_whole(others + share_bp)));
    }
    Ok(())
}

fn insert(conn: &Connection, commitment_id: &str, m: &MilestoneFields) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO payment_milestone
           (id, commitment_id, position, label, share_bp, trigger, activity_id, created_at)
         VALUES (?1, ?2,
                 (SELECT coalesce(max(position), 0) + 1 FROM payment_milestone
                  WHERE commitment_id = ?2),
                 ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            commitment_id,
            m.label,
            m.share_bp,
            m.trigger,
            m.activity_id,
            now()
        ],
    )?;
    Ok(id)
}

/// Add a milestone at the end of a commitment's plan; returns its id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a commitment not in this work or paid against,
/// a trigger and an activity that do not agree, an activity not in this work
/// or of another stage, or a plan that would hold more than 100 %.
pub fn add(conn: &Connection, commitment_id: &str, m: &MilestoneFields) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    let stage = unlocked_stage(&tx, commitment_id)?;
    refuse_unless_consistent(&tx, &stage, m)?;
    refuse_if_over_whole(&tx, commitment_id, m.share_bp, None)?;
    let id = insert(&tx, commitment_id, m)?;
    tx.commit()?;
    Ok(id)
}

/// The milestone as it is.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a milestone not in this work.
pub fn fields(conn: &Connection, id: &str) -> Result<MilestoneFields> {
    conn.query_row(
        "SELECT label, share_bp, trigger, activity_id FROM payment_milestone WHERE id = ?1",
        [id],
        |row| {
            Ok(MilestoneFields {
                label: row.get(0)?,
                share_bp: row.get(1)?,
                trigger: row.get(2)?,
                activity_id: row.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| Error::InvalidInput(MILESTONE_NOT_FOUND.into()))
}

/// Write a milestone whole — `change` is given the milestone as it is and
/// returns it as it should be — while nothing is paid against its commitment.
///
/// # Errors
///
/// As [`add`], and [`Error::InvalidInput`] for a milestone not in this work.
pub fn update(
    conn: &Connection,
    id: &str,
    change: impl FnOnce(MilestoneFields) -> MilestoneFields,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (commitment, stage) = unlocked_commitment(&tx, id)?;
    let m = change(fields(&tx, id)?);
    refuse_unless_consistent(&tx, &stage, &m)?;
    refuse_if_over_whole(&tx, &commitment, m.share_bp, Some(id))?;
    tx.execute(
        "UPDATE payment_milestone SET label = ?2, share_bp = ?3, trigger = ?4, activity_id = ?5
         WHERE id = ?1",
        params![id, m.label, m.share_bp, m.trigger, m.activity_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Move a milestone one step within its plan. At the edge nothing moves, and
/// that is not an error — but a locked plan refuses the move either way.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a milestone not in this work, or one whose
/// commitment has been paid against.
pub fn move_one(conn: &Connection, id: &str, direction: crate::db::order::Direction) -> Result<()> {
    // `move_one` is its own transaction; the work is behind one lock, so
    // nothing pays against the commitment between the check and the move.
    unlocked_commitment(conn, id)?;
    MILESTONES.move_one(conn, id, direction)
}

/// Remove a milestone; the ones after it close up.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a milestone not in this work, or one whose
/// commitment has been paid against.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (commitment, _) = unlocked_commitment(&tx, id)?;
    tx.execute("DELETE FROM payment_milestone WHERE id = ?1", [id])?;
    MILESTONES.close_gaps(&tx, Some(&commitment))?;
    tx.commit()?;
    Ok(())
}

/// The usual split, as data: 30 % when the stage starts, 40 % when its last
/// activity is finished, 30 % when it closes. A common split, not advice.
pub const USUAL_SPLIT: [(&str, i64); 3] = [
    ("stage_started", 3_000),
    ("activity_finished", 4_000),
    ("stage_closed", 3_000),
];

/// Write the usual plan on a commitment with none, in one transaction; the
/// middle milestone names the stage's last activity by position. `labels` are
/// the three labels, in [`USUAL_SPLIT`]'s order, already checked.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a commitment not in this work, paid against, or
/// with a payment plan already; or a stage with no activity.
pub fn add_usual(conn: &Connection, commitment_id: &str, labels: [&str; 3]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let stage = unlocked_stage(&tx, commitment_id)?;
    if exists(
        &tx,
        "SELECT 1 FROM payment_milestone WHERE commitment_id = ?1",
        commitment_id,
    )? {
        return Err(Error::InvalidInput(PLAN_ALREADY_THERE.into()));
    }
    let last: String = tx
        .query_row(
            "SELECT id FROM activity WHERE stage_id = ?1 ORDER BY position DESC LIMIT 1",
            [&stage],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(NO_ACTIVITY_FOR_THE_USUAL_PLAN.into()))?;
    for ((trigger, share_bp), label) in USUAL_SPLIT.iter().zip(labels) {
        insert(
            &tx,
            commitment_id,
            &MilestoneFields {
                label: label.to_string(),
                share_bp: *share_bp,
                trigger: (*trigger).to_string(),
                activity_id: (*trigger == "activity_finished").then(|| last.clone()),
            },
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Refuse removing an activity a milestone is earned by. Called by
/// `db::work::remove_activity` inside its transaction.
///
/// # Errors
///
/// [`Error::InvalidInput`] when a milestone names the activity.
pub fn refuse_if_activity_earns(conn: &Connection, activity_id: &str) -> Result<()> {
    if exists(
        conn,
        "SELECT 1 FROM payment_milestone WHERE activity_id = ?1",
        activity_id,
    )? {
        return Err(Error::InvalidInput(ACTIVITY_EARNS_A_MILESTONE.into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::money::{
        add_commitment, remove_commitment, CommitmentFields, COMMITMENT_LOCKED,
    };
    use crate::db::order::Direction;
    use crate::db::payments::{self, NewPayment};
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_activity, add_stage, remove_activity, remove_stage, snapshot};

    struct Plan {
        conn: Connection,
        stage: String,
        prepare: String,
        lay: String,
        quote: String,
    }

    /// A stage Tiling with two activities and one commitment of 1 000.00 —
    /// the e2e's, synthetic.
    fn a_plan() -> Plan {
        let conn = a_work();
        let stage = add_stage(&conn, "Tiling").unwrap();
        let prepare = add_activity(&conn, &stage, "Prepare the floor").unwrap();
        let lay = add_activity(&conn, &stage, "Lay the tiles").unwrap();
        let quote = add_commitment(
            &conn,
            &stage,
            &CommitmentFields {
                person_id: None,
                label: "Tiler's quote".into(),
                amount_cents: 100_000,
                agreed_on: "2026-10-01".into(),
                document_hash: None,
            },
        )
        .unwrap();
        Plan {
            conn,
            stage,
            prepare,
            lay,
            quote,
        }
    }

    fn fields(
        label: &str,
        share_bp: i64,
        trigger: &str,
        activity: Option<&str>,
    ) -> MilestoneFields {
        MilestoneFields {
            label: label.into(),
            share_bp,
            trigger: trigger.into(),
            activity_id: activity.map(str::to_string),
        }
    }

    fn plan_of(conn: &Connection) -> Vec<(i64, String, i64, String, Option<String>)> {
        snapshot(conn).unwrap().commitments[0]
            .milestones
            .iter()
            .map(|m| {
                (
                    m.position,
                    m.label.clone(),
                    m.share_bp,
                    m.trigger.clone(),
                    m.activity_id.clone(),
                )
            })
            .collect()
    }

    fn pay(p: &Plan, amount_cents: i64) -> i64 {
        payments::append(
            &p.conn,
            &NewPayment {
                day: "2026-10-05".into(),
                person_id: None,
                stage_id: p.stage.clone(),
                commitment_id: Some(p.quote.clone()),
                amount_cents,
                what_for: None,
                receipt_hash: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn a_milestone_is_added_changed_moved_and_removed_and_positions_stay_one_to_n() {
        let p = a_plan();
        let advance = add(
            &p.conn,
            &p.quote,
            &fields("Advance", 3_000, "advance", None),
        )
        .unwrap();
        add(
            &p.conn,
            &p.quote,
            &fields("Tiles laid", 4_000, "activity_finished", Some(&p.lay)),
        )
        .unwrap();
        let closed = add(
            &p.conn,
            &p.quote,
            &fields("Handover", 3_000, "stage_closed", None),
        )
        .unwrap();
        assert_eq!(
            plan_of(&p.conn),
            vec![
                (1, "Advance".into(), 3_000, "advance".into(), None),
                (
                    2,
                    "Tiles laid".into(),
                    4_000,
                    "activity_finished".into(),
                    Some(p.lay.clone())
                ),
                (3, "Handover".into(), 3_000, "stage_closed".into(), None),
            ]
        );

        update(&p.conn, &advance, |mut m| {
            m.trigger = "stage_started".into();
            m.label = "Start".into();
            m
        })
        .unwrap();
        move_one(&p.conn, &closed, Direction::Up).unwrap();
        move_one(&p.conn, &advance, Direction::Up).expect("the edge is not an error");
        let order: Vec<String> = plan_of(&p.conn).into_iter().map(|m| m.1).collect();
        assert_eq!(order, vec!["Start", "Handover", "Tiles laid"]);

        remove(&p.conn, &closed).unwrap();
        let after: Vec<(i64, String)> = plan_of(&p.conn).into_iter().map(|m| (m.0, m.1)).collect();
        assert_eq!(
            after,
            vec![(1, "Start".into()), (2, "Tiles laid".into())],
            "the gap closes"
        );

        let nobody = new_id();
        for refused in [
            update(&p.conn, &nobody, |m| m),
            move_one(&p.conn, &nobody, Direction::Down),
            remove(&p.conn, &nobody),
        ] {
            assert_eq!(refused.unwrap_err().to_string(), MILESTONE_NOT_FOUND);
        }
        assert_eq!(
            add(&p.conn, &nobody, &fields("X", 1, "advance", None))
                .unwrap_err()
                .to_string(),
            COMMITMENT_NOT_FOUND
        );
    }

    #[test]
    fn a_plan_holds_at_most_one_hundred_percent_and_a_change_counts_its_new_share_only() {
        let p = a_plan();
        let first = add(&p.conn, &p.quote, &fields("A", 7_000, "advance", None)).unwrap();
        add(&p.conn, &p.quote, &fields("B", 3_000, "stage_closed", None))
            .expect("exactly 100 % fits");

        let refused = add(&p.conn, &p.quote, &fields("C", 1, "stage_started", None)).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "That would put 100.01 % of the commitment in its payment plan, and a plan holds at most 100 %."
        );
        let refused = update(&p.conn, &first, |mut m| {
            m.share_bp = 7_050;
            m
        })
        .unwrap_err();
        assert_eq!(refused.to_string(), over_whole(10_050));
        assert!(refused.to_string().contains("100.5 %"));
        update(&p.conn, &first, |mut m| {
            m.share_bp = 6_000;
            m
        })
        .expect("its own old share is not counted twice");
        assert_eq!(
            plan_of(&p.conn).iter().map(|m| m.2).sum::<i64>(),
            9_000,
            "10 % is not in the plan yet"
        );
        assert_eq!(percent(3_000), "30 %");
        assert_eq!(percent(3_050), "30.5 %");
        assert_eq!(percent(1), "0.01 %");
    }

    #[test]
    fn a_trigger_and_its_activity_agree_and_the_activity_is_of_the_commitment_s_stage() {
        let p = a_plan();
        let other = add_stage(&p.conn, "Painting").unwrap();
        let paint = add_activity(&p.conn, &other, "Paint the walls").unwrap();

        for (m, sentence) in [
            (
                fields("X", 1, "activity_finished", None),
                ACTIVITY_NEEDED.to_string(),
            ),
            (
                fields("X", 1, "stage_closed", Some(&p.lay)),
                ACTIVITY_NOT_WANTED.to_string(),
            ),
            (
                fields("X", 1, "advance", Some(&p.lay)),
                ACTIVITY_NOT_WANTED.to_string(),
            ),
            (
                fields("X", 1, "activity_finished", Some(&paint)),
                ACTIVITY_OF_ANOTHER_STAGE.to_string(),
            ),
            (
                fields("X", 1, "activity_finished", Some(&new_id())),
                ACTIVITY_NOT_FOUND.to_string(),
            ),
        ] {
            let refused = add(&p.conn, &p.quote, &m).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{m:?}");
            assert_eq!(refused.to_string(), sentence, "{m:?}");
        }

        let laid = add(
            &p.conn,
            &p.quote,
            &fields("Laid", 4_000, "activity_finished", Some(&p.lay)),
        )
        .unwrap();
        let refused = update(&p.conn, &laid, |mut m| {
            m.trigger = "stage_closed".into();
            m
        })
        .unwrap_err();
        assert_eq!(
            refused.to_string(),
            ACTIVITY_NOT_WANTED,
            "moving off the trigger takes the activity with it, or is refused"
        );
        update(&p.conn, &laid, |mut m| {
            m.activity_id = Some(p.prepare.clone());
            m
        })
        .expect("another activity of the same stage");
        assert_eq!(plan_of(&p.conn)[0].4.as_deref(), Some(p.prepare.as_str()));
    }

    /// The plan is fixed from the first payment, and a reversal — which names
    /// the commitment too — does not unfix it.
    #[test]
    fn a_plan_is_fixed_from_the_first_payment_and_a_reversal_leaves_it_fixed() {
        let p = a_plan();
        let advance = add(
            &p.conn,
            &p.quote,
            &fields("Advance", 3_000, "advance", None),
        )
        .unwrap();
        let seq = pay(&p, 30_000);

        let check_locked = |p: &Plan| {
            for refused in [
                add(&p.conn, &p.quote, &fields("More", 1, "stage_closed", None)).map(|_| ()),
                update(&p.conn, &advance, |mut m| {
                    m.share_bp = 2_000;
                    m
                }),
                move_one(&p.conn, &advance, Direction::Down),
                remove(&p.conn, &advance),
                add_usual(&p.conn, &p.quote, ["a", "b", "c"]),
            ] {
                let error = refused.unwrap_err();
                assert_eq!(error.kind(), "invalid_input");
                assert_eq!(error.to_string(), PLAN_LOCKED);
            }
        };
        check_locked(&p);

        payments::reverse(&p.conn, seq, "Paid by mistake.", "2026-10-06", "x").unwrap();
        check_locked(&p);
        assert_eq!(plan_of(&p.conn).len(), 1, "nothing moved");
        assert!(snapshot(&p.conn).unwrap().commitments[0].locked);
        assert_eq!(
            remove_commitment(&p.conn, &p.quote)
                .unwrap_err()
                .to_string(),
            COMMITMENT_LOCKED
        );
    }

    /// A closed stage takes milestones (money is not a plan edit), and so does
    /// an approved plan.
    #[test]
    fn a_closed_stage_or_an_approved_plan_does_not_refuse_a_milestone() {
        let p = a_plan();
        crate::db::checks::start(&p.conn, &p.stage).unwrap();
        crate::db::checks::close(&p.conn, &p.stage).unwrap();
        p.conn
            .execute(
                "UPDATE work SET approved_at = '2026-09-25T12:00:00.000Z'",
                [],
            )
            .unwrap();

        let m = add(
            &p.conn,
            &p.quote,
            &fields("Advance", 3_000, "advance", None),
        )
        .unwrap();
        update(&p.conn, &m, |mut m| {
            m.share_bp = 2_500;
            m
        })
        .unwrap();
        remove(&p.conn, &m).unwrap();
        add_usual(&p.conn, &p.quote, ["Start", "Laid", "Closed"]).unwrap();
        assert_eq!(plan_of(&p.conn).len(), 3);
    }

    #[test]
    fn the_usual_plan_is_thirty_forty_thirty_on_the_last_activity_and_only_on_a_commitment_with_none(
    ) {
        let p = a_plan();
        add_usual(
            &p.conn,
            &p.quote,
            ["Stage started", "Last activity finished", "Stage closed"],
        )
        .unwrap();
        assert_eq!(
            plan_of(&p.conn),
            vec![
                (
                    1,
                    "Stage started".into(),
                    3_000,
                    "stage_started".into(),
                    None
                ),
                (
                    2,
                    "Last activity finished".into(),
                    4_000,
                    "activity_finished".into(),
                    Some(p.lay.clone())
                ),
                (3, "Stage closed".into(), 3_000, "stage_closed".into(), None),
            ],
            "the last activity by position"
        );
        assert_eq!(
            add_usual(&p.conn, &p.quote, ["a", "b", "c"])
                .unwrap_err()
                .to_string(),
            PLAN_ALREADY_THERE
        );

        let empty = add_stage(&p.conn, "Painting").unwrap();
        let quote = add_commitment(
            &p.conn,
            &empty,
            &CommitmentFields {
                person_id: None,
                label: "Painter's quote".into(),
                amount_cents: 1,
                agreed_on: "2026-10-01".into(),
                document_hash: None,
            },
        )
        .unwrap();
        assert_eq!(
            add_usual(&p.conn, &quote, ["a", "b", "c"])
                .unwrap_err()
                .to_string(),
            NO_ACTIVITY_FOR_THE_USUAL_PLAN
        );
        assert!(snapshot(&p.conn).unwrap().commitments[1]
            .milestones
            .is_empty());
    }

    /// A milestone goes with its commitment, and a commitment with its stage
    /// while unpaid — activities and all, in one statement.
    #[test]
    fn a_milestone_goes_with_its_commitment_and_an_activity_it_names_is_not_removed() {
        let p = a_plan();
        add_usual(&p.conn, &p.quote, ["a", "b", "c"]).unwrap();

        let refused = remove_activity(&p.conn, &p.lay).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), ACTIVITY_EARNS_A_MILESTONE);
        remove_activity(&p.conn, &p.prepare).expect("an activity no milestone names");

        remove_commitment(&p.conn, &p.quote).unwrap();
        let left: i64 = p
            .conn
            .query_row("SELECT count(*) FROM payment_milestone", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "cascaded with the commitment");

        let q = a_plan();
        add_usual(&q.conn, &q.quote, ["a", "b", "c"]).unwrap();
        remove_stage(&q.conn, &q.stage).expect("the stage, its activities, its quote and plan");
        let left: i64 = q
            .conn
            .query_row("SELECT count(*) FROM payment_milestone", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        assert!(q
            .conn
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
    }

    fn raw(conn: &Connection, sql: &str) -> rusqlite::Result<usize> {
        conn.execute(sql, [])
    }

    /// The rules are the schema's as well as the host's.
    #[test]
    fn the_schema_refuses_what_the_host_refuses() {
        let p = a_plan();
        let other = add_stage(&p.conn, "Painting").unwrap();
        let paint = add_activity(&p.conn, &other, "Paint").unwrap();
        let (quote, lay) = (&p.quote, &p.lay);
        let row = |id: &str, position: i64, share: &str, trigger: &str, activity: &str| {
            format!(
                "INSERT INTO payment_milestone
                   (id, commitment_id, position, label, share_bp, trigger, activity_id, created_at)
                 VALUES ('{id}', '{quote}', {position}, 'X', {share}, '{trigger}', {activity}, 't')"
            )
        };
        let a = "00000000-0000-7000-8000-0000000000a1";
        let b = "00000000-0000-7000-8000-0000000000a2";

        for (case, sql, message) in [
            ("a share of 0", row(a, 1, "0", "advance", "NULL"), "CHECK"),
            (
                // A BEFORE trigger runs ahead of the CHECK: the sum says it.
                "a share over 100 %",
                row(a, 1, "10001", "advance", "NULL"),
                "money: payment plan over 100 %",
            ),
            (
                "a fractional share",
                row(a, 1, "30.5", "advance", "NULL"),
                "CHECK",
            ),
            (
                "a trigger that is not one",
                row(a, 1, "1", "monday", "NULL"),
                "CHECK",
            ),
            (
                "activity_finished with no activity",
                row(a, 1, "1", "activity_finished", "NULL"),
                "CHECK",
            ),
            (
                "an activity on another trigger",
                row(a, 1, "1", "advance", &format!("'{lay}'")),
                "CHECK",
            ),
            (
                "an activity of another stage",
                row(a, 1, "1", "activity_finished", &format!("'{paint}'")),
                "money: milestone activity",
            ),
        ] {
            let refused = raw(&p.conn, &sql).expect_err(case);
            assert!(refused.to_string().contains(message), "{case}: {refused}");
        }

        raw(&p.conn, &row(a, 1, "6000", "advance", "NULL")).unwrap();
        let refused = raw(&p.conn, &row(b, 2, "4001", "stage_closed", "NULL")).unwrap_err();
        assert!(refused
            .to_string()
            .contains("money: payment plan over 100 %"));
        let refused = raw(&p.conn, &row(b, 1, "1", "stage_closed", "NULL")).unwrap_err();
        assert!(refused.to_string().contains("UNIQUE"), "one position, once");
        raw(&p.conn, &row(b, 2, "3000", "stage_closed", "NULL")).unwrap();
        let refused = raw(
            &p.conn,
            &format!("UPDATE payment_milestone SET share_bp = 7001 WHERE id = '{a}'"),
        )
        .unwrap_err();
        assert!(refused
            .to_string()
            .contains("money: payment plan over 100 %"));

        pay(&p, 1);
        for sql in [
            format!("UPDATE payment_milestone SET label = 'Y' WHERE id = '{a}'"),
            format!("UPDATE payment_milestone SET position = 9 WHERE id = '{b}'"),
            format!("DELETE FROM payment_milestone WHERE id = '{a}'"),
            "DELETE FROM payment_milestone".to_string(),
            row(
                "00000000-0000-7000-8000-0000000000a3",
                3,
                "1",
                "stage_started",
                "NULL",
            ),
        ] {
            let refused = raw(&p.conn, &sql).expect_err(&sql);
            assert!(
                refused.to_string().contains("money: payment plan locked"),
                "`{sql}`: {refused}"
            );
        }
    }
}
