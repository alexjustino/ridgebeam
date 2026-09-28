//! The hostile archive corpus (F11, decision 3): every backup here is
//! generated in the test, from a real backup of a synthetic work, and
//! committed nowhere.
//!
//! Unlike F7's corpus (`files::hostile`), there is **no committed manifest of
//! hashes**: each case is derived from a backup written moments before, and a
//! backup holds a work with a fresh UUID and its own timestamps, so its bytes
//! are new on every run. What is fixed is the list of cases and what each must
//! produce, below.
//!
//! Each case is one way a `.ridgebeam` file can lie. Every other part of it is
//! kept honest — the manifest rewritten and re-hashed around the lie where the
//! lie is not the manifest — so that each case is refused by the one check it
//! is there for, and not by an earlier one by accident. Each must be refused
//! by `backup_restore` as `invalid_input`, with a sentence that names the file
//! and says why; nothing may be written — no target folder, no temporary
//! folder beside it; and the work that was open stays open. Where the lie is
//! visible without inflating anything, `backup_inspect` refuses it with the
//! same sentence.

use std::io::Write;
use std::path::Path;

use flate2::write::DeflateEncoder;
use flate2::{Compression, Crc};
use rusqlite::Connection;

use crate::commands::backup::{backup_inspect_with, backup_restore_with, backup_write_with};
use crate::commands::backup_tests::entries_of;
use crate::commands::documents::document_add_with;
use crate::commands::documents::tests::minimal_pdf;
use crate::commands::work::tests::{draft, host_with_a_work};
use crate::commands::work::{work_close_with, work_create_with, work_current_with};
use crate::db::testing::Scratch;
use crate::files::archive::raw::{build, RawEntry};
use crate::files::archive::Method;
use crate::files::backup::{Manifest, MANIFEST, MANIFEST_HASH};
use crate::files::intake::{sha256_hex, tests::png};
use crate::folder::WORK_FILE;

/// One archive of the corpus.
struct Case {
    /// The file's name.
    name: &'static str,
    /// Its bytes.
    bytes: Vec<u8>,
    /// Words its refusal must contain, after "“<name>” cannot be restored:".
    words: &'static str,
    /// Whether `backup_inspect` sees it too, without inflating anything.
    inspect_refuses: bool,
}

/// The entries of a backup, as a list that can be changed.
type Entries = Vec<(String, Vec<u8>)>;

fn honest(name: &str, bytes: &[u8]) -> RawEntry {
    let method = if name == WORK_FILE {
        Method::Deflate
    } else {
        Method::Store
    };
    RawEntry::honest(name, method, bytes)
}

/// The manifest of `entries`: `base`'s, with its files rewritten from the
/// entries between the manifest and its hash.
fn manifest_for(base: &Manifest, files: &[(String, Vec<u8>)]) -> Manifest {
    let mut manifest = base.clone();
    manifest.files = files
        .iter()
        .map(|(name, bytes)| crate::files::backup::ManifestFile {
            path: name.clone(),
            bytes: bytes.len() as u64,
            sha256: sha256_hex(bytes),
        })
        .collect();
    manifest
}

fn manifest_text(manifest: &Manifest) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(manifest).unwrap();
    text.push('\n');
    text.into_bytes()
}

fn hash_line(manifest: &[u8]) -> Vec<u8> {
    format!("{}  {MANIFEST}\n", sha256_hex(manifest)).into_bytes()
}

/// An archive of `files` with a manifest that tells the truth about them.
fn repack(base: &Manifest, files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let manifest = manifest_text(&manifest_for(base, files));
    let mut raw = vec![honest(MANIFEST, &manifest)];
    raw.extend(files.iter().map(|(name, bytes)| honest(name, bytes)));
    raw.push(honest(MANIFEST_HASH, &hash_line(&manifest)));
    build(&raw)
}

/// An archive whose manifest is `manifest`, hashed honestly, around `raw`.
fn around(manifest: &Manifest, raw: Vec<RawEntry>) -> Vec<u8> {
    let text = manifest_text(manifest);
    let mut all = vec![honest(MANIFEST, &text)];
    all.extend(raw);
    all.push(honest(MANIFEST_HASH, &hash_line(&text)));
    build(&all)
}

/// Deflated zeros, streamed so the whole is never held: the data and the CRC.
fn deflated_zeros(inflated: usize) -> (Vec<u8>, u32) {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    let mut crc = Crc::new();
    let block = vec![0u8; 1024 * 1024];
    let mut left = inflated;
    while left > 0 {
        let n = left.min(block.len());
        encoder.write_all(&block[..n]).unwrap();
        crc.update(&block[..n]);
        left -= n;
    }
    (encoder.finish().unwrap(), crc.sum())
}

/// A database file whose bytes are `sql` applied to an empty file.
fn database(sql: &str) -> Vec<u8> {
    let scratch = Scratch::create();
    let path = scratch.path().join("other.sqlite3");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(sql).unwrap();
    conn.close().unwrap();
    std::fs::read(path).unwrap()
}

/// The snapshot `snapshot` with `sql` run on a copy of it.
fn changed(snapshot: &[u8], sql: &str) -> Vec<u8> {
    let scratch = Scratch::create();
    let path = scratch.path().join("copy.sqlite3");
    std::fs::write(&path, snapshot).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(sql).unwrap();
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    conn.close().unwrap();
    std::fs::read(path).unwrap()
}

/// Every case, from `good` — the entries of a real backup — and `other`, the
/// database of another work.
fn cases(good: &Entries, other_work_db: &[u8]) -> Vec<Case> {
    let base: Manifest = serde_json::from_slice(&good[0].1).unwrap();
    let files: Entries = good[1..good.len() - 1].to_vec();
    let snapshot = files[0].1.clone();
    let document = files
        .iter()
        .find(|(name, _)| name.starts_with("documents/") && name.ends_with(".png"))
        .cloned()
        .unwrap();
    let whole = build(
        &good
            .iter()
            .map(|(name, bytes)| honest(name, bytes))
            .collect::<Vec<_>>(),
    );
    let with = |extra: (&str, &[u8])| -> Vec<u8> {
        let mut more = files.clone();
        more.push((extra.0.to_string(), extra.1.to_vec()));
        repack(&base, &more)
    };
    let hash = "ab".repeat(32);

    let mut cases = vec![
        Case {
            name: "escape.ridgebeam",
            bytes: with(("../escape.txt", b"out")),
            words: "“../escape.txt”, which points outside the folder",
            inspect_refuses: true,
        },
        Case {
            name: "escape-within.ridgebeam",
            bytes: with((&format!("documents/../../{hash}.jpg"), b"out")),
            words: "which points outside the folder",
            inspect_refuses: true,
        },
        Case {
            name: "absolute.ridgebeam",
            bytes: with(("/Windows/win.ini", b"x")),
            words: "“/Windows/win.ini” with a full path",
            inspect_refuses: true,
        },
        Case {
            name: "drive.ridgebeam",
            bytes: with(("C:/Windows/win.ini", b"x")),
            words: "“C:/Windows/win.ini” on a drive",
            inspect_refuses: true,
        },
        Case {
            name: "unlisted-name.ridgebeam",
            bytes: with(("notes.txt", b"a note")),
            words: "“notes.txt”, which a Ridgebeam backup never holds",
            inspect_refuses: true,
        },
        Case {
            name: "script.ridgebeam",
            bytes: with((&format!("documents/{hash}.svg"), b"<svg/>")),
            words: "which a Ridgebeam backup never holds",
            inspect_refuses: true,
        },
        Case {
            name: "duplicate.ridgebeam",
            bytes: {
                let mut raw = vec![];
                raw.extend(files.iter().map(|(n, b)| honest(n, b)));
                raw.push(honest(&document.0, &document.1));
                around(&manifest_for(&base, &files), raw)
            },
            words: "twice",
            inspect_refuses: true,
        },
        Case {
            name: "size-lies.ridgebeam",
            // Both headers and the manifest say the document's own size; its
            // data inflates to 32 MiB of zeros.
            bytes: {
                let (data, crc) = deflated_zeros(32 * 1024 * 1024);
                let raw = files
                    .iter()
                    .map(|(name, bytes)| {
                        if *name == document.0 {
                            RawEntry {
                                name: name.clone(),
                                method: Method::Deflate,
                                data: data.clone(),
                                crc,
                                size: bytes.len() as u32,
                            }
                        } else {
                            honest(name, bytes)
                        }
                    })
                    .collect();
                around(&manifest_for(&base, &files), raw)
            },
            words: "is not the size it says",
            inspect_refuses: false,
        },
        Case {
            name: "bomb.ridgebeam",
            // 32 MiB of zeros in a few kilobytes, declared as what it is — past
            // the 25 MiB a document may be: refused from the declaration,
            // before a byte is inflated.
            bytes: {
                let (data, crc) = deflated_zeros(32 * 1024 * 1024);
                let mut listed = files.clone();
                listed.push((format!("documents/{hash}.pdf"), Vec::new()));
                let mut manifest = manifest_for(&base, &listed);
                let last = manifest.files.last_mut().unwrap();
                last.bytes = 32 * 1024 * 1024;
                let mut raw: Vec<RawEntry> = files.iter().map(|(n, b)| honest(n, b)).collect();
                raw.push(RawEntry {
                    name: format!("documents/{hash}.pdf"),
                    method: Method::Deflate,
                    data,
                    crc,
                    size: 32 * 1024 * 1024,
                });
                around(&manifest, raw)
            },
            words: "is larger than a backup may hold",
            inspect_refuses: true,
        },
        Case {
            name: "wrong-sha.ridgebeam",
            // One byte of a document flipped; the manifest as it was.
            bytes: {
                let raw = files
                    .iter()
                    .map(|(name, bytes)| {
                        let mut bytes = bytes.clone();
                        if *name == document.0 {
                            let middle = bytes.len() / 2;
                            bytes[middle] ^= 0x01;
                        }
                        honest(name, &bytes)
                    })
                    .collect();
                around(&manifest_for(&base, &files), raw)
            },
            words: "does not match its manifest",
            inspect_refuses: false,
        },
        Case {
            name: "tampered-manifest.ridgebeam",
            // The manifest edited — another name — and its hash left as it
            // was.
            bytes: {
                let mut edited = base.clone();
                edited.work_name = "Somebody else's bathroom".into();
                let text = manifest_text(&edited);
                let mut raw = vec![honest(MANIFEST, &text)];
                raw.extend(files.iter().map(|(n, b)| honest(n, b)));
                raw.push(honest(MANIFEST_HASH, &good.last().unwrap().1));
                build(&raw)
            },
            words: "its manifest does not match the hash written beside it",
            inspect_refuses: true,
        },
        Case {
            name: "no-manifest.ridgebeam",
            bytes: build(&files.iter().map(|(n, b)| honest(n, b)).collect::<Vec<_>>()),
            words: "it has no manifest",
            inspect_refuses: true,
        },
        Case {
            name: "no-manifest-hash.ridgebeam",
            bytes: build(
                &good[..good.len() - 1]
                    .iter()
                    .map(|(n, b)| honest(n, b))
                    .collect::<Vec<_>>(),
            ),
            words: "its manifest has no hash beside it",
            inspect_refuses: true,
        },
        Case {
            name: "other-product.ridgebeam",
            bytes: {
                let mut swapped = files.clone();
                swapped[0].1 = database(
                    "CREATE TABLE invoice (id INTEGER PRIMARY KEY, total REAL);
                     INSERT INTO invoice (total) VALUES (10.5);",
                );
                repack(&base, &swapped)
            },
            words: "its database is not a Ridgebeam work",
            inspect_refuses: false,
        },
        Case {
            name: "not-sqlite.ridgebeam",
            bytes: {
                let mut swapped = files.clone();
                swapped[0].1 = b"This is text with a database's name.".to_vec();
                repack(&base, &swapped)
            },
            words: "its database is not a Ridgebeam work",
            inspect_refuses: false,
        },
        Case {
            name: "other-work.ridgebeam",
            bytes: {
                let mut swapped = files.clone();
                swapped[0].1 = other_work_db.to_vec();
                repack(&base, &swapped)
            },
            words: "its database holds another work than the one its manifest names",
            inspect_refuses: false,
        },
        Case {
            name: "newer-schema.ridgebeam",
            bytes: {
                let mut swapped = files.clone();
                swapped[0].1 = changed(&snapshot, "UPDATE work SET schema_version = 99");
                let mut manifest = manifest_for(&base, &swapped);
                manifest.schema_version = 99;
                let raw = swapped.iter().map(|(n, b)| honest(n, b)).collect();
                around(&manifest, raw)
            },
            words: "it was written by a newer version of Ridgebeam",
            inspect_refuses: true,
        },
        Case {
            name: "newer-schema-database.ridgebeam",
            // The manifest says this build's schema; the database says later.
            bytes: {
                let mut swapped = files.clone();
                swapped[0].1 = changed(&snapshot, "UPDATE work SET schema_version = 99");
                repack(&base, &swapped)
            },
            words: "it was written by a newer version of Ridgebeam",
            inspect_refuses: false,
        },
        Case {
            name: "undescribed.ridgebeam",
            // The manifest says an older schema than the database holds.
            bytes: {
                let mut manifest = manifest_for(&base, &files);
                manifest.schema_version = 7;
                let raw = files.iter().map(|(n, b)| honest(n, b)).collect();
                around(&manifest, raw)
            },
            words: "its database is not the one its manifest describes",
            inspect_refuses: false,
        },
        Case {
            name: "damaged-database.ridgebeam",
            // A page in the middle overwritten; the header intact.
            bytes: {
                let mut swapped = files.clone();
                let db = &mut swapped[0].1;
                let page = 4096;
                let at = (db.len() / page / 2).max(1) * page;
                for byte in &mut db[at..at + page] {
                    *byte = 0xA5;
                }
                repack(&base, &swapped)
            },
            words: "its database",
            inspect_refuses: false,
        },
        Case {
            name: "truncated.ridgebeam",
            bytes: whole[..whole.len() / 2].to_vec(),
            words: "it is incomplete",
            inspect_refuses: true,
        },
        Case {
            name: "appended.ridgebeam",
            bytes: {
                let mut longer = whole.clone();
                longer.extend_from_slice(b"and some bytes after the end");
                longer
            },
            words: "it is incomplete",
            inspect_refuses: true,
        },
        Case {
            name: "not-a-zip.ridgebeam",
            bytes: png(16, 16),
            words: "it is not a Ridgebeam backup",
            inspect_refuses: true,
        },
        Case {
            name: "empty.ridgebeam",
            bytes: Vec::new(),
            words: "it is not a Ridgebeam backup",
            inspect_refuses: true,
        },
        Case {
            name: "newer-format.ridgebeam",
            bytes: {
                let mut value: serde_json::Value =
                    serde_json::to_value(manifest_for(&base, &files)).unwrap();
                value["ridgebeamBackup"] = 2.into();
                value["somethingNew"] = true.into();
                let mut text = serde_json::to_string_pretty(&value).unwrap().into_bytes();
                text.push(b'\n');
                let mut raw = vec![honest(MANIFEST, &text)];
                raw.extend(files.iter().map(|(n, b)| honest(n, b)));
                raw.push(honest(MANIFEST_HASH, &hash_line(&text)));
                build(&raw)
            },
            words: "it was written by a newer version of Ridgebeam",
            inspect_refuses: true,
        },
        Case {
            name: "unknown-field.ridgebeam",
            bytes: {
                let mut value: serde_json::Value =
                    serde_json::to_value(manifest_for(&base, &files)).unwrap();
                value["password"] = "hunter2".into();
                let mut text = serde_json::to_string_pretty(&value).unwrap().into_bytes();
                text.push(b'\n');
                let mut raw = vec![honest(MANIFEST, &text)];
                raw.extend(files.iter().map(|(n, b)| honest(n, b)));
                raw.push(honest(MANIFEST_HASH, &hash_line(&text)));
                build(&raw)
            },
            words: "its manifest cannot be read",
            inspect_refuses: true,
        },
        Case {
            name: "listed-not-held.ridgebeam",
            bytes: {
                let mut listed = files.clone();
                listed.push((format!("thumbnails/{hash}.jpg"), b"small".to_vec()));
                let raw = files.iter().map(|(n, b)| honest(n, b)).collect();
                around(&manifest_for(&base, &listed), raw)
            },
            words: "which it does not hold",
            inspect_refuses: true,
        },
        Case {
            name: "held-not-listed.ridgebeam",
            bytes: {
                let mut raw: Vec<RawEntry> = files.iter().map(|(n, b)| honest(n, b)).collect();
                raw.push(honest(&format!("thumbnails/{hash}.jpg"), b"small"));
                around(&manifest_for(&base, &files), raw)
            },
            words: "which its manifest does not list",
            inspect_refuses: true,
        },
        Case {
            name: "size-disagrees.ridgebeam",
            // The manifest records one byte fewer than the entry declares.
            bytes: {
                let mut manifest = manifest_for(&base, &files);
                manifest.files.last_mut().unwrap().bytes -= 1;
                let raw = files.iter().map(|(n, b)| honest(n, b)).collect();
                around(&manifest, raw)
            },
            words: "is not the size its manifest records",
            inspect_refuses: true,
        },
        Case {
            name: "no-database.ridgebeam",
            bytes: repack(&base, &files[1..]),
            words: "it holds no work database",
            inspect_refuses: true,
        },
        Case {
            name: "crc.ridgebeam",
            // The document's bytes as recorded, its CRC not.
            bytes: {
                let raw = files
                    .iter()
                    .map(|(name, bytes)| {
                        let mut entry = honest(name, bytes);
                        if *name == document.0 {
                            entry.crc ^= 1;
                        }
                        entry
                    })
                    .collect();
                around(&manifest_for(&base, &files), raw)
            },
            words: "is damaged",
            inspect_refuses: false,
        },
    ];
    // A ZIP that is not the shape a backup is: an extra field on an entry.
    let mut shaped = whole.clone();
    let directory = u32::from_le_bytes(
        shaped[shaped.len() - 6..shaped.len() - 2]
            .try_into()
            .unwrap(),
    ) as usize;
    shaped[directory + 30] = 4;
    cases.push(Case {
        name: "extra-field.ridgebeam",
        bytes: shaped,
        words: "it is not shaped as a Ridgebeam backup",
        inspect_refuses: true,
    });
    cases
}

fn names_in(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// The gate: every case refused, with its sentence, and nothing written.
/// Every case is checked before the test fails, so one run names every case
/// that does not hold.
#[test]
fn every_hostile_backup_is_refused_with_a_sentence_naming_it_and_nothing_written() {
    let (db, open, scratch) = host_with_a_work();
    let source = Scratch::create();
    let photo = source.path().join("plan.png");
    std::fs::write(&photo, png(48, 32)).unwrap();
    let pdf = source.path().join("permit.pdf");
    std::fs::write(&pdf, minimal_pdf()).unwrap();
    document_add_with(
        &open,
        &[
            photo.to_string_lossy().into_owned(),
            pdf.to_string_lossy().into_owned(),
        ],
        "drawing",
        None,
        chrono::NaiveDate::from_ymd_opt(2026, 10, 9).unwrap(),
        "Synthetic author",
    )
    .unwrap();
    let backups = Scratch::create();
    let good_path = backups.path().join("good.ridgebeam");
    backup_write_with(
        &db,
        &open,
        &good_path.to_string_lossy(),
        false,
        chrono::Local::now(),
    )
    .unwrap();
    let good = entries_of(&std::fs::read(&good_path).unwrap());

    // Another work's database, for "another work id".
    let elsewhere = Scratch::create();
    let other_open = crate::folder::OpenWork::default();
    work_create_with(
        &db,
        &other_open,
        &elsewhere.path().join("Other").to_string_lossy(),
        &draft("Another synthetic work"),
    )
    .unwrap();
    let other_path = backups.path().join("other.ridgebeam");
    backup_write_with(
        &db,
        &other_open,
        &other_path.to_string_lossy(),
        false,
        chrono::Local::now(),
    )
    .unwrap();
    work_close_with(&other_open);
    let other_db = entries_of(&std::fs::read(&other_path).unwrap())[1]
        .1
        .clone();

    let open_before = work_current_with(&open).unwrap().unwrap();
    let targets = Scratch::create();
    // An empty folder made for the restore stays, empty.
    let empty = targets.path().join("Made for it");
    std::fs::create_dir(&empty).unwrap();

    let mut failures = Vec::new();
    let all = cases(&good, &other_db);
    assert!(all.len() >= 30, "{} cases", all.len());
    for (index, case) in all.into_iter().enumerate() {
        let path = backups.path().join(case.name);
        std::fs::write(&path, &case.bytes).unwrap();
        let target = if index % 2 == 0 {
            targets.path().join(format!("Target {index}"))
        } else {
            empty.clone()
        };
        let around = names_in(targets.path());
        let expected_start = format!("“{}” cannot be restored: ", case.name);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            backup_restore_with(
                &db,
                &open,
                &path.to_string_lossy(),
                &target.to_string_lossy(),
            )
        }));
        let failure = match result {
            Err(_) => Some(format!("{}: the restore panicked", case.name)),
            Ok(Ok(_)) => Some(format!("{}: restored, but must be refused", case.name)),
            Ok(Err(error)) => {
                let sentence = error.to_string();
                if error.kind() != "invalid_input" {
                    Some(format!(
                        "{}: refused as {} — {sentence}",
                        case.name,
                        error.kind()
                    ))
                } else if !sentence.starts_with(&expected_start) || !sentence.contains(case.words) {
                    Some(format!("{}: the sentence was “{sentence}”", case.name))
                } else if names_in(targets.path()) != around {
                    Some(format!(
                        "{}: something was left beside the target: {:?}",
                        case.name,
                        names_in(targets.path())
                    ))
                } else if empty.exists() && !names_in(&empty).is_empty() {
                    Some(format!("{}: the empty folder is not empty", case.name))
                } else if !empty.is_dir() {
                    Some(format!("{}: the empty folder is gone", case.name))
                } else {
                    None
                }
            }
        };
        failures.extend(failure);

        let inspected = backup_inspect_with(&db, &path.to_string_lossy());
        match (case.inspect_refuses, inspected) {
            (true, Ok(_)) => failures.push(format!("{}: inspect did not refuse it", case.name)),
            (true, Err(error)) => {
                if !error.to_string().contains(case.words) {
                    failures.push(format!("{}: inspect said “{error}”", case.name));
                }
            }
            (false, Err(error)) => failures.push(format!(
                "{}: inspect refused what only a restore can see: {error}",
                case.name
            )),
            (false, Ok(_)) => {}
        }
    }
    assert!(
        failures.is_empty(),
        "{} case(s) did not hold:\n{}",
        failures.len(),
        failures.join("\n")
    );

    assert_eq!(
        work_current_with(&open).unwrap().unwrap(),
        open_before,
        "the work that was open is still open"
    );
    // And the honest backup, after all that, restores.
    backup_restore_with(
        &db,
        &open,
        &good_path.to_string_lossy(),
        &empty.to_string_lossy(),
    )
    .expect("the honest one restores");
    work_close_with(&open);
    drop(scratch);
}
