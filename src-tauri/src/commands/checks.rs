//! The commands for checks and gates: edit a stage's checks, answer them,
//! start, close and reopen the stage.
//!
//! An answer is a fact — appended, never rewritten; the latest counts — and may
//! carry a photo (the inspection), copied in by the same pipeline, under the
//! same caps, into the same folder as the diary's photos. `na` always carries
//! its reason. Every command returns the whole plan: answers are few, and they
//! live in the snapshot.
//!
//! # Changelog of this boundary
//!
//! - F5: `check_add`, `check_rename`, `check_move`, `check_remove`,
//!   `checks_add_defaults`, `check_answer`, `stage_start`, `stage_close`,
//!   `stage_reopen`.

use std::path::PathBuf;

use rusqlite::Connection;
use tauri::State;

use crate::commands::documents::file_it;
use crate::commands::work::{change_work, with_work};
use crate::contract::{DocumentTarget, WorkSnapshot};
use crate::db::check_answers::{self, NewAnswer, CHECK_NOT_FOUND};
use crate::db::checks::{self, Gate};
use crate::db::order::CHECKS;
use crate::db::work::{self as repo, exists};
use crate::error::{Error, Result};
use crate::files::intake::{self, Accept, CopyIn, NOT_A_PHOTO};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The longest question a check keeps.
pub const MAX_CHECK_NAME_CHARS: usize = 200;

/// The longest reason an answer keeps.
pub const MAX_REASON_CHARS: usize = 500;

/// Add a check at the end of a stage's gate.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a gate that is not `start` or `close`, a name
/// that does not fit, or a stage not in this work; [`Error::StageClosed`] for a
/// closed stage; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn check_add(
    open: State<'_, OpenWork>,
    stage_id: String,
    gate: String,
    name: String,
) -> Result<WorkSnapshot> {
    check_add_with(&open, &stage_id, &gate, &name)
}

/// Rename a check — allowed when it has answers.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that does not fit or a check not in this
/// work; [`Error::StageClosed`] for a closed stage; and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn check_rename(open: State<'_, OpenWork>, id: String, name: String) -> Result<WorkSnapshot> {
    check_rename_with(&open, &id, &name)
}

/// Move a check one step within its gate, `up` or `down`. At the edge nothing
/// moves, and that is not an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a direction that is neither or a check not in
/// this work; [`Error::StageClosed`] for a closed stage; and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn check_move(
    open: State<'_, OpenWork>,
    id: String,
    direction: String,
) -> Result<WorkSnapshot> {
    check_move_with(&open, &id, &direction)
}

/// Remove a check that has never been answered.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a check not in this work or one with answers;
/// [`Error::StageClosed`] for a closed stage; and the errors of every work
/// command.
#[tauri::command(rename_all = "snake_case")]
pub fn check_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    check_remove_with(&open, &id)
}

/// Add the usual checks to a stage, in the names the interface put in the
/// person's language; any a gate already has, by name, is skipped.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that does not fit or a stage not in this
/// work; [`Error::StageClosed`] for a closed stage; and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn checks_add_defaults(
    open: State<'_, OpenWork>,
    stage_id: String,
    start: Vec<String>,
    close: Vec<String>,
) -> Result<WorkSnapshot> {
    checks_add_defaults_with(&open, &stage_id, &start, &close)
}

/// Answer a check: `yes`, `no`, or `na` with its reason; with a photo copied
/// in (`photo_path`) or one the work already holds (`photo_hash`), or none.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an answer that is not one of the three, `na`
/// without a reason, a reason that does not fit, both a path and a hash, a
/// relative path, a hash that names no photo of this work, or a check not in
/// this work; [`Error::PhotoRefused`] for a photo refused under the caps
/// (nothing is written); and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn check_answer(
    open: State<'_, OpenWork>,
    check_id: String,
    answer: String,
    reason: Option<String>,
    photo_path: Option<String>,
    photo_hash: Option<String>,
) -> Result<WorkSnapshot> {
    check_answer_with(
        &open,
        &AnswerDraft {
            check_id: &check_id,
            answer: &answer,
            reason: reason.as_deref(),
            photo_path: photo_path.as_deref(),
            photo_hash: photo_hash.as_deref(),
        },
        &account::display_name(),
    )
}

/// Start a stage, once its start gate is passed. Not undone.
///
/// # Errors
///
/// [`Error::StageGateOpen`] naming the items that hold the gate;
/// [`Error::InvalidInput`] for a stage not in this work or already started;
/// and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_start(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    stage_start_with(&open, &id)
}

/// Close a started stage, once its close gate is passed.
///
/// # Errors
///
/// [`Error::StageGateOpen`] naming the items that hold the gate;
/// [`Error::InvalidInput`] for a stage not in this work, not started, or
/// already closed; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_close(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    stage_close_with(&open, &id)
}

/// Reopen a closed stage.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage not in this work or not closed; and the
/// errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn stage_reopen(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    stage_reopen_with(&open, &id)
}

/// What [`stage_start`] does once the state is in hand.
pub fn stage_start_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| checks::start(conn, id))
}

/// What [`stage_close`] does once the state is in hand.
pub fn stage_close_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| checks::close(conn, id))
}

/// What [`stage_reopen`] does once the state is in hand.
pub fn stage_reopen_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| checks::reopen(conn, id))
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

fn gate(value: &str) -> Result<Gate> {
    match value {
        "start" => Ok(Gate::Start),
        "close" => Ok(Gate::Close),
        _ => Err(invalid(
            "A check belongs to the start gate or the close gate.",
        )),
    }
}

/// A check's question: trimmed, not empty, at most 200 characters.
fn check_name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid("A check needs a question."));
    }
    if value.chars().count() > MAX_CHECK_NAME_CHARS {
        return Err(invalid(format!(
            "A check's question is at most {MAX_CHECK_NAME_CHARS} characters."
        )));
    }
    Ok(value.to_string())
}

/// What [`check_add`] does once the state is in hand.
pub fn check_add_with(
    open: &OpenWork,
    stage_id: &str,
    gate_word: &str,
    name: &str,
) -> Result<WorkSnapshot> {
    let gate = gate(gate_word)?;
    let name = check_name(name)?;
    change_work(open, |conn| {
        checks::add(conn, stage_id, gate, &name).map(|_| ())
    })
}

/// What [`check_rename`] does once the state is in hand.
pub fn check_rename_with(open: &OpenWork, id: &str, name: &str) -> Result<WorkSnapshot> {
    let name = check_name(name)?;
    change_work(open, |conn| checks::rename(conn, id, &name))
}

/// What [`check_move`] does once the state is in hand.
pub fn check_move_with(open: &OpenWork, id: &str, direction: &str) -> Result<WorkSnapshot> {
    let direction = validate::direction(direction)?;
    change_work(open, |conn| {
        checks::refuse_if_check_closed(conn, id)?;
        CHECKS.move_one(conn, id, direction)
    })
}

/// What [`check_remove`] does once the state is in hand.
pub fn check_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    change_work(open, |conn| checks::remove(conn, id))
}

/// What [`checks_add_defaults`] does once the state is in hand.
pub fn checks_add_defaults_with(
    open: &OpenWork,
    stage_id: &str,
    start: &[String],
    close: &[String],
) -> Result<WorkSnapshot> {
    let start = start
        .iter()
        .map(|name| check_name(name))
        .collect::<Result<Vec<_>>>()?;
    let close = close
        .iter()
        .map(|name| check_name(name))
        .collect::<Result<Vec<_>>>()?;
    change_work(open, |conn| {
        checks::add_defaults(conn, stage_id, &start, &close)
    })
}

/// An answer as the interface sent it.
pub struct AnswerDraft<'a> {
    /// The check.
    pub check_id: &'a str,
    /// `yes`, `no` or `na`.
    pub answer: &'a str,
    /// Why.
    pub reason: Option<&'a str>,
    /// A photo to copy in.
    pub photo_path: Option<&'a str>,
    /// A photo the work already holds.
    pub photo_hash: Option<&'a str>,
}

/// What [`check_answer`] does once the state and the author are in hand.
pub fn check_answer_with(
    open: &OpenWork,
    draft: &AnswerDraft<'_>,
    author: &str,
) -> Result<WorkSnapshot> {
    if !matches!(draft.answer, "yes" | "no" | "na") {
        return Err(invalid("An answer is yes, no, or not applicable."));
    }
    let reason = match draft.reason.map(str::trim).filter(|r| !r.is_empty()) {
        None => None,
        Some(reason) => {
            if reason.chars().count() > MAX_REASON_CHARS {
                return Err(invalid(format!(
                    "A reason is at most {MAX_REASON_CHARS} characters."
                )));
            }
            if reason
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
            {
                return Err(invalid(
                    "A reason holds a control character that cannot be kept.",
                ));
            }
            Some(reason.to_string())
        }
    };
    if draft.answer == "na" && reason.is_none() {
        return Err(invalid("Not applicable always carries its reason."));
    }
    let path = match draft.photo_path {
        Some(_) if draft.photo_hash.is_some() => {
            return Err(invalid("An answer carries one photo."));
        }
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err(invalid("A photo is chosen by its full path."));
            }
            Some(path)
        }
        None => None,
    };
    if let Some(hash) = draft.photo_hash {
        if !intake::is_hash(hash) {
            return Err(invalid(NOT_A_PHOTO));
        }
    }

    with_work(open, |state| {
        let conn: &Connection = &state.conn;
        // The check first: a photo is not copied in for a check that is not there.
        if !exists(
            conn,
            "SELECT 1 FROM stage_check WHERE id = ?1",
            draft.check_id,
        )? {
            return Err(invalid(CHECK_NOT_FOUND));
        }
        // Dropped without `keep`, the copy-in removes every file it wrote.
        let mut copy = CopyIn::new(&state.folder);
        let mut brought = None;
        let photo_hash = match (&path, draft.photo_hash) {
            (Some(path), _) => {
                let copied = copy.copy(path, Accept::Images)?;
                let hash = copied.hash.clone();
                brought = Some(copied);
                Some(hash)
            }
            (None, Some(hash)) => {
                if intake::original(&state.folder, hash).is_none() {
                    return Err(invalid(NOT_A_PHOTO));
                }
                Some(hash.to_string())
            }
            (None, None) => None,
        };
        check_answers::append(
            conn,
            &NewAnswer {
                check_id: draft.check_id.to_string(),
                answer: draft.answer.to_string(),
                reason: reason.clone(),
                photo_hash: photo_hash.clone(),
                author_name: author.to_string(),
            },
        )?;
        copy.keep();
        // The inspection's photo is a document of the work, linked to the
        // check's stage (F7).
        if let Some(hash) = &photo_hash {
            let stage: String = conn.query_row(
                "SELECT stage_id FROM stage_check WHERE id = ?1",
                [draft.check_id],
                |row| row.get(0),
            )?;
            let today = chrono::Local::now()
                .date_naive()
                .format("%Y-%m-%d")
                .to_string();
            file_it(
                conn,
                hash,
                brought.as_ref(),
                "photo",
                &today,
                author,
                &DocumentTarget {
                    target_kind: "stage".into(),
                    target_id: stage,
                },
            );
        }
        repo::snapshot(conn)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::plan::{activity_add_with, activity_move_with, stage_add_with};
    use crate::commands::schedule::dependency_add_with;
    use crate::commands::work::tests::host_with_a_work;
    use crate::commands::work::work_close_with;
    use crate::contract::Endpoint;
    use crate::db::lock;
    use crate::db::testing::Scratch;
    use crate::files::intake::tests::{hostile_corpus, png};

    const AUTHOR: &str = "A. Inspector (synthetic)";

    fn answer<'a>(check_id: &'a str, answer: &'a str) -> AnswerDraft<'a> {
        AnswerDraft {
            check_id,
            answer,
            reason: None,
            photo_path: None,
            photo_hash: None,
        }
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

    #[test]
    fn the_usual_checks_then_answers_then_start_and_close_each_return_the_plan() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();

        let plan = checks_add_defaults_with(
            &open,
            &stage,
            &[
                "The materials are on site".into(),
                " The area is clear ".into(),
            ],
            &["The work was inspected".into()],
        )
        .unwrap();
        let wire = serde_json::to_value(&plan.checks[1]).unwrap();
        assert_eq!(wire["gate"], "start");
        assert_eq!(wire["name"], "The area is clear");
        assert_eq!(wire["position"], 2);
        let ids: Vec<String> = plan.checks.iter().map(|c| c.id.clone()).collect();

        let refused = stage_close_with(&open, &stage).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "A stage is started before it is closed."
        );
        let refused = stage_start_with(&open, &stage).unwrap_err();
        assert_eq!(refused.kind(), "stage_gate_open");
        assert_eq!(
            refused.to_string(),
            "2 items hold the start gate: The materials are on site (not answered); The area is clear (not answered)."
        );

        check_answer_with(&open, &answer(&ids[0], "yes"), AUTHOR).unwrap();
        let refused = check_answer_with(&open, &answer(&ids[1], "na"), AUTHOR).unwrap_err();
        assert_eq!(
            refused.to_string(),
            "Not applicable always carries its reason."
        );
        let plan = check_answer_with(
            &open,
            &AnswerDraft {
                reason: Some("The room was already empty."),
                ..answer(&ids[1], "na")
            },
            AUTHOR,
        )
        .unwrap();
        let wire = serde_json::to_value(&plan.check_answers[1]).unwrap();
        assert_eq!(wire["answer"], "na");
        assert_eq!(wire["reason"], "The room was already empty.");
        assert_eq!(wire["authorName"], AUTHOR);
        assert_eq!(wire["seq"], 1);
        assert_eq!(wire["photoHash"], serde_json::Value::Null);

        let plan = stage_start_with(&open, &stage).unwrap();
        assert!(plan.stages[0].started_at.is_some());
        check_answer_with(&open, &answer(&ids[2], "yes"), AUTHOR).unwrap();
        let plan = stage_close_with(&open, &stage).unwrap();
        let wire = serde_json::to_value(&plan.stages[0]).unwrap();
        assert!(wire["startedAt"].is_string() && wire["closedAt"].is_string());

        let plan = stage_reopen_with(&open, &stage).unwrap();
        assert_eq!(plan.stages[0].closed_at, None);
        work_close_with(&open);
    }

    /// The inspection is a check with a photo: copied in, by hash, with its
    /// thumbnail, exactly as a diary photo is.
    #[test]
    fn an_answer_with_a_photo_copies_it_in_and_a_hostile_one_refuses_the_answer() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let check = check_add_with(&open, &stage, "close", "The work was inspected")
            .unwrap()
            .checks[0]
            .id
            .clone();
        let source = Scratch::create();

        let (name, bytes, words) = hostile_corpus().remove(0);
        let hostile = source.path().join(name);
        std::fs::write(&hostile, bytes).unwrap();
        let hostile_path = hostile.to_string_lossy().into_owned();
        let refused = check_answer_with(
            &open,
            &AnswerDraft {
                photo_path: Some(&hostile_path),
                ..answer(&check, "yes")
            },
            AUTHOR,
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "photo_refused");
        assert!(refused.to_string().contains(name) && refused.to_string().contains(words));
        assert!(crate::commands::work::work_get_with(&open)
            .unwrap()
            .check_answers
            .is_empty());
        assert_eq!(
            folder_entries(&open),
            Vec::<String>::new(),
            "nothing written"
        );

        let good = source.path().join("inspection.png");
        let png_bytes = png(800, 600);
        std::fs::write(&good, &png_bytes).unwrap();
        let good_path = good.to_string_lossy().into_owned();
        let plan = check_answer_with(
            &open,
            &AnswerDraft {
                photo_path: Some(&good_path),
                ..answer(&check, "yes")
            },
            AUTHOR,
        )
        .unwrap();

        let hash = intake::sha256_hex(&png_bytes);
        assert_eq!(
            plan.check_answers[0].photo_hash.as_deref(),
            Some(hash.as_str())
        );
        assert_eq!(folder_entries(&open), vec!["documents", "thumbnails"]);
        let url = with_work(&open, |state| {
            intake::thumbnail_data_url(&state.folder, &hash)
        })
        .unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));

        let plan = check_answer_with(
            &open,
            &AnswerDraft {
                photo_hash: Some(&hash),
                ..answer(&check, "yes")
            },
            AUTHOR,
        )
        .unwrap();
        assert_eq!(
            plan.check_answers[1].seq, 2,
            "re-answered with the same photo, by hash"
        );
        let unknown = "ab".repeat(32);
        let refused = check_answer_with(
            &open,
            &AnswerDraft {
                photo_hash: Some(&unknown),
                ..answer(&check, "yes")
            },
            AUTHOR,
        )
        .unwrap_err();
        assert_eq!(refused.to_string(), NOT_A_PHOTO);
        work_close_with(&open);
    }

    #[test]
    fn an_answer_that_does_not_fit_is_refused_before_anything_is_written() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let check = check_add_with(&open, &stage, "start", "On site")
            .unwrap()
            .checks[0]
            .id
            .clone();
        let long = "r".repeat(501);
        let hash = "ab".repeat(32);

        for draft in [
            answer(&check, "maybe"),
            AnswerDraft {
                reason: Some("   "),
                ..answer(&check, "na")
            },
            AnswerDraft {
                reason: Some(&long),
                ..answer(&check, "no")
            },
            AnswerDraft {
                reason: Some("a\u{1E}b"),
                ..answer(&check, "no")
            },
            AnswerDraft {
                photo_path: Some("relative.png"),
                ..answer(&check, "yes")
            },
            AnswerDraft {
                photo_path: Some("C:/x.png"),
                photo_hash: Some(&hash),
                ..answer(&check, "yes")
            },
            AnswerDraft {
                photo_hash: Some(".."),
                ..answer(&check, "yes")
            },
            answer("00000000-0000-7000-8000-000000000000", "yes"),
        ] {
            let refused = check_answer_with(&open, &draft, AUTHOR).unwrap_err();
            assert_eq!(
                refused.kind(),
                "invalid_input",
                "{}: {refused}",
                draft.answer
            );
        }
        for (gate_word, name) in [
            ("middle", "X"),
            ("start", " "),
            ("close", &"q".repeat(201)[..]),
        ] {
            assert_eq!(
                check_add_with(&open, &stage, gate_word, name)
                    .unwrap_err()
                    .kind(),
                "invalid_input"
            );
        }
        let plan = crate::commands::work::work_get_with(&open).unwrap();
        assert!(plan.check_answers.is_empty());
        assert_eq!(plan.checks.len(), 1);
        work_close_with(&open);
    }

    /// A closed stage is not made to wait for anything, and its rows do not
    /// move; it may still be what something else waits for.
    #[test]
    fn a_closed_stage_refuses_a_dependency_onto_it_and_moves_but_can_be_waited_for() {
        let (_db, open, _scratch) = host_with_a_work();
        let tiling = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let painting = stage_add_with(&open, "Painting").unwrap().stages[1]
            .id
            .clone();
        let tile = activity_add_with(&open, &tiling, "Tile")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let grout = activity_add_with(&open, &tiling, "Grout")
            .unwrap()
            .activities[1]
            .id
            .clone();
        let paint = activity_add_with(&open, &painting, "Paint")
            .unwrap()
            .activities
            .into_iter()
            .find(|a| a.stage_id == painting)
            .unwrap()
            .id;
        let check = check_add_with(&open, &tiling, "close", "Inspected")
            .unwrap()
            .checks[0]
            .id
            .clone();
        stage_start_with(&open, &tiling).unwrap();
        check_answer_with(&open, &answer(&check, "yes"), AUTHOR).unwrap();
        stage_close_with(&open, &tiling).unwrap();
        let end = |kind: &str, id: &str| Endpoint {
            kind: kind.into(),
            id: id.into(),
        };

        dependency_add_with(
            &open,
            &end("activity", &tile),
            &end("activity", &paint),
            0.0,
        )
        .expect("a closed stage may be waited for");
        for (blocked_kind, blocked) in [("activity", &grout), ("stage", &tiling)] {
            let refused = dependency_add_with(
                &open,
                &end("activity", &paint),
                &end(blocked_kind, blocked),
                0.0,
            )
            .unwrap_err();
            assert_eq!(refused.kind(), "stage_closed", "{blocked_kind}");
            assert_eq!(
                refused.to_string(),
                "“Tiling” is closed. Reopen it to change it."
            );
        }
        for refused in [
            activity_move_with(&open, &grout, "up").map(|_| ()),
            check_move_with(&open, &check, "down").map(|_| ()),
            check_rename_with(&open, &check, "Checked").map(|_| ()),
            check_remove_with(&open, &check).map(|_| ()),
        ] {
            assert_eq!(refused.unwrap_err().kind(), "stage_closed");
        }

        stage_reopen_with(&open, &tiling).unwrap();
        activity_move_with(&open, &grout, "up").expect("reopened: it moves again");
        work_close_with(&open);
    }
}
