//! A file written whole, or not at all, to a path a person chose.
//!
//! One path for every file the host writes outside the work folder: a
//! template (F9), every report and export (F10), and a backup (F11). The rules are the same for
//! all of them, and live here once:
//!
//! - the path is a full one, and the name ends in the one extension the kind
//!   of file takes (in any case);
//! - the bytes are not larger than the kind's cap;
//! - the folder it goes in is there, and the name is not a folder;
//! - an existing file is replaced only with `overwrite`, which the interface
//!   sends only when the save dialog chose the path — the dialog asked first;
//! - the bytes go to a temporary file in the same folder, flushed to the disk,
//!   then renamed over the name — so the file is the whole of it or not there,
//!   and no temporary file is left behind when the disk refuses.
//!
//! Every refusal is `invalid_input`, with a sentence that names the file by its
//! own name, never the folders above it.
//!
//! # Changelog of this module
//!
//! - F10: taken out of `files::templates` (F9), where it was written for a
//!   template alone, so that a report is written by the same code.
//! - F11: `write_streamed`, the same rules for a file written in pieces — a
//!   backup, which can be larger than memory; `write` is now that, with the
//!   bytes in hand.

use std::io::Write;
use std::path::Path;

use crate::error::{Error, Result};

/// What a kind of file may be, and the sentences that say what it may not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kind {
    /// The extension, without its dot, lower case: `json`, `pdf`, `csv`.
    pub extension: &'static str,
    /// Why another name is refused — "a template is a .json file".
    pub not_this_kind: &'static str,
    /// The largest file written.
    pub max_bytes: u64,
    /// Why larger bytes are refused — "it would be larger than 1 MiB".
    pub too_large: &'static str,
    /// The sentence for a path that is not a full one.
    pub full_path: &'static str,
    /// What the log calls a file of this kind — "a template".
    pub logged_as: &'static str,
}

/// The name a sentence gives the file: its own, never the folders above it.
pub fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "That file".into())
}

/// Whether the name ends in `.{extension}`, in any case.
pub fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .is_some_and(|found| found.eq_ignore_ascii_case(extension))
}

/// Refuse a path this kind of file cannot be written to — everything
/// [`write`] checks before it has the bytes. Called first by a command that
/// has work to do before it writes, so a path that could never be written is
/// refused before that work is done.
///
/// # Errors
///
/// [`Error::InvalidInput`], as [`write`] names them.
pub fn check_target(path: &Path, overwrite: bool, kind: &Kind) -> Result<()> {
    if !path.is_absolute() {
        return Err(Error::InvalidInput(kind.full_path.into()));
    }
    let refuse = refusal(path);
    if !has_extension(path, kind.extension) {
        return Err(refuse(kind.not_this_kind));
    }
    match path.parent() {
        Some(folder) if folder.is_dir() => {}
        _ => return Err(refuse("the folder it would go in is not there")),
    }
    if path.is_dir() {
        return Err(refuse("a folder of that name is already there"));
    }
    if path.exists() && !overwrite {
        return Err(refuse(
            "a file of that name is already there; choose it in the save dialog to replace it",
        ));
    }
    Ok(())
}

/// The sentence for a file not saved, naming it and why.
fn refusal(path: &Path) -> impl Fn(&str) -> Error {
    let name = display_name(path);
    move |reason: &str| Error::InvalidInput(format!("“{name}” was not saved: {reason}."))
}

/// Write `bytes` to `path`, whole or not at all: a temporary file in the same
/// folder, flushed to the disk, then renamed to `path`. An existing file is
/// replaced only when `overwrite` says the person chose it in the save dialog.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that is not a full one, a name without
/// the kind's extension, bytes larger than its cap, a folder that is not
/// there, a folder where the file would be, or a file already there without
/// `overwrite`; [`Error::Io`] when the disk refuses the write — and then no
/// temporary file is left behind.
pub fn write(path: &Path, bytes: &[u8], overwrite: bool, kind: &Kind) -> Result<()> {
    if !path.is_absolute() {
        return Err(Error::InvalidInput(kind.full_path.into()));
    }
    if has_extension(path, kind.extension) && bytes.len() as u64 > kind.max_bytes {
        return Err(refusal(path)(kind.too_large));
    }
    write_streamed(path, overwrite, kind, |file| {
        file.write_all(bytes)?;
        Ok(bytes.len() as u64)
    })
}

/// A temporary name beside `path`, in the same folder, that no other call
/// will choose: `.<name>.<uuid>.<suffix>`.
pub fn temporary_beside(path: &Path, suffix: &str) -> Option<std::path::PathBuf> {
    path.parent().map(|folder| {
        folder.join(format!(
            ".{}.{}.{suffix}",
            display_name(path),
            crate::db::new_id()
        ))
    })
}

/// [`write`], for a file too large to hold in memory: `fill` writes the bytes
/// into the temporary file and says how many it wrote; the file is flushed to
/// the disk and renamed to `path` only when `fill` succeeds and the count is
/// within the kind's cap. A backup (F11) is written this way.
///
/// # Errors
///
/// As [`write`]; and whatever `fill` returns — after which no temporary file
/// is left behind.
pub fn write_streamed(
    path: &Path,
    overwrite: bool,
    kind: &Kind,
    fill: impl FnOnce(&mut std::fs::File) -> Result<u64>,
) -> Result<()> {
    check_target(path, overwrite, kind)?;
    let refuse = refusal(path);
    let temporary = temporary_beside(path, "tmp")
        .ok_or_else(|| refuse("the folder it would go in is not there"))?;

    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
    {
        Ok(file) => file,
        Err(error) => return Err(Error::Io(error)),
    };
    let filled = fill(&mut file).and_then(|count| {
        if count > kind.max_bytes {
            Err(refuse(kind.too_large))
        } else {
            file.sync_all().map_err(Error::Io)
        }
    });
    drop(file);
    let written = filled.and_then(|()| std::fs::rename(&temporary, path).map_err(Error::Io));
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    log::info!("{} was saved", kind.logged_as);
    Ok(())
}
