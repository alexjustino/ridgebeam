//! The commands for the diary: write an entry, read entries, verify the chain,
//! show a photo small, open it.
//!
//! There is no command that edits or removes an entry, and there never will be
//! (requirement one). Where an edit would be expected the interface offers a
//! correction: `diary_entry_add` with kind `correction`, naming the entry it
//! corrects and restating the day.
//!
//! An entry is written whole or not at all. Its photos are copied into the
//! work folder first, under the caps (`files::photos`); a photo refused is the
//! entry refused, with the sentence naming the file, and every file already
//! copied for it is removed. Then the entry and its rows are one transaction.
//!
//! "Today" here is the host's clock, in local time: the host refuses an entry
//! for a day after it, as the second guard behind the domain (which is handed
//! its "today" by the interface). The author is the Windows account's display
//! name (`os::account`) — the product has no accounts of its own.
//!
//! # Changelog of this boundary
//!
//! - F4: `diary_entry_add`, `diary_list`, `diary_entry`, `diary_verify`,
//!   `photo_thumbnail`, `photo_open`.

use std::collections::HashSet;
use std::path::PathBuf;

use chrono::NaiveDate;
use tauri::State;

use crate::commands::work::with_work;
use crate::contract::{ChainReport, DiaryEntry, DiaryRange, DoneLine, EntryDraft, Photo};
use crate::db::diary::{self, NewEntry};
use crate::error::{Error, Result};
use crate::files::photos::{self, CopyIn, NOT_A_PHOTO};
use crate::folder::OpenWork;
use crate::os::account;
use crate::validate;

/// The weather an entry may record.
pub const WEATHER: [&str; 6] = ["sun", "cloud", "rain", "storm", "wind", "other"];

/// The longest note an entry keeps.
pub const MAX_NOTE_CHARS: usize = 4000;

/// The longest delivery, incident or visitor text an entry keeps.
pub const MAX_SITE_TEXT_CHARS: usize = 2000;

/// The longest note a done line keeps.
pub const MAX_DONE_NOTE_CHARS: usize = 500;

/// Write a diary entry — or a correction — dated today or earlier.
///
/// # Errors
///
/// [`Error::DiaryFutureDay`] for a day after today; [`Error::DiaryCorrectsUnknown`]
/// for a correction of an entry the diary does not hold; [`Error::PhotoRefused`]
/// for a photo refused under the caps (the whole entry is refused, and nothing
/// is written); [`Error::InvalidInput`] for anything else that does not fit;
/// and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn diary_entry_add(open: State<'_, OpenWork>, draft: EntryDraft) -> Result<DiaryEntry> {
    let today = chrono::Local::now().date_naive();
    diary_entry_add_with(&open, &draft, today, &account::display_name())
}

/// Diary entries, newest day first, optionally between two days.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a day that is not one, and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn diary_list(open: State<'_, OpenWork>, range: Option<DiaryRange>) -> Result<Vec<DiaryEntry>> {
    diary_list_with(&open, &range.unwrap_or_default())
}

/// One diary entry.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the diary holds no such entry, and the errors
/// of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn diary_entry(open: State<'_, OpenWork>, seq: i64) -> Result<DiaryEntry> {
    diary_entry_with(&open, seq)
}

/// Recompute every hash and every link of the diary.
///
/// # Errors
///
/// The errors of every work command. A broken chain is not an error: it is a
/// report that says where and why.
#[tauri::command(rename_all = "snake_case")]
pub fn diary_verify(open: State<'_, OpenWork>) -> Result<ChainReport> {
    diary_verify_with(&open)
}

/// A photo's thumbnail as a `data:image/jpeg;base64,…` URL.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a hash that names no photo with a thumbnail, and
/// the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn photo_thumbnail(open: State<'_, OpenWork>, hash: String) -> Result<String> {
    with_work(&open, |state| {
        photos::thumbnail_data_url(&state.folder, &hash)
    })
}

/// Open a photo's original with the operating system's own handler.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a hash that names no photo of this work;
/// [`Error::Io`] when the system could not open it; and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn photo_open(open: State<'_, OpenWork>, hash: String) -> Result<()> {
    with_work(&open, |state| photos::open(&state.folder, &hash))
}

/// A draft, checked: the entry as it will be written (without its photos), the
/// files to copy in, and the photos to re-attach.
struct Checked {
    entry: NewEntry,
    paths: Vec<PathBuf>,
    hashes: Vec<String>,
}

/// What [`diary_entry_add`] does once the state, today and the author are in
/// hand.
pub fn diary_entry_add_with(
    open: &OpenWork,
    draft: &EntryDraft,
    today: NaiveDate,
    author: &str,
) -> Result<DiaryEntry> {
    let Checked {
        mut entry,
        paths,
        hashes,
    } = check(draft, today, author)?;

    with_work(open, |state| {
        let mut attached: Vec<Photo> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for hash in &hashes {
            let photo = diary::photo_by_hash(&state.conn, hash)?
                .filter(|_| photos::original(&state.folder, hash).is_some())
                .ok_or_else(|| Error::InvalidInput(NOT_A_PHOTO.into()))?;
            if seen.insert(photo.file_hash.clone()) {
                attached.push(photo);
            }
        }

        // Dropped without `keep`, the copy-in removes every file it wrote.
        let mut copy = CopyIn::new(&state.folder);
        for path in &paths {
            let copied = copy.copy(path)?;
            if seen.insert(copied.hash.clone()) {
                attached.push(Photo {
                    file_hash: copied.hash,
                    file_name: copied.file_name,
                    bytes: copied.bytes,
                    width: copied.width,
                    height: copied.height,
                    thumbnail: copied.thumbnail,
                });
            }
        }

        entry.photos = attached;
        let seq = diary::append(&state.conn, &entry)?;
        copy.keep();
        diary::get(&state.conn, seq)?.ok_or(Error::Database(rusqlite::Error::QueryReturnedNoRows))
    })
}

/// What [`diary_list`] does once the state is in hand.
pub fn diary_list_with(open: &OpenWork, range: &DiaryRange) -> Result<Vec<DiaryEntry>> {
    let from = validate::optional_date("The first day", range.from_day.as_deref())?;
    let to = validate::optional_date("The last day", range.to_day.as_deref())?;
    with_work(open, |state| {
        diary::list(&state.conn, from.as_deref(), to.as_deref())
    })
}

/// What [`diary_entry`] does once the state is in hand.
pub fn diary_entry_with(open: &OpenWork, seq: i64) -> Result<DiaryEntry> {
    with_work(open, |state| {
        diary::get(&state.conn, seq)?
            .ok_or_else(|| Error::InvalidInput(format!("The diary holds no entry #{seq}.")))
    })
}

/// What [`diary_verify`] does once the state is in hand.
pub fn diary_verify_with(open: &OpenWork) -> Result<ChainReport> {
    with_work(open, |state| diary::verify(&state.conn))
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// Refuse the control characters a person does not type — and which the
/// canonical form uses as separators. New lines and tabs are text.
fn plain(what: &str, value: &str) -> Result<()> {
    if value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(invalid(format!(
            "{what} holds a control character that cannot be kept."
        )));
    }
    Ok(())
}

/// A text of the day: trimmed, empty is none, bounded, plain.
fn site_text(what: &str, value: Option<&str>, max: usize) -> Result<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > max {
        return Err(invalid(format!("{what} is at most {max} characters.")));
    }
    plain(what, value)?;
    Ok(Some(value.to_string()))
}

/// Everything about a draft that can be checked without the file.
fn check(draft: &EntryDraft, today: NaiveDate, author: &str) -> Result<Checked> {
    let day = validate::date("An entry's day", &draft.day)?;
    if day > today.format("%Y-%m-%d").to_string() {
        return Err(Error::DiaryFutureDay(day));
    }

    match (draft.kind.as_str(), draft.corrects_seq) {
        ("entry", None) | ("correction", Some(_)) => {}
        ("entry" | "correction", _) => {
            return Err(invalid(
                "An entry corrects nothing; a correction names the entry it corrects.",
            ))
        }
        _ => return Err(invalid("An entry is an entry or a correction.")),
    }

    let note = draft.note.trim();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(invalid(format!(
            "An entry's note is at most {MAX_NOTE_CHARS} characters."
        )));
    }
    plain("An entry's note", note)?;
    if draft.kind == "correction" && note.is_empty() {
        return Err(invalid("A correction says what was wrong."));
    }
    let note = (!note.is_empty()).then(|| note.to_string());

    let weather = match draft.weather.as_deref() {
        None => None,
        Some(word) if WEATHER.contains(&word) => Some(word.to_string()),
        Some(_) => {
            return Err(invalid(
                "The weather is sun, cloud, rain, storm, wind or other.",
            ))
        }
    };
    let hours = match draft.hours {
        None => None,
        Some(hours) if hours.is_finite() && (0.0..=24.0).contains(&hours) => Some(hours),
        Some(_) => return Err(invalid("Hours on site are from 0 to 24.")),
    };

    let mut done = Vec::new();
    let mut named: HashSet<&str> = HashSet::new();
    for line in &draft.done {
        if !named.insert(line.activity_id.as_str()) {
            return Err(invalid(
                "An activity is listed twice in one entry: it was worked on, or finished.",
            ));
        }
        if !matches!(line.state.as_str(), "worked" | "finished") {
            return Err(invalid("An activity was worked on, or finished."));
        }
        let quantity = match line.quantity {
            None => None,
            Some(q) => Some(validate::quantity(q)?),
        };
        done.push(DoneLine {
            activity_id: line.activity_id.clone(),
            state: line.state.clone(),
            quantity,
            note: site_text(
                "A note on what was done",
                line.note.as_deref(),
                MAX_DONE_NOTE_CHARS,
            )?,
        });
    }

    let mut paths = Vec::new();
    for path in &draft.photo_paths {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err(invalid("A photo is chosen by its full path."));
        }
        paths.push(path);
    }
    for hash in &draft.photo_hashes {
        if !photos::is_hash(hash) {
            return Err(invalid(NOT_A_PHOTO));
        }
    }

    Ok(Checked {
        entry: NewEntry {
            day,
            kind: draft.kind.clone(),
            corrects_seq: draft.corrects_seq,
            note,
            weather,
            lost_day: draft.lost_day,
            hours,
            deliveries: site_text(
                "What arrived",
                draft.deliveries.as_deref(),
                MAX_SITE_TEXT_CHARS,
            )?,
            incidents: site_text(
                "What went wrong",
                draft.incidents.as_deref(),
                MAX_SITE_TEXT_CHARS,
            )?,
            visitors: site_text(
                "Who visited",
                draft.visitors.as_deref(),
                MAX_SITE_TEXT_CHARS,
            )?,
            author_name: author.to_string(),
            done,
            present: draft.present.clone(),
            photos: Vec::new(),
        },
        paths,
        hashes: draft.photo_hashes.clone(),
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
    use crate::files::photos::tests::{hostile_corpus, png};

    const AUTHOR: &str = "Ana Souza (synthetic)";

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
    }

    fn draft(day: &str) -> EntryDraft {
        serde_json::from_value(serde_json::json!({ "day": day, "kind": "entry" }))
            .expect("the smallest draft the interface could send")
    }

    fn folder_of(open: &OpenWork) -> PathBuf {
        lock(&open.0).as_ref().unwrap().folder.clone()
    }

    fn entries_on_disk(open: &OpenWork) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(folder_of(open))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with("work.sqlite3"))
            .collect();
        names.sort();
        names
    }

    /// A work with a stage, an activity and a person — and their ids.
    fn a_work_with_a_site() -> (OpenWork, Scratch, String, String) {
        let (_db, open, scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
            .id
            .clone();
        let tiling = activity_add_with(&open, &stage, "Tiling")
            .unwrap()
            .activities[0]
            .id
            .clone();
        let ana = person_add_with(&open, "A. Tiler").unwrap().people[0]
            .id
            .clone();
        (open, scratch, tiling, ana)
    }

    #[test]
    fn a_one_tap_entry_is_written_signed_and_chained_from_nothing() {
        let (open, _scratch, tiling, ana) = a_work_with_a_site();
        let mut today_entry = draft("2026-10-09");
        today_entry.weather = Some("sun".into());
        today_entry.present = vec![ana.clone()];
        today_entry.done = vec![serde_json::from_value(serde_json::json!({
            "activityId": tiling, "state": "finished", "quantity": 12
        }))
        .unwrap()];

        let entry = diary_entry_add_with(&open, &today_entry, today(), AUTHOR).unwrap();

        assert_eq!(entry.seq, 1);
        assert_eq!(entry.prev_hash, "");
        assert_eq!(entry.hash.len(), 64);
        assert_eq!(
            entry.author_name, AUTHOR,
            "signed by the account, as the host read it"
        );
        assert_eq!(entry.present, vec![ana]);
        assert_eq!(entry.done[0].state, "finished");
        assert_eq!(entry.done[0].quantity, Some(12.0));
        let wire = serde_json::to_value(&entry).unwrap();
        for key in [
            "seq",
            "day",
            "kind",
            "correctsSeq",
            "note",
            "weather",
            "lostDay",
            "hours",
            "deliveries",
            "incidents",
            "visitors",
            "authorName",
            "createdAt",
            "prevHash",
            "hash",
            "done",
            "present",
            "photos",
        ] {
            assert!(wire.get(key).is_some(), "`{key}` is on the wire");
        }
        assert_eq!(
            entries_on_disk(&open),
            Vec::<String>::new(),
            "no documents/ or thumbnails/ without a photo"
        );

        let second = diary_entry_add_with(&open, &draft("2026-10-09"), today(), AUTHOR).unwrap();
        assert_eq!(
            second.seq, 2,
            "a second entry on the same day is allowed and ordered"
        );
        assert_eq!(second.prev_hash, entry.hash);
        assert!(diary_verify_with(&open).unwrap().intact);
        work_close_with(&open);
    }

    #[test]
    fn the_account_name_the_command_signs_with_is_the_systems() {
        let name = account::display_name();
        assert!(!name.is_empty());
        let (open, _scratch, _, _) = a_work_with_a_site();
        let entry = diary_entry_add_with(&open, &draft("2026-10-01"), today(), &name).unwrap();
        assert_eq!(entry.author_name, name);
        work_close_with(&open);
    }

    #[test]
    fn a_day_after_today_is_diary_future_day_and_nothing_is_written() {
        let (open, _scratch, _, _) = a_work_with_a_site();

        let refused =
            diary_entry_add_with(&open, &draft("2026-10-10"), today(), AUTHOR).unwrap_err();

        assert_eq!(refused.kind(), "diary_future_day");
        assert!(refused
            .to_string()
            .starts_with("2026-10-10 has not happened yet"));
        assert!(diary_list_with(&open, &DiaryRange::default())
            .unwrap()
            .is_empty());
        diary_entry_add_with(&open, &draft("2026-10-09"), today(), AUTHOR).expect("today is fine");
        work_close_with(&open);
    }

    #[test]
    fn a_correction_of_an_unknown_entry_is_refused_and_a_correction_of_a_correction_is_accepted() {
        let (open, _scratch, _, _) = a_work_with_a_site();
        diary_entry_add_with(&open, &draft("2026-10-05"), today(), AUTHOR).unwrap();

        let mut correction = draft("2026-10-05");
        correction.kind = "correction".into();
        correction.corrects_seq = Some(7);
        correction.note = "The tiler came on Tuesday, not Monday.".into();
        let refused = diary_entry_add_with(&open, &correction, today(), AUTHOR).unwrap_err();
        assert_eq!(refused.kind(), "diary_corrects_unknown");
        assert_eq!(
            refused.to_string(),
            "There is no entry #7 in the diary to correct."
        );

        correction.corrects_seq = Some(1);
        let second = diary_entry_add_with(&open, &correction, today(), AUTHOR).unwrap();
        assert_eq!(
            (second.kind.as_str(), second.corrects_seq),
            ("correction", Some(1))
        );

        correction.corrects_seq = Some(2);
        let third = diary_entry_add_with(&open, &correction, today(), AUTHOR).unwrap();
        assert_eq!(third.corrects_seq, Some(2), "a correction of a correction");

        let mut silent = correction.clone();
        silent.note = "   ".into();
        assert_eq!(
            diary_entry_add_with(&open, &silent, today(), AUTHOR)
                .unwrap_err()
                .to_string(),
            "A correction says what was wrong."
        );
        assert!(diary_verify_with(&open).unwrap().intact);
        work_close_with(&open);
    }

    #[test]
    fn a_draft_that_does_not_fit_is_refused_before_anything_is_written() {
        let (open, _scratch, tiling, _) = a_work_with_a_site();
        let line = |state: &str, quantity: serde_json::Value| -> crate::contract::DoneDraft {
            serde_json::from_value(serde_json::json!({
                "activityId": tiling, "state": state, "quantity": quantity
            }))
            .unwrap()
        };
        let cases: Vec<(EntryDraft, &str)> = vec![
            (
                EntryDraft {
                    weather: Some("snow".into()),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    hours: Some(25.0),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    note: "x".repeat(4001),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    note: "tab\tok but \u{1F} is not".into(),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    corrects_seq: Some(1),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    kind: "edit".into(),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    done: vec![line("worked", serde_json::json!(-1))],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    done: vec![line("painted", serde_json::Value::Null)],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    done: vec![
                        line("worked", serde_json::Value::Null),
                        line("finished", serde_json::Value::Null),
                    ],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    done: vec![serde_json::from_value(serde_json::json!({
                        "activityId": crate::db::new_id(), "state": "worked"
                    }))
                    .unwrap()],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    present: vec![crate::db::new_id()],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    photo_paths: vec!["relative/photo.jpg".into()],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    photo_hashes: vec!["../../etc".into()],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    photo_hashes: vec!["ab".repeat(32)],
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
            (
                EntryDraft {
                    day: "2026-02-30".into(),
                    ..draft("2026-10-01")
                },
                "invalid_input",
            ),
        ];
        for (case, kind) in cases {
            let refused = diary_entry_add_with(&open, &case, today(), AUTHOR).unwrap_err();
            assert_eq!(refused.kind(), kind, "{case:?}: {refused}");
        }
        assert!(diary_list_with(&open, &DiaryRange::default())
            .unwrap()
            .is_empty());
        work_close_with(&open);
    }

    #[test]
    fn a_photo_is_copied_in_by_hash_with_its_thumbnail_and_a_correction_reattaches_it() {
        let (open, _scratch, _, _) = a_work_with_a_site();
        let source = Scratch::create();
        let path = source.path().join("wall.png");
        let bytes = png(640, 480);
        std::fs::write(&path, &bytes).unwrap();
        let hash = photos::sha256_hex(&bytes);

        let mut with_photo = draft("2026-10-08");
        with_photo.photo_paths = vec![path.to_string_lossy().into_owned()];
        let entry = diary_entry_add_with(&open, &with_photo, today(), AUTHOR).unwrap();

        assert_eq!(entry.photos.len(), 1);
        let photo = &entry.photos[0];
        assert_eq!(
            (
                photo.file_hash.as_str(),
                photo.file_name.as_str(),
                photo.width,
                photo.height
            ),
            (hash.as_str(), "wall.png", 640, 480)
        );
        assert!(photo.thumbnail);
        assert_eq!(entries_on_disk(&open), vec!["documents", "thumbnails"]);
        let folder = folder_of(&open);
        assert!(folder.join(format!("documents/{hash}.png")).is_file());
        assert!(folder.join(format!("thumbnails/{hash}.jpg")).is_file());
        let url = with_work(&open, |state| {
            photos::thumbnail_data_url(&state.folder, &hash)
        })
        .unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));

        let mut correction = draft("2026-10-08");
        correction.kind = "correction".into();
        correction.corrects_seq = Some(entry.seq);
        correction.note = "It was the kitchen wall.".into();
        correction.photo_hashes = vec![hash.clone()];
        let corrected = diary_entry_add_with(&open, &correction, today(), AUTHOR).unwrap();
        assert_eq!(
            corrected.photos, entry.photos,
            "re-attached by hash, copied nothing twice"
        );
        assert_eq!(
            std::fs::read_dir(folder.join("documents")).unwrap().count(),
            1
        );
        work_close_with(&open);
    }

    /// Requirement one's other half: an entry is whole or not there. A good
    /// photo followed by a hostile one is the entry refused, the sentence naming
    /// the hostile file, and the good one's copy removed.
    #[test]
    fn every_hostile_photo_refuses_the_whole_entry_and_removes_what_was_copied() {
        let (open, _scratch, _, _) = a_work_with_a_site();
        let source = Scratch::create();
        let good = source.path().join("good.png");
        std::fs::write(&good, png(64, 64)).unwrap();

        for (name, bytes, words) in hostile_corpus() {
            let hostile = source.path().join(name);
            std::fs::write(&hostile, &bytes).unwrap();
            let mut entry = draft("2026-10-08");
            entry.photo_paths = vec![
                good.to_string_lossy().into_owned(),
                hostile.to_string_lossy().into_owned(),
            ];

            let refused = diary_entry_add_with(&open, &entry, today(), AUTHOR).unwrap_err();

            assert_eq!(refused.kind(), "photo_refused", "{name}");
            let sentence = refused.to_string();
            assert!(
                sentence.contains(name) && sentence.contains(words),
                "{sentence}"
            );
            assert!(diary_list_with(&open, &DiaryRange::default())
                .unwrap()
                .is_empty());
            assert_eq!(
                entries_on_disk(&open),
                Vec::<String>::new(),
                "{name}: the good photo's copy and the folders were removed"
            );
        }
        work_close_with(&open);
    }

    #[test]
    fn the_list_reads_newest_day_first_and_a_range_narrows_it() {
        let (open, _scratch, _, _) = a_work_with_a_site();
        for day in ["2026-10-05", "2026-10-07", "2026-10-06", "2026-10-07"] {
            diary_entry_add_with(&open, &draft(day), today(), AUTHOR).unwrap();
        }

        let all: Vec<(String, i64)> = diary_list_with(&open, &DiaryRange::default())
            .unwrap()
            .into_iter()
            .map(|e| (e.day, e.seq))
            .collect();
        assert_eq!(
            all,
            vec![
                ("2026-10-07".into(), 4),
                ("2026-10-07".into(), 2),
                ("2026-10-06".into(), 3),
                ("2026-10-05".into(), 1)
            ]
        );
        let range = DiaryRange {
            from_day: Some("2026-10-06".into()),
            to_day: Some("2026-10-06".into()),
        };
        assert_eq!(diary_list_with(&open, &range).unwrap().len(), 1);
        assert_eq!(diary_entry_with(&open, 3).unwrap().day, "2026-10-06");
        assert_eq!(
            diary_entry_with(&open, 9).unwrap_err().kind(),
            "invalid_input"
        );
        work_close_with(&open);
    }

    #[test]
    fn the_verify_report_is_the_shape_the_interface_reads() {
        let (open, _scratch, _, _) = a_work_with_a_site();
        diary_entry_add_with(&open, &draft("2026-10-05"), today(), AUTHOR).unwrap();

        let wire = serde_json::to_value(diary_verify_with(&open).unwrap()).unwrap();

        assert_eq!(wire, serde_json::json!({ "entries": 1, "intact": true }));
        work_close_with(&open);
    }

    #[test]
    fn diary_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        assert_eq!(diary_verify_with(&open).unwrap_err().kind(), "no_work_open");
        assert_eq!(
            diary_entry_add_with(&open, &draft("2026-10-01"), today(), AUTHOR)
                .unwrap_err()
                .kind(),
            "no_work_open"
        );
    }
}
