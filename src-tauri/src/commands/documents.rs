//! The commands for documents: add files to the work, file them, attach and
//! detach them, remove them, open them, show them small — and check the folder.
//!
//! Adding is **per file**: a batch of ten with one file the product does not
//! keep keeps the nine and names the one, with its reason. Each file is its own
//! copy-in and its own row: a batch is not a diary entry.
//!
//! Removing a document removes its row and its links. The file itself goes
//! only when nothing else in the work names its bytes — a diary photo, an
//! answer's photo, a receipt, a quote; otherwise it stays, and the log says so.
//!
//! `documents_verify` re-reads every document's bytes and compares them with
//! the hash its row recorded — what `diary_verify` does not do, because the
//! chain covers rows, not files. Files no row names are listed as orphans and
//! **never deleted by the product**: they are the person's to look at.
//!
//! # Changelog of this boundary
//!
//! - F7: `document_add`, `document_update`, `document_link`,
//!   `document_unlink`, `document_remove`, `document_open`,
//!   `document_thumbnail`, `documents_verify`, `folder_health`.
//! - D3: a document may be filed as a `warranty` or a `manual`.
//! - G5: `document_add` answers every file it kept (`added`), with what a
//!   HEIC was before it was converted to the JPEG kept (`convertedFrom`).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use tauri::State;

use crate::commands::work::{change_work, with_work};
use crate::contract::{
    AddedFile, DocumentPatch, DocumentTarget, DocumentsAdded, DocumentsReport, FolderHealth,
    MismatchedDocument, MissingDocument, RefusedFile, WorkSnapshot,
};
use crate::db::documents::{self as repo, NewDocument, KINDS};
use crate::db::work as plan;
use crate::error::{Error, Result};
use crate::files::intake::{self, Accept, CopyIn, Format, DOCUMENTS, THUMBNAILS};
use crate::folder::OpenWork;
use crate::os::account;

/// Copy files into the work, each on its own, and attach every one kept to
/// `target` — or to the work, when `target` is `null`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a kind or a target that is not one (then
/// nothing is copied), and the errors of every work command. A file refused is
/// not an error: it is listed in the answer with its reason.
#[tauri::command(rename_all = "snake_case")]
pub fn document_add(
    open: State<'_, OpenWork>,
    paths: Vec<String>,
    kind: String,
    target: Option<DocumentTarget>,
) -> Result<DocumentsAdded> {
    let today = chrono::Local::now().date_naive();
    document_add_with(
        &open,
        &paths,
        &kind,
        target.as_ref(),
        today,
        &account::display_name(),
    )
}

/// Change a document's title or kind.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a value that does not fit or a document not in
/// this work, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn document_update(
    open: State<'_, OpenWork>,
    id: String,
    patch: DocumentPatch,
) -> Result<WorkSnapshot> {
    document_update_with(&open, &id, &patch)
}

/// Attach a document to a target.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document or a target not in this work, and
/// the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn document_link(
    open: State<'_, OpenWork>,
    id: String,
    target: DocumentTarget,
) -> Result<WorkSnapshot> {
    change_work(&open, |conn| repo::link(conn, &id, &target))
}

/// Detach a document from a target; it stays in the library.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work or a link it does
/// not have, and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn document_unlink(
    open: State<'_, OpenWork>,
    id: String,
    target: DocumentTarget,
) -> Result<WorkSnapshot> {
    change_work(&open, |conn| repo::unlink(conn, &id, &target))
}

/// Remove a document from the library. Its file goes only when nothing else
/// names its bytes.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work, and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn document_remove(open: State<'_, OpenWork>, id: String) -> Result<WorkSnapshot> {
    document_remove_with(&open, &id)
}

/// Open a document's file with the operating system's own handler.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work or whose file is
/// gone; [`Error::Io`] when the system could not open it; and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn document_open(open: State<'_, OpenWork>, id: String) -> Result<()> {
    with_work(&open, |state| {
        let (hash, _, _) = repo::file_of(&state.conn, &id)?;
        intake::open(&state.folder, &hash)
    })
}

/// An image document's thumbnail as a `data:` URL; `null` for a PDF — never
/// rendered — or an image that could not be drawn small.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a document not in this work, and the errors of
/// every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn document_thumbnail(open: State<'_, OpenWork>, id: String) -> Result<Option<String>> {
    document_thumbnail_with(&open, &id)
}

/// Re-read every document's bytes and compare them with the recorded hashes;
/// list what is missing, and the files no row names.
///
/// # Errors
///
/// The errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn documents_verify(open: State<'_, OpenWork>) -> Result<DocumentsReport> {
    documents_verify_with(&open)
}

/// The work folder, measured.
///
/// # Errors
///
/// The errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn folder_health(open: State<'_, OpenWork>) -> Result<FolderHealth> {
    folder_health_with(&open)
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// File what a diary entry, an answer, a payment or a quote just brought in:
/// a file copied in becomes a document (or, if the work already holds its
/// bytes, gains a link); a file re-attached by hash gains a link.
///
/// Called after the entry, answer, payment or quote is written, so a failure
/// here cannot undo it: it is logged, and the file is still named by its row.
pub(crate) fn file_it(
    conn: &rusqlite::Connection,
    hash: &str,
    copied: Option<&intake::Copied>,
    kind: &str,
    added_on: &str,
    author: &str,
    target: &DocumentTarget,
) {
    let filed = match copied {
        Some(copied) => repo::record(
            conn,
            &NewDocument {
                file_hash: hash,
                file_name: &copied.file_name,
                format: copied.format,
                bytes: copied.bytes,
                size: copied
                    .format
                    .is_image()
                    .then_some((copied.width, copied.height)),
                kind,
                added_on,
                author_name: author,
            },
            Some(target),
        )
        .map(|_| ()),
        None => repo::link_hash(conn, hash, target),
    };
    if let Err(error) = filed {
        log::warn!("a file was kept but could not be filed as a document: {error}");
    }
}

fn kind_of(value: &str) -> Result<&str> {
    if KINDS.contains(&value) {
        Ok(value)
    } else {
        Err(invalid(
            "A document is a photo, a quote, a drawing, a permit, a receipt, a contract, a warranty, a manual, or other.",
        ))
    }
}

/// The name a path shows, for a refusal that names it.
fn name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// What [`document_add`] does once the state, today and the author are in hand.
pub fn document_add_with(
    open: &OpenWork,
    paths: &[String],
    kind: &str,
    target: Option<&DocumentTarget>,
    today: NaiveDate,
    author: &str,
) -> Result<DocumentsAdded> {
    let kind = kind_of(kind)?;
    let added_on = today.format("%Y-%m-%d").to_string();
    with_work(open, |state| {
        let target = match target {
            Some(target) => target.clone(),
            None => DocumentTarget {
                target_kind: "work".into(),
                target_id: state.work_id.clone(),
            },
        };
        repo::check_target(&state.conn, &target)?;

        let mut refused = Vec::new();
        let mut added = Vec::new();
        for path in paths {
            let source = PathBuf::from(path);
            if !source.is_absolute() {
                refused.push(RefusedFile {
                    file_name: name_of(path),
                    reason: format!(
                        "“{}” was not added: a file is chosen by its full path.",
                        name_of(path)
                    ),
                });
                continue;
            }
            // One file, one copy-in, one row: a refusal is this file's alone.
            let mut copy = CopyIn::new(&state.folder);
            let copied = match copy.copy(&source, Accept::Documents) {
                Ok(copied) => copied,
                Err(Error::PhotoRefused(reason)) => {
                    refused.push(RefusedFile {
                        file_name: name_of(path),
                        reason,
                    });
                    continue;
                }
                Err(other) => return Err(other),
            };
            repo::record(
                &state.conn,
                &NewDocument {
                    file_hash: &copied.hash,
                    file_name: &copied.file_name,
                    format: copied.format,
                    bytes: copied.bytes,
                    size: copied
                        .format
                        .is_image()
                        .then_some((copied.width, copied.height)),
                    kind,
                    added_on: &added_on,
                    author_name: author,
                },
                Some(&target),
            )?;
            copy.keep();
            added.push(AddedFile {
                file_name: copied.file_name,
                file_hash: copied.hash,
                converted_from: copied.converted_from.map(str::to_string),
            });
        }
        Ok(DocumentsAdded {
            snapshot: plan::snapshot(&state.conn)?,
            refused,
            added,
        })
    })
}

/// What [`document_update`] does once the state is in hand.
pub fn document_update_with(
    open: &OpenWork,
    id: &str,
    patch: &DocumentPatch,
) -> Result<WorkSnapshot> {
    let title = match patch.title.as_deref().map(str::trim) {
        None => None,
        Some("") => return Err(invalid("A document needs a title.")),
        Some(title) if title.chars().count() > 200 => {
            return Err(invalid("A document's title is at most 200 characters."))
        }
        Some(title) => Some(title.to_string()),
    };
    let kind = patch.kind.as_deref().map(kind_of).transpose()?;
    change_work(open, |conn| repo::update(conn, id, title.as_deref(), kind))
}

/// What [`document_remove`] does once the state is in hand.
pub fn document_remove_with(open: &OpenWork, id: &str) -> Result<WorkSnapshot> {
    with_work(open, |state| {
        let hash = repo::remove(&state.conn, id)?;
        if repo::hash_is_named(&state.conn, &hash)? {
            log::info!("a document was removed; its file stays, because the work still names it");
        } else {
            intake::remove_files(&state.folder, &hash);
            log::info!("a document was removed with its file");
        }
        plan::snapshot(&state.conn)
    })
}

/// What [`document_thumbnail`] does once the state is in hand.
pub fn document_thumbnail_with(open: &OpenWork, id: &str) -> Result<Option<String>> {
    with_work(open, |state| {
        let (hash, media_type, _) = repo::file_of(&state.conn, id)?;
        if media_type.as_deref() == Some(Format::Pdf.media_type()) {
            return Ok(None);
        }
        Ok(intake::thumbnail_data_url(&state.folder, &hash).ok())
    })
}

/// What [`documents_verify`] does once the state is in hand.
pub fn documents_verify_with(open: &OpenWork) -> Result<DocumentsReport> {
    with_work(open, |state| {
        let rows = repo::all_files(&state.conn)?;
        let mut mismatched = Vec::new();
        let mut missing = Vec::new();
        for (id, file_name, hash) in &rows {
            let bytes =
                intake::original(&state.folder, hash).and_then(|path| std::fs::read(path).ok());
            match bytes {
                None => missing.push(MissingDocument {
                    id: id.clone(),
                    file_name: file_name.clone(),
                    file_hash: hash.clone(),
                }),
                Some(bytes) => {
                    let found = intake::sha256_hex(&bytes);
                    if &found != hash {
                        mismatched.push(MismatchedDocument {
                            id: id.clone(),
                            file_name: file_name.clone(),
                            expected: hash.clone(),
                            found,
                        });
                    }
                }
            }
        }
        let named = repo::named_hashes(&state.conn)?;
        Ok(DocumentsReport {
            checked: rows.len() as i64,
            mismatched,
            missing,
            orphans: orphans(&state.folder, &named),
        })
    })
}

/// Files in `documents/` and `thumbnails/` that no row names: listed as
/// `documents/<name>` or `thumbnails/<name>`, never removed.
fn orphans(folder: &Path, named: &BTreeSet<String>) -> Vec<String> {
    let known_extensions: Vec<&str> = Format::ALL.iter().map(|f| f.extension()).collect();
    let mut found = Vec::new();
    for (sub, extensions) in [
        (DOCUMENTS, known_extensions.clone()),
        (THUMBNAILS, vec!["jpg"]),
    ] {
        let Ok(entries) = std::fs::read_dir(folder.join(sub)) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let belongs = name
                .split_once('.')
                .is_some_and(|(stem, ext)| named.contains(stem) && extensions.contains(&ext));
            if !belongs {
                found.push(format!("{sub}/{name}"));
            }
        }
    }
    found.sort();
    found
}

/// What [`folder_health`] does once the state is in hand.
pub fn folder_health_with(open: &OpenWork) -> Result<FolderHealth> {
    with_work(open, |state| {
        let count = |sub: &str| {
            std::fs::read_dir(state.folder.join(sub))
                .map(|entries| entries.flatten().filter(|e| e.path().is_file()).count() as i64)
                .unwrap_or(0)
        };
        Ok(FolderHealth {
            folder_bytes: size_of(&state.folder),
            document_files: count(DOCUMENTS),
            thumbnail_files: count(THUMBNAILS),
        })
    })
}

/// Every byte under a folder.
fn size_of(folder: &Path) -> i64 {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                size_of(&path)
            } else {
                entry.metadata().map(|m| m.len() as i64).unwrap_or(0)
            }
        })
        .sum()
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::commands::plan::stage_add_with;
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;
    use crate::db::lock;
    use crate::db::testing::Scratch;
    use crate::files::intake::tests::{jpeg, png};

    const AUTHOR: &str = "A. Architect (synthetic)";

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
    }

    fn folder_of(open: &OpenWork) -> PathBuf {
        lock(&open.0).as_ref().unwrap().folder.clone()
    }

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> String {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    /// The smallest file a PDF reader would open — never parsed here: only its
    /// first five bytes are read.
    pub fn minimal_pdf() -> Vec<u8> {
        b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
            .to_vec()
    }

    #[test]
    fn a_batch_keeps_what_it_can_and_names_what_it_cannot() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let source = Scratch::create();
        let paths = vec![
            write(source.path(), "plan.png", &png(64, 48)),
            write(
                source.path(),
                "lie.docx",
                b"PK\x03\x04 a word document, as far as its name goes",
            ),
            write(source.path(), "permit.pdf", &minimal_pdf()),
            "relative/drawing.png".to_string(),
        ];
        let target = DocumentTarget {
            target_kind: "stage".into(),
            target_id: stage.clone(),
        };

        let added =
            document_add_with(&open, &paths, "drawing", Some(&target), today(), AUTHOR).unwrap();

        assert_eq!(added.snapshot.documents.len(), 2);
        let names: Vec<&str> = added.refused.iter().map(|r| r.file_name.as_str()).collect();
        assert_eq!(names, vec!["lie.docx", "drawing.png"]);
        let kept: Vec<&str> = added.added.iter().map(|a| a.file_name.as_str()).collect();
        assert_eq!(kept, vec!["plan.png", "permit.pdf"], "every file kept");
        assert!(added.added.iter().all(|a| a.converted_from.is_none()));
        assert_eq!(
            serde_json::to_value(&added).unwrap()["added"][0]["convertedFrom"],
            serde_json::Value::Null
        );
        assert_eq!(
            added.refused[0].reason,
            "“lie.docx” was not added: Ridgebeam keeps photos and PDFs, and this is neither."
        );
        let pdf = added
            .snapshot
            .documents
            .iter()
            .find(|d| d.file_name == "permit.pdf")
            .unwrap();
        let wire = serde_json::to_value(pdf).unwrap();
        assert_eq!(wire["mediaType"], "application/pdf");
        assert_eq!(wire["width"], serde_json::Value::Null);
        assert_eq!(wire["kind"], "drawing");
        assert_eq!(wire["title"], "permit.pdf");
        assert_eq!(wire["addedOn"], "2026-10-09");
        assert_eq!(wire["authorName"], AUTHOR);
        assert_eq!(
            wire["links"],
            serde_json::json!([{ "targetKind": "stage", "targetId": stage }])
        );
        assert_eq!(
            document_thumbnail_with(&open, &pdf.id).unwrap(),
            None,
            "a PDF is a mark"
        );
        let image = added
            .snapshot
            .documents
            .iter()
            .find(|d| d.file_name == "plan.png")
            .unwrap();
        assert_eq!((image.width, image.height), (Some(64), Some(48)));
        assert!(document_thumbnail_with(&open, &image.id)
            .unwrap()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
        let folder = folder_of(&open);
        assert!(folder
            .join(format!("documents/{}.pdf", pdf.file_hash))
            .is_file());
        assert!(!folder
            .join(format!("thumbnails/{}.jpg", pdf.file_hash))
            .exists());
        work_close_with(&open);
    }

    #[test]
    fn the_same_bytes_added_again_are_one_document_with_one_more_link() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let source = Scratch::create();
        let bytes = png(40, 40);
        let first = write(source.path(), "plan.png", &bytes);
        let second = write(source.path(), "plan (copy).png", &bytes);

        document_add_with(&open, &[first], "drawing", None, today(), AUTHOR).unwrap();
        let target = DocumentTarget {
            target_kind: "stage".into(),
            target_id: stage,
        };
        let added =
            document_add_with(&open, &[second], "photo", Some(&target), today(), AUTHOR).unwrap();

        assert_eq!(added.snapshot.documents.len(), 1);
        let document = &added.snapshot.documents[0];
        assert_eq!(document.links.len(), 2, "the work and the stage");
        assert_eq!(document.kind, "drawing", "the first filing stays");
        assert_eq!(
            std::fs::read_dir(folder_of(&open).join("documents"))
                .unwrap()
                .count(),
            1,
            "one copy"
        );
        work_close_with(&open);
    }

    #[test]
    fn a_document_is_retitled_detached_and_its_file_goes_with_its_last_name() {
        let (_db, open, _scratch) = host_with_a_work();
        let source = Scratch::create();
        let path = write(source.path(), "site.jpg", &jpeg(32, 32));
        let added = document_add_with(&open, &[path], "photo", None, today(), AUTHOR).unwrap();
        let document = added.snapshot.documents[0].clone();
        let work = document.links[0].clone();

        let patch: DocumentPatch = serde_json::from_value(
            serde_json::json!({ "title": " Kitchen, north wall ", "kind": "other" }),
        )
        .unwrap();
        let plan = document_update_with(&open, &document.id, &patch).unwrap();
        assert_eq!(
            (
                plan.documents[0].title.as_str(),
                plan.documents[0].kind.as_str()
            ),
            ("Kitchen, north wall", "other")
        );
        let plan = change_work(&open, |conn| repo::unlink(conn, &document.id, &work)).unwrap();
        assert!(
            plan.documents[0].links.is_empty(),
            "detached, still in the library"
        );

        let plan = document_remove_with(&open, &document.id).unwrap();
        assert!(plan.documents.is_empty());
        let folder = folder_of(&open);
        assert!(!folder
            .join(format!("documents/{}.jpg", document.file_hash))
            .exists());
        assert!(!folder
            .join(format!("thumbnails/{}.jpg", document.file_hash))
            .exists());
        work_close_with(&open);
    }

    #[test]
    fn a_target_that_is_not_in_this_work_refuses_the_batch_before_anything_is_copied() {
        let (_db, open, _scratch) = host_with_a_work();
        let source = Scratch::create();
        let path = write(source.path(), "plan.png", &png(8, 8));
        for (kind, target) in [
            (
                "drawing",
                DocumentTarget {
                    target_kind: "stage".into(),
                    target_id: crate::db::new_id(),
                },
            ),
            (
                "drawing",
                DocumentTarget {
                    target_kind: "room".into(),
                    target_id: "x".into(),
                },
            ),
            (
                "drawing",
                DocumentTarget {
                    target_kind: "entry".into(),
                    target_id: "01".into(),
                },
            ),
            (
                "drawing",
                DocumentTarget {
                    target_kind: "payment".into(),
                    target_id: "1".into(),
                },
            ),
            (
                "invoice",
                DocumentTarget {
                    target_kind: "work".into(),
                    target_id: "x".into(),
                },
            ),
        ] {
            let refused = document_add_with(
                &open,
                std::slice::from_ref(&path),
                kind,
                Some(&target),
                today(),
                AUTHOR,
            )
            .unwrap_err();
            assert_eq!(refused.kind(), "invalid_input", "{kind} {target:?}");
        }
        assert!(
            !folder_of(&open).join("documents").exists(),
            "nothing was copied"
        );
        work_close_with(&open);
    }

    /// The bytes are checked, not the rows: a swapped file is caught, a missing
    /// one is listed, and a file nothing names is listed and left alone.
    #[test]
    fn verify_catches_a_swapped_file_lists_a_missing_one_and_never_deletes_an_orphan() {
        let (_db, open, _scratch) = host_with_a_work();
        let source = Scratch::create();
        let paths = vec![
            write(source.path(), "a.png", &png(10, 10)),
            write(source.path(), "b.png", &png(12, 12)),
        ];
        let added = document_add_with(&open, &paths, "photo", None, today(), AUTHOR).unwrap();
        let (a, b) = (&added.snapshot.documents[0], &added.snapshot.documents[1]);
        let report = documents_verify_with(&open).unwrap();
        assert_eq!(
            serde_json::to_value(&report).unwrap(),
            serde_json::json!({ "checked": 2, "mismatched": [], "missing": [], "orphans": [] })
        );

        let folder = folder_of(&open);
        std::fs::write(
            folder.join(format!("documents/{}.png", a.file_hash)),
            png(11, 11),
        )
        .unwrap();
        std::fs::remove_file(folder.join(format!("documents/{}.png", b.file_hash))).unwrap();
        let stray = folder.join(format!("documents/{}.png", "ab".repeat(32)));
        std::fs::write(&stray, b"stray").unwrap();
        std::fs::write(folder.join("thumbnails/notes.txt"), b"left here").unwrap();

        let report = documents_verify_with(&open).unwrap();

        assert_eq!(report.checked, 2);
        assert_eq!(report.mismatched.len(), 1);
        assert_eq!(report.mismatched[0].id, a.id);
        assert_eq!(report.mismatched[0].expected, a.file_hash);
        assert_ne!(report.mismatched[0].found, a.file_hash);
        assert_eq!(report.missing.len(), 1);
        assert_eq!(report.missing[0].file_hash, b.file_hash);
        assert_eq!(
            report.orphans,
            vec![
                format!("documents/{}.png", "ab".repeat(32)),
                "thumbnails/notes.txt".to_string()
            ]
        );
        assert!(stray.exists(), "an orphan is listed, never deleted");

        let health = folder_health_with(&open).unwrap();
        assert_eq!((health.document_files, health.thumbnail_files), (2, 3));
        assert!(health.folder_bytes > 0);
        work_close_with(&open);
    }

    /// A diary photo is a document of the work from the moment it is copied in,
    /// linked to its entry by seq — and removing that document from the
    /// library leaves the file, because the diary still names it.
    #[test]
    fn a_diary_photo_is_a_document_and_removing_the_document_keeps_the_file_the_diary_names() {
        let (_db, open, _scratch) = host_with_a_work();
        let source = Scratch::create();
        let path = write(source.path(), "wall.png", &png(50, 40));
        let draft: crate::contract::EntryDraft = serde_json::from_value(serde_json::json!({
            "day": "2026-10-08", "kind": "entry", "photoPaths": [path]
        }))
        .unwrap();
        let entry =
            crate::commands::diary::diary_entry_add_with(&open, &draft, today(), AUTHOR).unwrap();

        let plan = crate::commands::work::work_get_with(&open).unwrap();
        assert_eq!(plan.documents.len(), 1);
        let document = plan.documents[0].clone();
        assert_eq!(document.file_hash, entry.photos[0].file_hash);
        assert_eq!(
            (document.kind.as_str(), document.media_type.as_str()),
            ("photo", "image/png")
        );
        assert_eq!(
            document.links,
            vec![DocumentTarget {
                target_kind: "entry".into(),
                target_id: entry.seq.to_string(),
            }]
        );

        let plan = document_remove_with(&open, &document.id).unwrap();
        assert!(plan.documents.is_empty(), "gone from the library");
        let folder = folder_of(&open);
        assert!(
            folder
                .join(format!("documents/{}.png", document.file_hash))
                .is_file(),
            "the diary still names the file, so it stays"
        );
        assert_eq!(
            crate::commands::diary::diary_entry_with(&open, entry.seq)
                .unwrap()
                .photos,
            entry.photos,
            "and the diary is untouched"
        );
        let report = documents_verify_with(&open).unwrap();
        assert!(
            report.orphans.is_empty(),
            "a file the diary names is not an orphan"
        );
        work_close_with(&open);
    }

    /// A receipt — now an image or a PDF — is a document linked to its payment
    /// by seq.
    #[test]
    fn a_pdf_receipt_is_kept_and_filed_under_its_payment() {
        let (_db, open, _scratch) = host_with_a_work();
        let stage = stage_add_with(&open, "Tiling").unwrap().stages[0]
            .id
            .clone();
        let source = Scratch::create();
        let path = write(source.path(), "receipt.pdf", &minimal_pdf());
        let draft: crate::contract::PaymentDraft = serde_json::from_value(serde_json::json!({
            "day": "2026-10-08", "stageId": stage, "amountCents": 100000, "receiptPath": path
        }))
        .unwrap();

        let plan =
            crate::commands::money::payment_add_with(&open, &draft, today(), AUTHOR).unwrap();

        assert_eq!(plan.documents.len(), 1);
        let document = &plan.documents[0];
        assert_eq!(
            (document.kind.as_str(), document.media_type.as_str()),
            ("receipt", "application/pdf")
        );
        assert_eq!(
            document.links,
            vec![DocumentTarget {
                target_kind: "payment".into(),
                target_id: "1".into(),
            }]
        );
        assert_eq!(
            plan.payments[0].receipt_hash.as_deref(),
            Some(document.file_hash.as_str())
        );
        work_close_with(&open);
    }

    #[test]
    fn document_commands_with_no_work_open_are_no_work_open() {
        let (_db, open) = host();
        assert_eq!(
            documents_verify_with(&open).unwrap_err().kind(),
            "no_work_open"
        );
        assert_eq!(
            document_add_with(&open, &[], "photo", None, today(), AUTHOR)
                .unwrap_err()
                .kind(),
            "no_work_open"
        );
    }

    /// G5: a HEIC through the Documents page — a photo whose name is kept and
    /// whose bytes are a JPEG; the answer lists every file kept and says which
    /// one was converted.
    #[cfg(windows)]
    #[test]
    fn a_heic_is_added_as_a_jpeg_under_its_own_name_and_the_answer_says_it_was_converted() {
        let Some(heic) = crate::files::intake::tests::heic_or_skip("document_add", None) else {
            return;
        };
        let (_db, open, _scratch) = host_with_a_work();
        let source = Scratch::create();
        let paths = vec![
            write(source.path(), "IMG_0001.HEIC", &heic),
            write(source.path(), "plan.png", &png(64, 48)),
        ];

        let added = document_add_with(&open, &paths, "photo", None, today(), AUTHOR).unwrap();

        assert!(added.refused.is_empty(), "{:?}", added.refused);
        let wire = serde_json::to_value(&added.added).unwrap();
        assert_eq!(wire[0]["fileName"], "IMG_0001.HEIC");
        assert_eq!(wire[0]["convertedFrom"], "HEIC");
        assert_eq!(wire[1]["fileName"], "plan.png");
        assert_eq!(
            wire[1].get("convertedFrom"),
            Some(&serde_json::Value::Null),
            "null, never absent"
        );
        let photo = added
            .snapshot
            .documents
            .iter()
            .find(|d| d.file_name == "IMG_0001.HEIC")
            .unwrap();
        assert_eq!(photo.file_hash, added.added[0].file_hash);
        assert_eq!(photo.media_type, "image/jpeg");
        assert_eq!((photo.width, photo.height), (Some(64), Some(48)));
        assert_eq!(photo.kind, "photo");
        assert!(folder_of(&open)
            .join(DOCUMENTS)
            .join(format!("{}.jpg", photo.file_hash))
            .is_file());
        assert!(document_thumbnail_with(&open, &photo.id)
            .unwrap()
            .expect("a thumbnail")
            .starts_with("data:image/jpeg;base64,"));
        work_close_with(&open);
    }
}
