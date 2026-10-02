//! The commands for a commitment's payment plan (D2): its milestones, each a
//! share of the commitment's amount earned by a fact of the work.
//!
//! A share crosses the boundary as whole basis points (`share_bp`, 3000 is
//! 30 %) and is checked here to be whole, as money is. A plan holds at most
//! 100 %; the rest is "not in the plan yet", which the domain says and never
//! assumes. What is earned, paid, due now and paid ahead is the domain's
//! (`src/domain/money/`), computed every time — nothing here stores it, and no
//! payment is refused for being ahead of the work: that is warned, not refused.
//!
//! Every command here is refused once a payment names the commitment, a
//! reversal included — a plan rewritten after paying would hide being ahead.
//! None is refused by a closed stage (money is not a plan edit) or by an
//! approved plan (a payment plan is an agreement, not what a baseline records).
//!
//! # Changelog of this boundary
//!
//! - D2: `milestone_add`, `milestone_update`, `milestone_move`,
//!   `milestone_remove`, `milestones_usual` (30 % stage started, 40 % the
//!   stage's last activity finished, 30 % stage closed — in the labels the
//!   interface sends, in the person's language).

use tauri::State;

use crate::commands::money::label;
use crate::commands::work::change_work;
use crate::contract::{MilestonePatch, UsualLabels, WorkSnapshot};
use crate::db::milestones::{self, MilestoneFields};
use crate::error::Result;
use crate::folder::OpenWork;
use crate::validate;

/// What a label is called in a sentence.
const A_MILESTONE: &str = "A milestone";

/// Add a milestone at the end of a commitment's payment plan.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a label, share or trigger that
/// does not fit; a commitment not in this work or paid against; a trigger and
/// an activity that do not agree; an activity not in this work or of another
/// stage; a plan that would hold more than 100 %; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn milestone_add(
    open: State<'_, OpenWork>,
    commitment_id: String,
    label: String,
    share_bp: f64,
    trigger: String,
    activity_id: Option<String>,
) -> Result<WorkSnapshot> {
    milestone_add_with(
        &open,
        &commitment_id,
        &label,
        share_bp,
        &trigger,
        activity_id.as_deref(),
    )
}

/// Change a milestone, while nothing is paid against its commitment.
///
/// # Errors
///
/// As [`milestone_add`], and for a milestone not in this work.
#[tauri::command(rename_all = "snake_case")]
pub fn milestone_update(
    open: State<'_, OpenWork>,
    id: String,
    patch: MilestonePatch,
) -> Result<WorkSnapshot> {
    milestone_update_with(&open, &id, &patch)
}

/// Move a milestone one step within its plan, `up` or `down`. At the edge
/// nothing moves, and that is not an error.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a direction that is neither, a
/// milestone not in this work, or one whose commitment has been paid against;
/// and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn milestone_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    milestone_move_with(&open, &id, &direction)
}

/// Remove a milestone; the ones after it close up.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a milestone not in this work, or
/// one whose commitment has been paid against; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn milestone_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    milestone_remove_with(&open, &id)
}

/// Write the usual payment plan on a commitment with none: 30 % when the
/// stage starts, 40 % when its last activity (by position) is finished, 30 %
/// when it closes — a common split, not advice — with the labels the
/// interface sends.
///
/// # Errors
///
/// [`crate::error::Error::InvalidInput`] for a label that does not fit; a
/// commitment not in this work, paid against, or with a payment plan already;
/// a stage with no activity; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn milestones_usual(
    open: State<'_, OpenWork>,
    commitment_id: String,
    labels: UsualLabels,
) -> Result<WorkSnapshot> {
    milestones_usual_with(&open, &commitment_id, &labels)
}

/// What [`milestone_add`] does once the state is in hand.
pub fn milestone_add_with(
    open: &OpenWork,
    commitment_id: &str,
    label_text: &str,
    share_bp: f64,
    trigger: &str,
    activity_id: Option<&str>,
) -> Result<WorkSnapshot> {
    let fields = MilestoneFields {
        label: label(A_MILESTONE, label_text)?,
        share_bp: validate::share_bp(share_bp)?,
        trigger: validate::milestone_trigger(trigger)?,
        activity_id: activity_id.map(str::to_string),
    };
    change_work(open, |conn| {
        milestones::add(conn, commitment_id, &fields).map(|_| ())
    })
}

/// What [`milestone_update`] does once the state is in hand.
pub fn milestone_update_with(
    open: &OpenWork,
    id: &str,
    patch: &MilestonePatch,
) -> Result<WorkSnapshot> {
    let new_label = patch
        .label
        .as_deref()
        .map(|l| label(A_MILESTONE, l))
        .transpose()?;
    let share_bp = patch.share_bp.map(validate::share_bp).transpose()?;
    let trigger = patch
        .trigger
        .as_deref()
        .map(validate::milestone_trigger)
        .transpose()?;
    change_work(open, |conn| {
        milestones::update(conn, id, |mut m| {
            if let Some(label) = new_label {
                m.label = label;
            }
            if let Some(share_bp) = share_bp {
                m.share_bp = share_bp;
            }
            if let Some(trigger) = trigger {
                m.trigger = trigger;
            }
            if let Some(activity_id) = patch.activity_id.clone() {
                m.activity_id = activity_id;
            }
            m
        })
    })
}

/// What [`milestone_move`] does once the state is in hand.
pub fn milestone_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| milestones::move_one(conn, id, direction))
}

/// What [`milestone_remove`] does once the state is in hand.
pub fn milestone_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| milestones::remove(conn, id))
}

/// What [`milestones_usual`] does once the state is in hand.
pub fn milestones_usual_with(
    open: &OpenWork,
    commitment_id: &str,
    labels: &UsualLabels,
) -> Result<WorkSnapshot> {
    let started = label(A_MILESTONE, &labels.started)?;
    let finished = label(A_MILESTONE, &labels.finished)?;
    let closed = label(A_MILESTONE, &labels.closed)?;
    change_work(open, |conn| {
        milestones::add_usual(conn, commitment_id, [&started, &finished, &closed])
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::checks::{stage_close_with, stage_start_with};
    use crate::commands::money::{
        commitment_add_with, cost_line_add_with, payment_add_with, payment_reverse_with,
        CommitmentDraft,
    };
    use crate::commands::plan::{activity_add_with, activity_remove_with, stage_add_with};
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::{with_work, work_close_with};
    use crate::contract::PaymentDraft;
    use chrono::NaiveDate;

    const AUTHOR: &str = "A. Owner (synthetic)";

    struct Tiling {
        stage: String,
        prepare: String,
        lay: String,
        quote: String,
    }

    /// The e2e's work: a stage Tiling, "Prepare the floor" and "Lay the
    /// tiles", and "Tiler's quote" of 1 000.00. Synthetic.
    fn tiling(open: &OpenWork) -> Tiling {
        let stage = stage_add_with(open, "Tiling").unwrap().stages[0].id.clone();
        let prepare = activity_add_with(open, &stage, "Prepare the floor")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let lay = activity_add_with(open, &stage, "Lay the tiles")
            .unwrap()
            .activities[1]
            .id
            .clone();
        let quote = commitment_add_with(
            open,
            &stage,
            &CommitmentDraft {
                person_id: None,
                label: "Tiler's quote",
                amount_cents: 100_000.0,
                agreed_on: "2026-10-01",
                document_path: None,
                document_hash: None,
            },
        )
        .unwrap()
        .commitments[0]
            .id
            .clone();
        Tiling {
            stage,
            prepare,
            lay,
            quote,
        }
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
    }

    fn pay(open: &OpenWork, t: &Tiling, amount: f64) -> WorkSnapshot {
        let draft: PaymentDraft = serde_json::from_value(serde_json::json!({
            "day": "2026-10-08", "stageId": t.stage, "commitmentId": t.quote,
            "amountCents": amount
        }))
        .unwrap();
        payment_add_with(open, &draft, today(), AUTHOR).unwrap()
    }

    fn usual(started: &str) -> UsualLabels {
        UsualLabels {
            started: started.into(),
            finished: "Last activity finished".into(),
            closed: "Stage closed".into(),
        }
    }

    /// The e2e in the host: the usual plan fills three; it is replaced by 30 %
    /// advance / 40 % Lay the tiles finished / 30 % stage closed; paid, the
    /// plan is fixed — and stays fixed after a reversal.
    #[test]
    fn the_usual_plan_is_replaced_by_hand_and_fixed_from_the_first_payment() {
        let (_db, open, _scratch) = host_with_a_work();
        let t = tiling(&open);

        let plan = milestones_usual_with(&open, &t.quote, &usual("  Stage started ")).unwrap();
        let wire = serde_json::to_value(&plan.commitments[0]).unwrap();
        let ids: Vec<String> = plan.commitments[0]
            .milestones
            .iter()
            .map(|m| m.id.clone())
            .collect();
        assert_eq!(
            wire["milestones"],
            serde_json::json!([
                { "id": ids[0], "position": 1, "label": "Stage started", "shareBp": 3000,
                  "trigger": "stage_started", "activityId": null },
                { "id": ids[1], "position": 2, "label": "Last activity finished", "shareBp": 4000,
                  "trigger": "activity_finished", "activityId": t.lay },
                { "id": ids[2], "position": 3, "label": "Stage closed", "shareBp": 3000,
                  "trigger": "stage_closed", "activityId": null },
            ]),
            "labels trimmed; the last activity by position"
        );

        for id in &ids {
            milestone_remove_with(&open, id).unwrap();
        }
        milestone_add_with(&open, &t.quote, "Advance", 3_000.0, "advance", None).unwrap();
        milestone_add_with(
            &open,
            &t.quote,
            "Tiles laid",
            4_000.0,
            "activity_finished",
            Some(&t.lay),
        )
        .unwrap();
        let plan =
            milestone_add_with(&open, &t.quote, "Handover", 3_000.0, "stage_closed", None).unwrap();
        let shares: Vec<(i64, &str)> = plan.commitments[0]
            .milestones
            .iter()
            .map(|m| (m.share_bp, m.trigger.as_str()))
            .collect();
        assert_eq!(
            shares,
            vec![
                (3_000, "advance"),
                (4_000, "activity_finished"),
                (3_000, "stage_closed")
            ]
        );
        let advance = plan.commitments[0].milestones[0].id.clone();

        let plan = pay(&open, &t, 30_000.0);
        assert!(plan.commitments[0].locked);
        let patch: MilestonePatch =
            serde_json::from_value(serde_json::json!({ "shareBp": 2000 })).unwrap();
        let locked = |open: &OpenWork| {
            for refused in [
                milestone_update_with(open, &advance, &patch),
                milestone_move_with(open, &advance, "down"),
                milestone_remove_with(open, &advance),
                milestone_add_with(open, &t.quote, "More", 1.0, "stage_started", None),
                milestones_usual_with(open, &t.quote, &usual("x")),
            ] {
                let error = refused.unwrap_err();
                assert_eq!(error.kind(), "invalid_input");
                assert_eq!(error.to_string(), milestones::PLAN_LOCKED);
            }
        };
        locked(&open);
        payment_reverse_with(&open, 1, "Paid by mistake.", today(), AUTHOR).unwrap();
        locked(&open);
        work_close_with(&open);
    }

    #[test]
    fn a_patch_changes_what_it_names_and_leaves_the_rest() {
        let (_db, open, _scratch) = host_with_a_work();
        let t = tiling(&open);
        let plan = milestone_add_with(
            &open,
            &t.quote,
            "Tiles laid",
            4_000.0,
            "activity_finished",
            Some(&t.lay),
        )
        .unwrap();
        let id = plan.commitments[0].milestones[0].id.clone();

        let patch: MilestonePatch = serde_json::from_value(serde_json::json!({
            "label": "Floor ready", "activityId": t.prepare
        }))
        .unwrap();
        let m = milestone_update_with(&open, &id, &patch)
            .unwrap()
            .commitments[0]
            .milestones[0]
            .clone();
        assert_eq!(
            (m.label.as_str(), m.share_bp, m.trigger.as_str()),
            ("Floor ready", 4_000, "activity_finished")
        );
        assert_eq!(m.activity_id.as_deref(), Some(t.prepare.as_str()));

        let half: MilestonePatch =
            serde_json::from_value(serde_json::json!({ "trigger": "stage_closed" })).unwrap();
        assert_eq!(
            milestone_update_with(&open, &id, &half)
                .unwrap_err()
                .to_string(),
            milestones::ACTIVITY_NOT_WANTED
        );
        let whole: MilestonePatch = serde_json::from_value(serde_json::json!({
            "trigger": "stage_closed", "activityId": null, "shareBp": 10000
        }))
        .unwrap();
        let m = milestone_update_with(&open, &id, &whole)
            .unwrap()
            .commitments[0]
            .milestones[0]
            .clone();
        assert_eq!(
            (m.share_bp, m.trigger.as_str(), m.activity_id),
            (10_000, "stage_closed", None)
        );
        work_close_with(&open);
    }

    #[test]
    fn a_share_a_trigger_a_label_or_a_direction_that_does_not_fit_is_refused_with_a_sentence() {
        let (_db, open, _scratch) = host_with_a_work();
        let t = tiling(&open);
        let long = "m".repeat(121);

        for (share, trigger, text, sentence) in [
            (0.0, "advance", "A", validate::SHARE_BP_RANGE.to_string()),
            (
                -3_000.0,
                "advance",
                "A",
                validate::SHARE_BP_RANGE.to_string(),
            ),
            (
                10_001.0,
                "advance",
                "A",
                validate::SHARE_BP_RANGE.to_string(),
            ),
            (
                3_000.5,
                "advance",
                "A",
                validate::SHARE_BP_RANGE.to_string(),
            ),
            (
                f64::NAN,
                "advance",
                "A",
                validate::SHARE_BP_RANGE.to_string(),
            ),
            (1.0, "on_monday", "A", validate::TRIGGER_UNKNOWN.to_string()),
            (1.0, "Advance", "A", validate::TRIGGER_UNKNOWN.to_string()),
            (
                1.0,
                "advance",
                "  ",
                "A milestone needs a label.".to_string(),
            ),
            (
                1.0,
                "advance",
                &long,
                "A milestone's label is at most 120 characters.".to_string(),
            ),
        ] {
            let refused =
                milestone_add_with(&open, &t.quote, text, share, trigger, None).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{share} {trigger}");
            assert_eq!(refused.to_string(), sentence, "{share} {trigger}");
        }
        let plan = milestone_add_with(&open, &t.quote, "All", 10_000.0, "advance", None).unwrap();
        let id = plan.commitments[0].milestones[0].id.clone();
        assert_eq!(
            milestone_move_with(&open, &id, "sideways")
                .unwrap_err()
                .to_string(),
            "A move is up or down."
        );
        let over = milestone_add_with(&open, &t.quote, "More", 1.0, "stage_closed", None)
            .unwrap_err()
            .to_string();
        assert_eq!(over, milestones::over_whole(10_001));
        assert_eq!(
            milestones_usual_with(&open, &t.quote, &usual(""))
                .unwrap_err()
                .to_string(),
            "A milestone needs a label."
        );
        work_close_with(&open);
    }

    /// A closed stage takes a payment plan, and an approved plan too: a
    /// payment plan is money, and an agreement — not a plan edit.
    #[test]
    fn a_closed_stage_and_an_approved_plan_still_take_a_payment_plan() {
        let (_db, open, _scratch) = host_with_a_work();
        let t = tiling(&open);
        stage_start_with(&open, &t.stage).unwrap();
        stage_close_with(&open, &t.stage).unwrap();
        with_work(&open, |state| {
            state.conn.execute(
                "UPDATE work SET approved_at = '2026-10-02T12:00:00.000Z'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        assert_eq!(
            cost_line_add_with(&open, &t.stage, None, "Tiles", Some(1.0))
                .unwrap_err()
                .kind(),
            "plan_approved",
            "the plan is approved and locked"
        );

        let plan = milestones_usual_with(&open, &t.quote, &usual("Start")).unwrap();
        assert_eq!(plan.commitments[0].milestones.len(), 3);
        let id = plan.commitments[0].milestones[2].id.clone();
        milestone_move_with(&open, &id, "up").unwrap();
        milestone_remove_with(&open, &id).unwrap();
        work_close_with(&open);
    }

    #[test]
    fn an_activity_a_milestone_is_earned_by_is_not_removed_and_a_commitment_takes_its_plan() {
        let (_db, open, _scratch) = host_with_a_work();
        let t = tiling(&open);
        milestones_usual_with(&open, &t.quote, &usual("Start")).unwrap();

        let refused = activity_remove_with(&open, &t.lay).unwrap_err();
        assert_eq!(refused.to_string(), milestones::ACTIVITY_EARNS_A_MILESTONE);
        let plan = change_work(&open, |conn| {
            crate::db::money::remove_commitment(conn, &t.quote)
        })
        .unwrap();
        assert!(plan.commitments.is_empty());
        activity_remove_with(&open, &t.lay).expect("no milestone names it now");
        work_close_with(&open);
    }

    #[test]
    fn milestone_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        let id = crate::db::new_id();
        for refused in [
            milestone_add_with(&open, &id, "A", 1.0, "advance", None),
            milestone_remove_with(&open, &id),
            milestone_move_with(&open, &id, "up"),
            milestones_usual_with(&open, &id, &usual("A")),
        ] {
            assert_eq!(refused.unwrap_err().kind(), "no_work_open");
        }
    }
}
