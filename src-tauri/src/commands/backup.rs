//! The commands that back a work up and restore one (F11, ADR-033).
//!
//! A backup is one `.ridgebeam` file — a ZIP holding the work's database, its
//! documents and thumbnails, and a manifest (`files::backup`). Restoring makes
//! a **new** work folder and never writes into one that holds anything: the
//! file is hostile, checked whole in a temporary folder beside the target,
//! opened there — an older schema migrates forward as any old work does — and
//! only then renamed into place and opened. On any refusal nothing is left.
//!
//! The day of the last backup is kept in the application database, per work
//! (`db::backups`), not in the work.
//!
//! Lock order, where both are taken: the open work first, then the
//! application database.
//!
//! # Changelog of this boundary
//!
//! - F11: `backup_write`, `backup_inspect`, `backup_restore`, `backup_last`.

use std::path::Path;

use chrono::{DateTime, Local};
use tauri::State;

use crate::commands::diary::diary_verify_with;
use crate::commands::documents::documents_verify_with;
use crate::commands::work::{with_work, work_open_with};
use crate::contract::{BackupLast, BackupSummary, BackupWritten, Restored};
use crate::db::{backups, recent, Db};
use crate::error::{Error, Result};
use crate::files::backup;
use crate::folder::{self, OpenWork};

/// Back the open work up to `path`, a `.ridgebeam` file the save dialog
/// chose. An existing file is replaced only with `overwrite`, which the
/// interface sends only when the dialog chose it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that cannot be written (the sentence
/// names the file), a path inside the work's own folder, or a work past the
/// backup's limits; [`Error::Io`] when the disk refuses — nothing is left
/// behind; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn backup_write(
    db: State<'_, Db>,
    open: State<'_, OpenWork>,
    path: String,
    overwrite: Option<bool>,
) -> Result<BackupWritten> {
    backup_write_with(&db, &open, &path, overwrite.unwrap_or(false), Local::now())
}

/// What a backup holds, read from its manifest before anything is restored —
/// for the Restore dialog. No work needs to be open.
///
/// # Errors
///
/// [`Error::InvalidInput`] with the sentence that says why the file cannot be
/// restored; [`Error::Io`] when it cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn backup_inspect(db: State<'_, Db>, path: String) -> Result<BackupSummary> {
    backup_inspect_with(&db, &path)
}

/// Restore the backup at `path` into `folder` — one that does not exist yet,
/// or is empty — and open it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that is not a full one, a folder that is
/// a file or whose parent is not there, and every refusal of the file itself,
/// each with its sentence; [`Error::WorkFolderNotEmpty`] for a folder that
/// holds anything; [`Error::Io`] and [`Error::Database`] when the disk or
/// SQLite refuse. After any of them, nothing is left.
#[tauri::command(rename_all = "snake_case")]
pub fn backup_restore(
    db: State<'_, Db>,
    open: State<'_, OpenWork>,
    path: String,
    folder: String,
) -> Result<Restored> {
    backup_restore_with(&db, &open, &path, &folder)
}

/// The day the open work was last backed up, or `null` for never.
///
/// # Errors
///
/// The errors of every work command; [`Error::Database`] when the
/// application database cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn backup_last(db: State<'_, Db>, open: State<'_, OpenWork>) -> Result<Option<BackupLast>> {
    backup_last_with(&db, &open)
}

/// What [`backup_write`] does once the state and the moment are in hand.
pub fn backup_write_with(
    db: &Db,
    open: &OpenWork,
    path: &str,
    overwrite: bool,
    now: DateTime<Local>,
) -> Result<BackupWritten> {
    let dest = Path::new(path);
    with_work(open, |state| {
        let written = backup::write(&state.conn, &state.folder, dest, overwrite, now)?;
        let files = written.manifest.files.len();
        // The day is a convenience: a backup that was written is written,
        // whether or not the day could be recorded.
        let day = now.format("%Y-%m-%d").to_string();
        if let Err(error) = backups::record(&db.conn(), &state.work_id, &day, written.bytes, files)
        {
            log::warn!("the day of the backup could not be recorded: {error}");
        }
        if !written.left_out.is_empty() {
            log::warn!(
                "a backup left out {} file(s) whose names a backup never holds",
                written.left_out.len()
            );
        }
        Ok(BackupWritten {
            path: dest.to_string_lossy().into_owned(),
            bytes: written.bytes,
            files,
            left_out: written.left_out,
        })
    })
}

/// The folder the recent list knows a work at, if it knows it.
fn recent_folder(db: &Db, work_id: &str) -> Option<String> {
    match recent::list(&db.conn()) {
        Ok(rows) => rows
            .into_iter()
            .find(|row| row.work_id == work_id)
            .map(|row| row.folder),
        Err(error) => {
            log::warn!("the recent list could not be read: {error}");
            None
        }
    }
}

/// What [`backup_inspect`] does once the state is in hand.
pub fn backup_inspect_with(db: &Db, path: &str) -> Result<BackupSummary> {
    let checked = backup::check(Path::new(path))?;
    let manifest = &checked.manifest;
    Ok(BackupSummary {
        work_name: manifest.work_name.clone(),
        work_id: manifest.work_id.clone(),
        created_at: manifest.created_at.clone(),
        app: manifest.app.clone(),
        schema_version: manifest.schema_version,
        files: manifest.files.len(),
        bytes: manifest.bytes(),
        archive_bytes: checked.archive_bytes,
        recent_folder: recent_folder(db, &manifest.work_id),
    })
}

/// What [`backup_restore`] does once the state is in hand.
pub fn backup_restore_with(db: &Db, open: &OpenWork, path: &str, folder: &str) -> Result<Restored> {
    let target = folder::folder_path(folder)?;
    if target.exists() {
        if !target.is_dir() {
            return Err(Error::InvalidInput(
                "That path is a file, not a folder.".into(),
            ));
        }
        if std::fs::read_dir(&target)?.next().is_some() {
            return Err(Error::WorkFolderNotEmpty);
        }
    }

    let staged = backup::stage(Path::new(path), &target)?;
    // Opened where it is staged: an older schema migrates forward here, and
    // a refusal still leaves nothing in place. Closed again, one file.
    folder::close(folder::open(staged.folder())?);
    let work_id = staged.manifest.work_id.clone();
    staged.move_into(&target)?;

    let target_text = target.to_string_lossy().into_owned();
    let moved_recent_from = recent_folder(db, &work_id).filter(|known| *known != target_text);
    work_open_with(db, open, &target_text)?;
    let chain = diary_verify_with(open)?;
    let documents = documents_verify_with(open)?;
    log::info!("a backup was restored into a new folder");
    Ok(Restored {
        work_id,
        folder: target_text,
        entries: chain.entries,
        chain_ok: chain.intact,
        documents: documents.checked,
        mismatched: documents.mismatched,
        missing: documents.missing,
        moved_recent_from,
    })
}

/// What [`backup_last`] does once the state is in hand.
pub fn backup_last_with(db: &Db, open: &OpenWork) -> Result<Option<BackupLast>> {
    with_work(open, |state| {
        Ok(backups::last(&db.conn(), &state.work_id)?.map(|day| BackupLast { day }))
    })
}
