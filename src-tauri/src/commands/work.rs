//! The commands that create, open, read and close a work.
//!
//! One work is open at a time. Creating or opening another closes the one that
//! was open — checkpointed, one file — once the new one is safely in hand, so a
//! failed open never leaves the person with nothing open.
//!
//! Every command that touches the open work asks the disk first whether it is
//! still there (`WorkState::ensure_present`). A work whose folder was moved
//! while it was open answers `work_moved` and stays "open" until `work_close`,
//! which always succeeds: the interface says what happened, and the person
//! closes it and opens it again from where it is now.
//!
//! Lock order, where both are taken: the open work first, then the application
//! database. Every command here keeps to it.
//!
//! # Changelog of this boundary
//!
//! - F0: `recent_works`, `work_create`, `work_open`, `work_close`,
//!   `work_current`, `work_get`, `work_update`.

use std::path::Path;

use tauri::State;

use crate::contract::{RecentWork, WorkDraft, WorkPatch, WorkSnapshot, WorkSummary};
use crate::db::{self, lock, recent, Db};
use crate::error::{Error, Result};
use crate::folder::{self, OpenWork, WorkState};
use crate::validate;

/// The works recently opened, most recent first, each saying whether its folder
/// still holds it.
///
/// # Errors
///
/// [`Error::Database`] when the list cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn recent_works(db: State<'_, Db>) -> Result<Vec<RecentWork>> {
    recent_works_with(&db)
}

/// Create a work in a folder that does not exist yet or is empty, and open it.
///
/// # Errors
///
/// [`Error::InvalidInput`], [`Error::WorkFolderNotEmpty`], [`Error::Io`] or
/// [`Error::Database`] — see [`folder::create`].
#[tauri::command(rename_all = "snake_case")]
pub fn work_create(
    db: State<'_, Db>,
    open: State<'_, OpenWork>,
    folder: String,
    draft: WorkDraft,
) -> Result<WorkSummary> {
    work_create_with(&db, &open, &folder, &draft)
}

/// Open the work in a folder.
///
/// # Errors
///
/// [`Error::WorkNotFound`], [`Error::NewerVersion`] or [`Error::Database`] —
/// see [`folder::open`].
#[tauri::command(rename_all = "snake_case")]
pub fn work_open(
    db: State<'_, Db>,
    open: State<'_, OpenWork>,
    folder: String,
) -> Result<WorkSummary> {
    work_open_with(&db, &open, &folder)
}

/// Close the open work, leaving its folder one file. Closing when nothing is
/// open is not an error.
#[tauri::command(rename_all = "snake_case")]
pub fn work_close(open: State<'_, OpenWork>) {
    work_close_with(&open);
}

/// The open work, or `null`.
///
/// # Errors
///
/// [`Error::WorkMoved`] when the open work's folder is gone.
#[tauri::command(rename_all = "snake_case")]
pub fn work_current(open: State<'_, OpenWork>) -> Result<Option<WorkSummary>> {
    work_current_with(&open)
}

/// The whole plan of the open work.
///
/// # Errors
///
/// [`Error::NoWorkOpen`], [`Error::WorkMoved`] or [`Error::Database`].
#[tauri::command(rename_all = "snake_case")]
pub fn work_get(open: State<'_, OpenWork>) -> Result<WorkSnapshot> {
    work_get_with(&open)
}

/// Change the work's name, place, start date or currency.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a field that does not fit, and the errors of
/// [`work_get`].
#[tauri::command(rename_all = "snake_case")]
pub fn work_update(
    db: State<'_, Db>,
    open: State<'_, OpenWork>,
    patch: WorkPatch,
) -> Result<WorkSnapshot> {
    work_update_with(&db, &open, &patch)
}

/// Run `action` against the open work, after checking it is still there.
///
/// # Errors
///
/// [`Error::NoWorkOpen`] or [`Error::WorkMoved`], or whatever `action` returns.
pub fn with_work<T>(open: &OpenWork, action: impl FnOnce(&WorkState) -> Result<T>) -> Result<T> {
    let slot = lock(&open.0);
    let state = slot.as_ref().ok_or(Error::NoWorkOpen)?;
    state.ensure_present()?;
    action(state)
}

/// Change the open work with `change`, then return the whole plan.
///
/// # Errors
///
/// As [`with_work`].
pub fn change_work(
    open: &OpenWork,
    change: impl FnOnce(&rusqlite::Connection) -> Result<()>,
) -> Result<WorkSnapshot> {
    with_work(open, |state| {
        change(&state.conn)?;
        db::work::snapshot(&state.conn)
    })
}

/// What [`recent_works`] does once the state is in hand.
pub fn recent_works_with(db: &Db) -> Result<Vec<RecentWork>> {
    let rows = recent::list(&db.conn())?;
    Ok(rows
        .into_iter()
        .map(|row| RecentWork {
            present: folder::is_present(Path::new(&row.folder)),
            work_id: row.work_id,
            name: row.name,
            folder: row.folder,
            opened_at: row.opened_at,
        })
        .collect())
}

/// What [`work_create`] does once the state is in hand.
pub fn work_create_with(
    db: &Db,
    open: &OpenWork,
    folder: &str,
    draft: &WorkDraft,
) -> Result<WorkSummary> {
    let path = folder::folder_path(folder)?;
    let state = folder::create(&path, draft)?;
    install(db, open, state)
}

/// What [`work_open`] does once the state is in hand.
pub fn work_open_with(db: &Db, open: &OpenWork, folder: &str) -> Result<WorkSummary> {
    let path = folder::folder_path(folder)?;
    let state = folder::open(&path)?;
    install(db, open, state)
}

/// Make `state` the open work, record it as recent, and close the one it
/// replaces.
fn install(db: &Db, open: &OpenWork, state: WorkState) -> Result<WorkSummary> {
    let summary = state.summary()?;
    let mut slot = lock(&open.0);
    // The recent list is a convenience. A work that was created or opened is
    // open, whether or not the list could be written.
    if let Err(error) = recent::record(&db.conn(), &summary.work_id, &summary.name, &summary.folder)
    {
        log::warn!("the recent list could not be written: {error}");
    }
    if let Some(previous) = slot.replace(state) {
        folder::close(previous);
    }
    Ok(summary)
}

/// What [`work_close`] does once the state is in hand.
pub fn work_close_with(open: &OpenWork) {
    if let Some(state) = lock(&open.0).take() {
        folder::close(state);
    }
}

/// What [`work_current`] does once the state is in hand.
pub fn work_current_with(open: &OpenWork) -> Result<Option<WorkSummary>> {
    let slot = lock(&open.0);
    match slot.as_ref() {
        None => Ok(None),
        Some(state) => {
            state.ensure_present()?;
            state.summary().map(Some)
        }
    }
}

/// What [`work_get`] does once the state is in hand.
pub fn work_get_with(open: &OpenWork) -> Result<WorkSnapshot> {
    with_work(open, |state| db::work::snapshot(&state.conn))
}

/// What [`work_update`] does once the state is in hand.
pub fn work_update_with(db: &Db, open: &OpenWork, patch: &WorkPatch) -> Result<WorkSnapshot> {
    let name = patch
        .name
        .as_deref()
        .map(|name| validate::name("work", name))
        .transpose()?;
    let place = patch.place.as_deref().map(validate::place).transpose()?;
    let start_date = patch
        .start_date
        .as_deref()
        .map(|date| validate::date("A work's start", date))
        .transpose()?;
    let currency = patch
        .currency
        .as_deref()
        .map(validate::currency)
        .transpose()?;

    with_work(open, |state| {
        db::work::update_work(
            &state.conn,
            name.as_deref(),
            place.as_deref(),
            start_date.as_deref(),
            currency.as_deref(),
        )?;
        if let Some(name) = &name {
            if let Err(error) = recent::rename(&db.conn(), &state.work_id, name) {
                log::warn!("the recent list could not be renamed: {error}");
            }
        }
        db::work::snapshot(&state.conn)
    })
}

#[cfg(test)]
pub mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::db::testing::Scratch;

    /// A host with an application database in memory and no work open.
    pub fn host() -> (Db, OpenWork) {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
        db::migrations::APP.apply(&conn).expect("migrate");
        (Db(Mutex::new(conn)), OpenWork::default())
    }

    /// A synthetic draft.
    pub fn draft(name: &str) -> WorkDraft {
        WorkDraft {
            name: name.into(),
            place: String::new(),
            start_date: "2026-10-05".into(),
            currency: "BRL".into(),
            working_days: "1111100".into(),
            hours_per_day: 8.0,
        }
    }

    /// A host with one work open, in a scratch folder.
    pub fn host_with_a_work() -> (Db, OpenWork, Scratch) {
        let (db, open) = host();
        let scratch = Scratch::create();
        work_create_with(
            &db,
            &open,
            &scratch.path().join("Bathroom").to_string_lossy(),
            &draft("Synthetic bathroom"),
        )
        .expect("create");
        (db, open, scratch)
    }

    #[test]
    fn a_work_created_is_open_current_and_first_in_the_recent_list() {
        let (db, open, scratch) = host_with_a_work();

        let current = work_current_with(&open).unwrap().expect("a work is open");
        assert_eq!(current.name, "Synthetic bathroom");
        assert_eq!(
            current.folder,
            scratch.path().join("Bathroom").to_string_lossy()
        );

        let recent = recent_works_with(&db).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].work_id, current.work_id);
        assert!(recent[0].present);
        work_close_with(&open);
    }

    #[test]
    fn nothing_open_is_null_for_current_and_no_work_open_for_everything_else() {
        let (db, open) = host();

        assert_eq!(work_current_with(&open).unwrap(), None);
        assert_eq!(work_get_with(&open).unwrap_err().kind(), "no_work_open");
        assert_eq!(
            work_update_with(&db, &open, &WorkPatch::default())
                .unwrap_err()
                .kind(),
            "no_work_open"
        );
        work_close_with(&open);
        work_close_with(&open);
    }

    #[test]
    fn a_renamed_work_is_renamed_in_the_recent_list_too() {
        let (db, open, _scratch) = host_with_a_work();

        let plan = work_update_with(
            &db,
            &open,
            &WorkPatch {
                name: Some("  Synthetic bathroom and hall ".into()),
                currency: Some("eur".into()),
                ..WorkPatch::default()
            },
        )
        .unwrap();

        assert_eq!(plan.work.name, "Synthetic bathroom and hall");
        assert_eq!(plan.work.currency, "EUR");
        assert_eq!(
            plan.work.start_date, "2026-10-05",
            "a field left out is left alone"
        );
        assert_eq!(
            recent_works_with(&db).unwrap()[0].name,
            "Synthetic bathroom and hall"
        );
        work_close_with(&open);
    }

    #[test]
    fn a_patch_that_does_not_fit_changes_nothing() {
        let (db, open, _scratch) = host_with_a_work();

        let refused = work_update_with(
            &db,
            &open,
            &WorkPatch {
                name: Some("Kept".into()),
                start_date: Some("2026-02-30".into()),
                ..WorkPatch::default()
            },
        )
        .unwrap_err();

        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            work_get_with(&open).unwrap().work.name,
            "Synthetic bathroom"
        );
        work_close_with(&open);
    }

    /// The negative case the specification names: a work folder moved while
    /// open. Windows will not rename a folder with an open database in it, so
    /// where the rename is refused the test does what that rename would have
    /// done to the host — the folder it opened the work from no longer holds it.
    #[test]
    fn a_work_folder_moved_while_open_is_work_moved_until_it_is_closed() {
        let (db, open, scratch) = host_with_a_work();
        let from = scratch.path().join("Bathroom");
        let to = scratch.path().join("Bathroom (moved)");
        if std::fs::rename(&from, &to).is_err() {
            let mut slot = lock(&open.0);
            slot.as_mut().unwrap().folder = to.join("not here any more");
        }

        for refused in [
            work_get_with(&open).map(|_| ()),
            work_current_with(&open).map(|_| ()),
            work_update_with(&db, &open, &WorkPatch::default()).map(|_| ()),
        ] {
            assert_eq!(refused.unwrap_err().kind(), "work_moved");
        }

        work_close_with(&open);
        assert_eq!(
            work_current_with(&open).unwrap(),
            None,
            "closing always succeeds"
        );
    }

    #[test]
    fn a_folder_that_went_away_says_so_in_the_recent_list() {
        let (db, open, scratch) = host_with_a_work();
        work_close_with(&open);
        std::fs::remove_dir_all(scratch.path().join("Bathroom")).unwrap();

        let recent = recent_works_with(&db).unwrap();

        assert_eq!(recent.len(), 1, "the row is kept");
        assert!(!recent[0].present);
        let value = serde_json::to_value(&recent[0]).unwrap();
        for key in ["workId", "name", "folder", "openedAt", "present"] {
            assert!(value.get(key).is_some(), "`{key}` is on the wire");
        }
    }

    #[test]
    fn opening_another_work_closes_the_first_as_one_file() {
        let (db, open, scratch) = host_with_a_work();
        let second = scratch.path().join("Kitchen");
        work_create_with(
            &db,
            &open,
            &second.to_string_lossy(),
            &draft("Synthetic kitchen"),
        )
        .unwrap();

        let files: Vec<_> = std::fs::read_dir(scratch.path().join("Bathroom"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            files,
            vec![folder::WORK_FILE],
            "the first work was closed cleanly"
        );

        let first = work_open_with(
            &db,
            &open,
            &scratch.path().join("Bathroom").to_string_lossy(),
        )
        .unwrap();
        assert_eq!(first.name, "Synthetic bathroom");
        assert_eq!(recent_works_with(&db).unwrap().len(), 2);
        work_close_with(&open);
    }

    #[test]
    fn a_failed_open_leaves_the_open_work_open() {
        let (db, open, scratch) = host_with_a_work();

        let refused = work_open_with(&db, &open, &scratch.path().to_string_lossy()).unwrap_err();

        assert_eq!(refused.kind(), "work_not_found");
        assert_eq!(
            work_current_with(&open).unwrap().unwrap().name,
            "Synthetic bathroom"
        );
        work_close_with(&open);
    }
}
