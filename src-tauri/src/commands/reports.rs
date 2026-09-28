//! The commands for reports and exports: a document written as a PDF, the
//! diary as a PDF or a CSV with its chain verified, the work as JSON, and a
//! file just written opened.
//!
//! Every one of them writes one file through the one path the host saves by
//! (`files::save`): `.pdf`, `.csv` or `.json` by kind, a full path, whole or
//! not at all, an existing file replaced only with `overwrite` — which the
//! interface sends only when the save dialog chose the path (F9's rule). None
//! reads the network; none runs a program but the system's own viewer, on a
//! click, for a file this session wrote ([`report_open`]).
//!
//! The diary's two exports verify the chain first, here, over the very rows
//! they write; when it does not hold, nothing is written and the refusal says
//! which entry broke (ADR-032). The PDF carries the host's own verification
//! block in front of the interface's words (`report::verification`).
//!
//! Each command answers with what it wrote: `{ path, bytes, pages? }`.
//!
//! # Changelog of this boundary
//!
//! - F10: `report_pdf_write`, `diary_export_pdf`, `diary_export_csv`,
//!   `work_export_json`, `report_open`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::State;

use crate::commands::work::with_work;
use crate::contract::WrittenFile;
use crate::db::{self, diary, lock};
use crate::error::{Error, Result};
use crate::files::save;
use crate::folder::OpenWork;
use crate::report::csv::{self, Names, Separator};
use crate::report::model::{self, ReportDocument, ReportKind};
use crate::report::{self, json, Verified, CSV_FILE, JSON_FILE, PDF_FILE};

/// The files the report commands wrote in this session, by their canonical
/// path — the only files [`report_open`] opens.
#[derive(Debug, Default)]
pub struct Written(pub Mutex<HashSet<PathBuf>>);

impl Written {
    fn record(&self, path: &Path) {
        match std::fs::canonicalize(path) {
            Ok(canonical) => {
                lock(&self.0).insert(canonical);
            }
            Err(error) => log::warn!("a report was written but cannot be found again: {error}"),
        }
    }

    fn holds(&self, path: &Path) -> bool {
        std::fs::canonicalize(path).is_ok_and(|canonical| lock(&self.0).contains(&canonical))
    }
}

/// The sentence for a diary document sent to the report command.
pub const DIARY_ELSEWHERE: &str =
    "The diary is exported with its chain verified: use the diary's own export.";

/// The sentence for a document that is not the diary sent to the diary export.
pub const NOT_THE_DIARY: &str = "The diary's export writes the diary, and this is another report.";

/// The sentence for a file that was not written in this session.
pub const NOT_WRITTEN_HERE: &str =
    "Only a file Ridgebeam wrote in this session can be opened here.";

/// The weekly report or the printed schedule, as a PDF. No work needs to be
/// open: the document holds every word.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document past a limit or of the diary, a date
/// that is not one, or a path that cannot be written; [`Error::Io`] when the
/// disk refuses.
#[tauri::command(rename_all = "snake_case")]
pub fn report_pdf_write(
    written: State<'_, Written>,
    path: String,
    document: ReportDocument,
    overwrite: Option<bool>,
    created_at: String,
) -> Result<WrittenFile> {
    report_pdf_write_with(
        &written,
        &path,
        &document,
        overwrite.unwrap_or(false),
        &created_at,
    )
}

/// The diary as a PDF, the chain verified first and the host's verification
/// block in front.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the chain does not verify (nothing is
/// written; the sentence names the entry), for a document past a limit or not
/// of the diary, a date that is not one, or a path that cannot be written;
/// [`Error::Io`] when the disk refuses; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn diary_export_pdf(
    open: State<'_, OpenWork>,
    written: State<'_, Written>,
    path: String,
    document: ReportDocument,
    overwrite: Option<bool>,
    created_at: String,
) -> Result<WrittenFile> {
    diary_export_pdf_with(
        &open,
        &written,
        &path,
        &document,
        overwrite.unwrap_or(false),
        &created_at,
    )
}

/// The diary as CSV, from the database, the chain verified first.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the chain does not verify (nothing is
/// written), for a separator that is neither `,` nor `;`, or a path that cannot
/// be written; [`Error::Io`] when the disk refuses; and the errors of every
/// work command.
#[tauri::command(rename_all = "snake_case")]
pub fn diary_export_csv(
    open: State<'_, OpenWork>,
    written: State<'_, Written>,
    path: String,
    separator: String,
    overwrite: Option<bool>,
) -> Result<WrittenFile> {
    diary_export_csv_with(
        &open,
        &written,
        &path,
        &separator,
        overwrite.unwrap_or(false),
    )
}

/// The work and its diary as JSON, for anybody else's tool.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that cannot be written; [`Error::Io`]
/// when the disk refuses; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn work_export_json(
    open: State<'_, OpenWork>,
    written: State<'_, Written>,
    path: String,
    overwrite: Option<bool>,
) -> Result<WrittenFile> {
    work_export_json_with(
        &open,
        &written,
        &path,
        overwrite.unwrap_or(false),
        &db::now(),
    )
}

/// Open a file a report command wrote in this session with the system's own
/// viewer — that file, and no other.
///
/// # Errors
///
/// [`Error::InvalidInput`] for any other path; [`Error::Io`] when the system
/// could not open it.
#[tauri::command(rename_all = "snake_case")]
pub fn report_open(written: State<'_, Written>, path: String) -> Result<()> {
    report_open_with(&written, &path, |file| {
        tauri_plugin_opener::open_path(file, None::<&str>).map_err(|error| {
            log::warn!("the system could not open a report: {error}");
            Error::Io(std::io::Error::other("the report could not be opened"))
        })
    })
}

/// Write the bytes and say what was written.
fn save_and_record(
    written: &Written,
    path: &Path,
    bytes: &[u8],
    overwrite: bool,
    kind: &save::Kind,
    pages: Option<usize>,
) -> Result<WrittenFile> {
    save::write(path, bytes, overwrite, kind)?;
    written.record(path);
    Ok(WrittenFile {
        path: path.to_string_lossy().into_owned(),
        bytes: bytes.len() as u64,
        pages,
    })
}

/// The chain of `entries`, or the refusal that says where it broke.
fn verified(entries: &[crate::contract::DiaryEntry]) -> Result<Verified> {
    let report = diary::check_chain(entries);
    if !report.intact {
        let reason = report
            .reason
            .unwrap_or_else(|| "Its chain does not verify.".into());
        return Err(Error::InvalidInput(format!(
            "The diary was not exported, because its chain does not verify. {reason}"
        )));
    }
    Ok(Verified {
        entries: report.entries,
        head: entries.last().map(|entry| entry.hash.clone()),
    })
}

/// What [`report_pdf_write`] does once the state is in hand.
pub fn report_pdf_write_with(
    written: &Written,
    path: &str,
    document: &ReportDocument,
    overwrite: bool,
    created_at: &str,
) -> Result<WrittenFile> {
    let path = Path::new(path);
    save::check_target(path, overwrite, &PDF_FILE)?;
    if document.kind == ReportKind::Diary {
        return Err(Error::InvalidInput(DIARY_ELSEWHERE.into()));
    }
    model::check(document)?;
    let moment = report::created_at(created_at)?;
    let pdf = report::render(document, &[], &moment)?;
    save_and_record(
        written,
        path,
        &pdf.bytes,
        overwrite,
        &PDF_FILE,
        Some(pdf.pages),
    )
}

/// What [`diary_export_pdf`] does once the state is in hand.
pub fn diary_export_pdf_with(
    open: &OpenWork,
    written: &Written,
    path: &str,
    document: &ReportDocument,
    overwrite: bool,
    created_at: &str,
) -> Result<WrittenFile> {
    let path = Path::new(path);
    save::check_target(path, overwrite, &PDF_FILE)?;
    if document.kind != ReportKind::Diary {
        return Err(Error::InvalidInput(NOT_THE_DIARY.into()));
    }
    model::check(document)?;
    let moment = report::created_at(created_at)?;
    // The chain is verified, and the file written, while the work is held: no
    // entry is appended between the two.
    with_work(open, |state| {
        let chain = verified(&diary::all(&state.conn)?)?;
        let prelude = report::verification(document.language, &chain, &moment);
        let pdf = report::render(document, &prelude, &moment)?;
        save_and_record(
            written,
            path,
            &pdf.bytes,
            overwrite,
            &PDF_FILE,
            Some(pdf.pages),
        )
    })
}

/// What [`diary_export_csv`] does once the state is in hand.
pub fn diary_export_csv_with(
    open: &OpenWork,
    written: &Written,
    path: &str,
    separator: &str,
    overwrite: bool,
) -> Result<WrittenFile> {
    let path = Path::new(path);
    save::check_target(path, overwrite, &CSV_FILE)?;
    let separator = Separator::parse(separator)?;
    with_work(open, |state| {
        let entries = diary::all(&state.conn)?;
        verified(&entries)?;
        let names = Names::of(&db::work::snapshot(&state.conn)?);
        let text = csv::diary(&entries, &names, separator);
        save_and_record(written, path, text.as_bytes(), overwrite, &CSV_FILE, None)
    })
}

/// What [`work_export_json`] does once the state and the moment are in hand.
pub fn work_export_json_with(
    open: &OpenWork,
    written: &Written,
    path: &str,
    overwrite: bool,
    exported_at: &str,
) -> Result<WrittenFile> {
    let path = Path::new(path);
    save::check_target(path, overwrite, &JSON_FILE)?;
    with_work(open, |state| {
        let snapshot = db::work::snapshot(&state.conn)?;
        let entries = diary::all(&state.conn)?;
        let text = json::work(&snapshot, &entries, exported_at)?;
        save_and_record(written, path, text.as_bytes(), overwrite, &JSON_FILE, None)
    })
}

/// What [`report_open`] does, with the opener passed in (a test does not
/// start a viewer).
pub fn report_open_with(
    written: &Written,
    path: &str,
    opener: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(Error::InvalidInput(NOT_WRITTEN_HERE.into()));
    }
    if !written.holds(path) {
        return Err(Error::InvalidInput(NOT_WRITTEN_HERE.into()));
    }
    // The path as the person's dialog gave it: the same file as the one
    // recorded, and the form the system's viewer expects.
    opener(path)
}
