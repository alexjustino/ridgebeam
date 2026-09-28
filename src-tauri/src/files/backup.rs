//! A backup: a whole work in one file, and that file read back as hostile.
//!
//! `<name>.ridgebeam` is a ZIP (`files::archive`), so a person can look inside
//! it with Windows (ADR-033). In this order, and nothing else:
//!
//! 1. `manifest.json` — what the backup holds (below), stored;
//! 2. `work.sqlite3` — a consistent snapshot of the work's database, taken by
//!    `VACUUM INTO` on the open connection, deflated;
//! 3. every file of `documents/` and then `thumbnails/`, by name, each stored
//!    (a BMP deflated: it is the one kept format that is not compressed);
//! 4. `manifest.sha256` — `<64 hex>  manifest.json` and a line feed, the form
//!    `sha256sum -c` reads.
//!
//! The manifest, pretty-printed with a trailing line feed:
//!
//! ```json
//! {
//!   "ridgebeamBackup": 1,
//!   "createdAt": "2026-10-09T17:05:30.000Z",
//!   "app": "Ridgebeam 0.1.0",
//!   "workId": "0199…",
//!   "workName": "Bathroom",
//!   "schemaVersion": 10,
//!   "files": [ { "path": "work.sqlite3", "bytes": 245760, "sha256": "…" }, … ]
//! }
//! ```
//!
//! **Why `VACUUM INTO`, not the online backup API.** One statement, on the
//! connection the work is already open on, inside one read transaction: the
//! snapshot is every committed row, the write-ahead log folded in, and nothing
//! else. It is rebuilt page by page, so the free pages of the live file —
//! where the bytes of deleted rows may linger — do not travel in a file a
//! person hands to somebody else. The online backup API copies pages as they
//! are, free ones included, and needs a rusqlite feature this crate does not
//! otherwise use. The snapshot is then put in WAL mode, as every closed work
//! is, so that opening the restored work changes none of its bytes.
//!
//! **Restoring treats the file as hostile** (SECURITY.md): a ZIP of the
//! shape `files::archive` writes, 4 GiB at most; entry names only from the
//! allow-list below, none twice; `manifest.json` first and `manifest.sha256`
//! last, the manifest's own hash checked before a word of it is believed;
//! every entry listed by the manifest and every listed file present, its
//! declared size equal to the manifest's and under its cap (the database 2
//! GiB, a document or a thumbnail 25 MiB) — enforced while it inflates, never
//! trusting the header — and its SHA-256 equal to the manifest's; the database
//! opened read-only (`immutable`) and found to be a Ridgebeam work, of the
//! work the manifest names, at a schema this build knows. Everything is
//! written into a temporary folder beside the target, which is renamed into
//! place only when every check has passed; on any refusal the temporary folder
//! and everything in it are removed, so nothing is left.
//!
//! The allow-list, exactly:
//!
//! | name                                  | cap     |
//! | ------------------------------------- | ------- |
//! | `manifest.json`                       | 16 MiB  |
//! | `manifest.sha256`                     | 256 B   |
//! | `work.sqlite3`                        | 2 GiB   |
//! | `documents/<64 hex>.<jpg\|jpeg\|png\|gif\|webp\|bmp\|pdf>` | 25 MiB |
//! | `thumbnails/<64 hex>.jpg`             | 25 MiB  |
//!
//! Lowercase only: every name the intake writes is. No directory entries, no
//! `..`, no absolute path, no drive letter — each named in its own sentence.
//! A file in the work folder that is not on the list (an orphan with another
//! name, a leftover) is left out of the backup and named in the answer.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::db::migrations;
use crate::error::{Error, Result};
use crate::files::archive::{self, Method, ReadError, Reader, WriteError, Writer};
use crate::files::intake::{self, DOCUMENTS, MAX_PHOTO_BYTES, THUMBNAILS};
use crate::files::save::{self, Kind};
use crate::folder::WORK_FILE;

/// The backup format this build writes and reads.
pub const FORMAT: i64 = 1;

/// The manifest's name inside the archive.
pub const MANIFEST: &str = "manifest.json";

/// The manifest's hash's name inside the archive.
pub const MANIFEST_HASH: &str = "manifest.sha256";

/// The largest database a backup holds.
pub const MAX_DATABASE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// The largest document or thumbnail a backup holds — the intake's own cap.
pub const MAX_FILE_BYTES: u64 = MAX_PHOTO_BYTES;

/// The largest manifest read.
pub const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;

/// The largest manifest hash read.
pub const MAX_MANIFEST_HASH_BYTES: u64 = 256;

/// A document's extensions, as the allow-list takes them.
const DOCUMENT_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "pdf"];

/// What a backup file may be, for `files::save`.
pub const KIND: Kind = Kind {
    extension: "ridgebeam",
    not_this_kind: "a backup is a .ridgebeam file",
    max_bytes: archive::MAX_ARCHIVE_BYTES,
    too_large: "it would be larger than 4 GiB",
    full_path: "A backup is saved to a full path, such as C:\\Backups\\Bathroom.ridgebeam.",
    logged_as: "a backup",
};

/// The reasons a backup cannot be restored, each finishing the sentence
/// "“<file>” cannot be restored: …".
pub mod reason {
    /// Not a ZIP at all.
    pub const NOT_A_BACKUP: &str = "it is not a Ridgebeam backup";
    /// No end record where one must be.
    pub const INCOMPLETE: &str =
        "it is incomplete — it may have been cut short while it was copied";
    /// Over the archive's cap.
    pub const TOO_LARGE: &str = "it is larger than 4 GiB";
    /// A ZIP, but not the shape a backup is.
    pub const SHAPE: &str =
        "it is not shaped as a Ridgebeam backup — another program may have changed it";
    /// No `manifest.json`.
    pub const NO_MANIFEST: &str = "it has no manifest, so it is not a Ridgebeam backup";
    /// No `manifest.sha256`.
    pub const NO_MANIFEST_HASH: &str =
        "its manifest has no hash beside it, so the backup cannot be checked";
    /// The manifest's hash does not match.
    pub const MANIFEST_CHANGED: &str =
        "its manifest does not match the hash written beside it — the backup was changed after it was written";
    /// The manifest is not the format's JSON.
    pub const MANIFEST_UNREADABLE: &str = "its manifest cannot be read";
    /// A later backup format, or a work at a later schema.
    pub const NEWER: &str =
        "it was written by a newer version of Ridgebeam — update Ridgebeam to restore it";
    /// The manifest lists no database.
    pub const NO_DATABASE: &str = "it holds no work database";
    /// The database is not a work.
    pub const NOT_A_WORK: &str = "its database is not a Ridgebeam work";
    /// The database is damaged.
    pub const DATABASE_DAMAGED: &str = "its database is damaged";
    /// The database holds another work.
    pub const OTHER_WORK: &str = "its database holds another work than the one its manifest names";
    /// The database is not the one the manifest describes.
    pub const NOT_DESCRIBED: &str = "its database is not the one its manifest describes";
}

/// What a backup holds, as `manifest.json` says it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    /// The backup format: 1.
    pub ridgebeam_backup: i64,
    /// When it was written, UTC.
    pub created_at: String,
    /// The build that wrote it: "Ridgebeam 0.1.0".
    pub app: String,
    /// The work's UUID.
    pub work_id: String,
    /// The work's name when it was written.
    pub work_name: String,
    /// The work's schema version when it was written.
    pub schema_version: i64,
    /// Every file, database first, in the archive's order.
    pub files: Vec<ManifestFile>,
}

/// One file a backup holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestFile {
    /// Its name inside the archive and inside the work folder.
    pub path: String,
    /// Its size.
    pub bytes: u64,
    /// Its SHA-256.
    pub sha256: String,
}

impl Manifest {
    /// Every byte the files hold.
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|file| file.bytes).sum()
    }
}

/// Where a name on the allow-list belongs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// `manifest.json`.
    Manifest,
    /// `manifest.sha256`.
    ManifestHash,
    /// `work.sqlite3`.
    Database,
    /// `documents/<hash>.<ext>`.
    Document,
    /// `thumbnails/<hash>.jpg`.
    Thumbnail,
}

impl Slot {
    /// The most bytes an entry in this slot may inflate to.
    pub fn cap(self) -> u64 {
        match self {
            Slot::Manifest => MAX_MANIFEST_BYTES,
            Slot::ManifestHash => MAX_MANIFEST_HASH_BYTES,
            Slot::Database => MAX_DATABASE_BYTES,
            Slot::Document | Slot::Thumbnail => MAX_FILE_BYTES,
        }
    }
}

/// A hostile name, made safe to put in a sentence: control characters
/// replaced, at most 80 characters.
fn shown(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| if c.is_control() { '_' } else { c })
        .take(80)
        .collect();
    if name.chars().count() > 80 {
        out.push('…');
    }
    out
}

/// Which slot a name takes, or the reason it is refused.
///
/// # Errors
///
/// The reason, as the end of a sentence: a name that climbs out of the folder,
/// a full path, a drive letter, or a name a backup never holds.
pub fn classify(name: &str) -> std::result::Result<Slot, String> {
    let parts: Vec<&str> = name.split(['/', '\\']).collect();
    if parts.contains(&"..") {
        return Err(format!(
            "it holds a file named “{}”, which points outside the folder it would be restored into",
            shown(name)
        ));
    }
    if name.starts_with('/') || name.starts_with('\\') {
        return Err(format!(
            "it holds a file named “{}” with a full path, which a Ridgebeam backup never holds",
            shown(name)
        ));
    }
    let bytes = name.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        return Err(format!(
            "it holds a file named “{}” on a drive, which a Ridgebeam backup never holds",
            shown(name)
        ));
    }
    let slot = match name {
        MANIFEST => Some(Slot::Manifest),
        MANIFEST_HASH => Some(Slot::ManifestHash),
        WORK_FILE => Some(Slot::Database),
        _ => match parts.as_slice() {
            [folder, file] if *folder == DOCUMENTS => file
                .split_once('.')
                .filter(|(stem, ext)| intake::is_hash(stem) && DOCUMENT_EXTENSIONS.contains(ext))
                .map(|_| Slot::Document),
            [folder, file] if *folder == THUMBNAILS => file
                .strip_suffix(".jpg")
                .filter(|stem| intake::is_hash(stem))
                .map(|_| Slot::Thumbnail),
            _ => None,
        },
    };
    slot.ok_or_else(|| {
        format!(
            "it holds a file named “{}”, which a Ridgebeam backup never holds",
            shown(name)
        )
    })
}

/// The sentence for a backup that cannot be restored.
fn refusal(path: &Path) -> impl Fn(&str) -> Error {
    let name = save::display_name(path);
    move |reason: &str| Error::InvalidInput(format!("“{name}” cannot be restored: {reason}."))
}

/// What reading the archive refused, as the end of a sentence.
fn read_reason(error: ReadError) -> std::result::Result<String, Error> {
    Ok(match error {
        ReadError::NotZip => reason::NOT_A_BACKUP.into(),
        ReadError::Incomplete => reason::INCOMPLETE.into(),
        ReadError::TooLarge => reason::TOO_LARGE.into(),
        ReadError::Shape(detail) => {
            log::warn!("a backup was refused for its shape: {detail}");
            reason::SHAPE.into()
        }
        ReadError::SizeLies(name) => format!(
            "“{}” is not the size it says — the backup was changed after it was written",
            shown(&name)
        ),
        ReadError::OverCap(name) => {
            format!("“{}” is larger than a backup may hold", shown(&name))
        }
        ReadError::Damaged(name) => format!("“{}” is damaged", shown(&name)),
        ReadError::Io(error) => return Err(Error::Io(error)),
    })
}

/// A backup, as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backup {
    /// The archive's size.
    pub bytes: u64,
    /// The manifest it holds.
    pub manifest: Manifest,
    /// Files in `documents/` or `thumbnails/` left out, because a backup
    /// never holds their names — as `documents/<name>`.
    pub left_out: Vec<String>,
}

/// Files a caller creates and removes again unless told to keep them.
struct Temporary(Vec<PathBuf>);

impl Drop for Temporary {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// The path with `-wal`, `-shm` and `-journal` beside it — every file SQLite
/// may leave next to a database.
fn with_sidecars(path: &Path) -> Vec<PathBuf> {
    let mut all = vec![path.to_path_buf()];
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        all.push(PathBuf::from(name));
    }
    all
}

/// The SHA-256 and size of a file, read in chunks.
fn hash_file(path: &Path) -> Result<(u64, String)> {
    use sha2::{Digest, Sha256};
    let mut file = BufReader::new(File::open(path)?);
    let mut sha = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        sha.update(&buffer[..n]);
        total += n as u64;
    }
    Ok((total, hex::encode(sha.finalize())))
}

/// Whether `dest` would land inside `folder`.
fn inside(dest: &Path, folder: &Path) -> bool {
    let (Some(parent), Ok(folder)) = (dest.parent(), folder.canonicalize()) else {
        return false;
    };
    parent
        .canonicalize()
        .is_ok_and(|parent| parent.starts_with(folder))
}

/// The work's files a backup holds, by their names in the archive, and the
/// ones it leaves out.
/// The files a backup holds, each by its name in the archive and its path on
/// disk.
type Kept = Vec<(String, PathBuf)>;

fn work_files(folder: &Path) -> Result<(Kept, Vec<String>)> {
    let mut kept = Vec::new();
    let mut left_out = Vec::new();
    for sub in [DOCUMENTS, THUMBNAILS] {
        let entries = match std::fs::read_dir(folder.join(sub)) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let mut found: Vec<_> = entries.collect::<std::io::Result<Vec<_>>>()?;
        found.sort_by_key(std::fs::DirEntry::file_name);
        for entry in found {
            let name = entry.file_name().to_string_lossy().into_owned();
            let archived = format!("{sub}/{name}");
            let file_type = entry.file_type()?;
            let fits = file_type.is_file()
                && entry.file_name().to_str().is_some()
                && matches!(classify(&archived), Ok(Slot::Document | Slot::Thumbnail))
                && entry.metadata()?.len() <= MAX_FILE_BYTES;
            if fits {
                kept.push((archived, entry.path()));
            } else if file_type.is_dir() {
                left_out.push(format!("{archived}/"));
            } else {
                left_out.push(archived);
            }
        }
    }
    Ok((kept, left_out))
}

/// Write a backup of the work open on `conn`, whose folder is `folder`, to
/// `dest` — whole or not at all, through `files::save`.
///
/// The work row is read by its first schema's columns, so a work at any
/// schema can be backed up as it is (a test backs up one at schema 7).
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path `files::save` refuses, a path inside
/// the work's own folder, a database over 2 GiB, an archive over 4 GiB, or a
/// file that changed while it was read; [`Error::Database`] when the snapshot
/// cannot be taken; [`Error::Io`] when the disk refuses — and then nothing is
/// left behind: no archive, no temporary file.
pub fn write(
    conn: &Connection,
    folder: &Path,
    dest: &Path,
    overwrite: bool,
    now: DateTime<Local>,
) -> Result<Backup> {
    save::check_target(dest, overwrite, &KIND)?;
    let file_name = save::display_name(dest);
    let refuse =
        |reason: &str| Error::InvalidInput(format!("“{file_name}” was not saved: {reason}."));
    if inside(dest, folder) {
        return Err(refuse(
            "a backup inside the work's own folder would be lost with it",
        ));
    }
    let (work_id, work_name, schema_version) = conn.query_row(
        "SELECT work_id, name, schema_version FROM work WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;

    // The snapshot, beside the backup — never inside the work folder.
    let snapshot = save::temporary_beside(dest, "sqlite3.tmp")
        .ok_or_else(|| refuse("the folder it would go in is not there"))?;
    let _cleanup = Temporary(with_sidecars(&snapshot));
    conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy()])?;
    {
        let copy = Connection::open_with_flags(
            &snapshot,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        copy.pragma_update(None, "journal_mode", "WAL")?;
        copy.close().map_err(|(_, error)| error)?;
    }

    let (files, left_out) = work_files(folder)?;
    let mut sources = vec![snapshot.clone()];
    let (db_bytes, db_hash) = hash_file(&snapshot)?;
    if db_bytes > MAX_DATABASE_BYTES {
        return Err(refuse("the work's database is larger than 2 GiB"));
    }
    let mut listed = vec![ManifestFile {
        path: WORK_FILE.into(),
        bytes: db_bytes,
        sha256: db_hash,
    }];
    for (archived, path) in files {
        let (bytes, sha256) = hash_file(&path)?;
        listed.push(ManifestFile {
            path: archived,
            bytes,
            sha256,
        });
        sources.push(path);
    }
    let manifest = Manifest {
        ridgebeam_backup: FORMAT,
        created_at: now
            .with_timezone(&Utc)
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
        app: format!("Ridgebeam {}", env!("CARGO_PKG_VERSION")),
        work_id,
        work_name,
        schema_version,
        files: listed,
    };
    let mut manifest_text = serde_json::to_string_pretty(&manifest).expect("a manifest is JSON");
    manifest_text.push('\n');
    let manifest_hash = format!(
        "{}  {MANIFEST}\n",
        intake::sha256_hex(manifest_text.as_bytes())
    );

    let too_large = |error: WriteError| match error {
        WriteError::TooLarge => refuse(KIND.too_large),
        WriteError::Io(error) => Error::Io(error),
    };
    save::write_streamed(dest, overwrite, &KIND, |file| {
        let mut writer = Writer::new(BufWriter::new(file), now.naive_local());
        writer
            .add(MANIFEST, Method::Store, manifest_text.as_bytes())
            .map_err(too_large)?;
        for (listed, source) in manifest.files.iter().zip(&sources) {
            let method = if listed.path == WORK_FILE || listed.path.ends_with(".bmp") {
                Method::Deflate
            } else {
                Method::Store
            };
            let entry = writer
                .add(&listed.path, method, BufReader::new(File::open(source)?))
                .map_err(too_large)?;
            if entry.bytes != listed.bytes || entry.sha256 != listed.sha256 {
                return Err(refuse(
                    "a file in the work changed while the backup was written; try again",
                ));
            }
        }
        writer
            .add(MANIFEST_HASH, Method::Store, manifest_hash.as_bytes())
            .map_err(too_large)?;
        let (buffered, total) = writer.finish().map_err(too_large)?;
        buffered
            .into_inner()
            .map_err(|error| Error::Io(error.into_error()))?;
        Ok(total)
    })?;

    Ok(Backup {
        bytes: std::fs::metadata(dest)?.len(),
        manifest,
        left_out,
    })
}

/// A backup opened and checked from its end record to its manifest — every
/// name, the manifest's own hash, every size against the manifest — with no
/// file inflated yet.
pub struct Checked {
    reader: Reader<BufReader<File>>,
    /// What it holds.
    pub manifest: Manifest,
    /// The archive's size.
    pub archive_bytes: u64,
    /// Each file of the manifest, with its entry's index and slot.
    slots: Vec<(usize, Slot)>,
}

/// Read an entry that is small and needed whole: the manifest or its hash.
fn read_small(
    reader: &mut Reader<BufReader<File>>,
    index: usize,
    cap: u64,
) -> std::result::Result<Vec<u8>, ReadError> {
    let mut bytes = Vec::new();
    reader.read(index, cap, &mut bytes)?;
    Ok(bytes)
}

/// Open a backup and check everything that can be checked without inflating
/// its files: what `backup_inspect` shows, and where a restore begins.
///
/// # Errors
///
/// [`Error::InvalidInput`] with a sentence naming the file and the first
/// thing that does not hold; [`Error::Io`] when it cannot be read.
pub fn check(path: &Path) -> Result<Checked> {
    if !path.is_absolute() {
        return Err(Error::InvalidInput(
            "A backup is chosen by its full path.".into(),
        ));
    }
    let refuse = refusal(path);
    let refuse_read = |error: ReadError| match read_reason(error) {
        Ok(reason) => refuse(&reason),
        Err(error) => error,
    };
    let metadata = std::fs::metadata(path).map_err(|_| refuse("it could not be found"))?;
    if !metadata.is_file() {
        return Err(refuse("it is not a file"));
    }
    let len = metadata.len();
    let file = File::open(path).map_err(|_| refuse("it could not be read"))?;
    let mut reader = Reader::open(BufReader::new(file), len).map_err(refuse_read)?;

    if reader.entries.is_empty() {
        return Err(refuse(reason::NO_MANIFEST));
    }
    // Every name on the allow-list, none twice.
    let mut seen = HashSet::new();
    let mut slots = Vec::with_capacity(reader.entries.len());
    for entry in &reader.entries {
        let slot = classify(&entry.name).map_err(|reason| refuse(&reason))?;
        if !seen.insert(entry.name.clone()) {
            return Err(refuse(&format!("it holds “{}” twice", shown(&entry.name))));
        }
        slots.push(slot);
    }
    let last = reader.entries.len() - 1;
    if !slots.contains(&Slot::Manifest) {
        return Err(refuse(reason::NO_MANIFEST));
    }
    if !slots.contains(&Slot::ManifestHash) {
        return Err(refuse(reason::NO_MANIFEST_HASH));
    }
    if slots[0] != Slot::Manifest || slots[last] != Slot::ManifestHash {
        return Err(refuse(reason::SHAPE));
    }

    // The manifest's own hash, before a word of it is believed.
    let hash_text = read_small(&mut reader, last, MAX_MANIFEST_HASH_BYTES).map_err(refuse_read)?;
    let text = read_small(&mut reader, 0, MAX_MANIFEST_BYTES).map_err(refuse_read)?;
    let expected = format!("{}  {MANIFEST}\n", intake::sha256_hex(&text));
    if hash_text != expected.as_bytes() {
        return Err(refuse(reason::MANIFEST_CHANGED));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&text).map_err(|_| refuse(reason::MANIFEST_UNREADABLE))?;
    match value
        .get("ridgebeamBackup")
        .and_then(serde_json::Value::as_i64)
    {
        Some(FORMAT) => {}
        Some(later) if later > FORMAT => return Err(refuse(reason::NEWER)),
        _ => return Err(refuse(reason::NOT_A_BACKUP)),
    }
    let manifest: Manifest =
        serde_json::from_value(value).map_err(|_| refuse(reason::MANIFEST_UNREADABLE))?;
    let name_len = manifest.work_name.chars().count();
    if manifest.work_id.len() != 36 || !(1..=120).contains(&name_len) || manifest.schema_version < 1
    {
        return Err(refuse(reason::MANIFEST_UNREADABLE));
    }
    if manifest.schema_version > migrations::WORK.target_version() {
        return Err(refuse(reason::NEWER));
    }

    // The manifest's files: on the list, none twice, the database once.
    let mut listed = HashSet::new();
    let mut file_slots = Vec::with_capacity(manifest.files.len());
    for file in &manifest.files {
        let slot = match classify(&file.path) {
            Ok(slot @ (Slot::Database | Slot::Document | Slot::Thumbnail)) => slot,
            _ => {
                return Err(refuse(&format!(
                    "its manifest lists “{}”, which a Ridgebeam backup never holds",
                    shown(&file.path)
                )))
            }
        };
        if !listed.insert(file.path.as_str()) {
            return Err(refuse(&format!(
                "its manifest lists “{}” twice",
                shown(&file.path)
            )));
        }
        if !intake::is_hash(&file.sha256) {
            return Err(refuse(reason::MANIFEST_UNREADABLE));
        }
        file_slots.push(slot);
    }
    if file_slots.iter().filter(|s| **s == Slot::Database).count() != 1 {
        return Err(refuse(reason::NO_DATABASE));
    }

    // The archive holds exactly what the manifest lists, in its order, each
    // declared at the manifest's size and under its cap.
    let held: Vec<&archive::Entry> = reader.entries[1..last].iter().collect();
    for entry in &held {
        if !listed.contains(entry.name.as_str()) {
            return Err(refuse(&format!(
                "it holds “{}”, which its manifest does not list",
                shown(&entry.name)
            )));
        }
    }
    let held_names: HashSet<&str> = held.iter().map(|e| e.name.as_str()).collect();
    for file in &manifest.files {
        if !held_names.contains(file.path.as_str()) {
            return Err(refuse(&format!(
                "its manifest lists “{}”, which it does not hold",
                shown(&file.path)
            )));
        }
    }
    let mut slots = Vec::with_capacity(manifest.files.len());
    for (offset, ((file, slot), entry)) in manifest
        .files
        .iter()
        .zip(&file_slots)
        .zip(&held)
        .enumerate()
    {
        if file.path != entry.name {
            return Err(refuse(reason::SHAPE));
        }
        if file.bytes > slot.cap() || entry.size > slot.cap() {
            return Err(refuse(&format!(
                "“{}” is larger than a backup may hold",
                shown(&file.path)
            )));
        }
        if entry.size != file.bytes {
            return Err(refuse(&format!(
                "“{}” is not the size its manifest records",
                shown(&file.path)
            )));
        }
        slots.push((offset + 1, *slot));
    }

    Ok(Checked {
        reader,
        manifest,
        archive_bytes: len,
        slots,
    })
}

/// A restore in progress: a temporary folder beside the target, and what was
/// written into it. Dropped without [`Staged::move_into`] succeeding, it
/// removes every file it wrote, every folder it made, and itself.
pub struct Staged {
    folder: PathBuf,
    files: Vec<PathBuf>,
    folders: Vec<PathBuf>,
    kept: bool,
    /// What the backup holds.
    pub manifest: Manifest,
}

impl Staged {
    /// The temporary folder, a work folder once staging has succeeded.
    pub fn folder(&self) -> &Path {
        &self.folder
    }

    /// Rename the temporary folder to `target` — which does not exist, or is
    /// an empty folder that is removed first and made again if the rename
    /// fails.
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when the rename is refused; then the temporary folder is
    /// removed and an empty `target` is back as it was.
    pub fn move_into(mut self, target: &Path) -> Result<()> {
        let was_there = target.is_dir();
        if was_there {
            std::fs::remove_dir(target)?;
        }
        match std::fs::rename(&self.folder, target) {
            Ok(()) => {
                self.kept = true;
                Ok(())
            }
            Err(error) => {
                if was_there {
                    let _ = std::fs::create_dir(target);
                }
                Err(error.into())
            }
        }
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        if self.kept {
            return;
        }
        for file in &self.files {
            for path in with_sidecars(file) {
                let _ = std::fs::remove_file(path);
            }
        }
        // `remove_dir`, never `remove_dir_all`: only folders this restore
        // made, and only once they are empty.
        for folder in self.folders.iter().rev() {
            let _ = std::fs::remove_dir(folder);
        }
        let _ = std::fs::remove_dir(&self.folder);
    }
}

/// A path SQLite reads as a URI naming the file, read-only and immutable —
/// no lock, no `-shm`, no `-wal`: exactly the bytes on disk.
fn immutable_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::with_capacity(text.len() + 16);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"/._-~:".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    let slash = if encoded.starts_with('/') { "" } else { "/" };
    format!("file://{slash}{encoded}?immutable=1")
}

/// Whether the database at `path` is the Ridgebeam work `manifest` names.
fn check_database(path: &Path, manifest: &Manifest) -> std::result::Result<(), &'static str> {
    let mut magic = [0u8; 16];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut magic))
        .map_err(|_| reason::NOT_A_WORK)?;
    if &magic != b"SQLite format 3\0" {
        return Err(reason::NOT_A_WORK);
    }
    let conn = Connection::open_with_flags(
        immutable_uri(path),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| reason::NOT_A_WORK)?;
    let found = (|| {
        let check: String = conn
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|_| reason::DATABASE_DAMAGED)?;
        if check != "ok" {
            return Err(reason::DATABASE_DAMAGED);
        }
        for table in ["work", "calendar", "holiday", "person", "stage", "activity"] {
            let present: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .map_err(|_| reason::NOT_A_WORK)?;
            if present != 1 {
                return Err(reason::NOT_A_WORK);
            }
        }
        let (work_id, schema_version) = conn
            .query_row(
                "SELECT work_id, schema_version FROM work WHERE id = 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|_| reason::NOT_A_WORK)?;
        if work_id != manifest.work_id {
            return Err(reason::OTHER_WORK);
        }
        if schema_version > migrations::WORK.target_version() {
            return Err(reason::NEWER);
        }
        if schema_version != manifest.schema_version {
            return Err(reason::NOT_DESCRIBED);
        }
        Ok(())
    })();
    let _ = conn.close();
    found
}

/// Check a backup whole and write it into a new temporary folder beside
/// `target`: every file inflated under its cap and checked against its
/// manifest, and the database found to be the work it names. The caller opens
/// the staged work, then moves it into place.
///
/// # Errors
///
/// As [`check`], and every refusal of an entry's bytes or of the database,
/// each with its sentence; [`Error::Io`] when the disk refuses. On any error,
/// nothing is left beside `target`.
pub fn stage(path: &Path, target: &Path) -> Result<Staged> {
    let Checked {
        mut reader,
        manifest,
        slots,
        ..
    } = check(path)?;
    let refuse = refusal(path);
    let parent = target
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| Error::InvalidInput(NO_PARENT.into()))?;
    let folder = parent.join(format!(
        ".{}.{}.restoring",
        save::display_name(target),
        crate::db::new_id()
    ));
    std::fs::create_dir(&folder)?;
    let mut staged = Staged {
        folder,
        files: Vec::new(),
        folders: Vec::new(),
        kept: false,
        manifest,
    };

    for (file, (index, slot)) in staged.manifest.files.clone().iter().zip(&slots) {
        let destination = match file.path.split_once('/') {
            Some((sub, name)) => {
                let sub = staged.folder.join(sub);
                if !sub.is_dir() {
                    std::fs::create_dir(&sub)?;
                    staged.folders.push(sub.clone());
                }
                sub.join(name)
            }
            None => staged.folder.join(&file.path),
        };
        let out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)?;
        staged.files.push(destination);
        let mut sink = BufWriter::new(out);
        let got = reader
            .read(*index, slot.cap(), &mut sink)
            .map_err(|error| match read_reason(error) {
                Ok(reason) => refuse(&reason),
                Err(error) => error,
            })?;
        sink.into_inner()
            .map_err(|error| Error::Io(error.into_error()))?
            .sync_all()?;
        if got.sha256 != file.sha256 {
            return Err(refuse(&format!(
                "“{}” does not match its manifest — the backup was changed after it was written",
                shown(&file.path)
            )));
        }
    }

    check_database(&staged.folder.join(WORK_FILE), &staged.manifest).map_err(refuse)?;
    Ok(staged)
}

/// The sentence for a target whose parent folder is not there.
pub const NO_PARENT: &str = "The folder that would hold the restored work is not there.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_allow_list_takes_exactly_the_names_a_work_folder_holds() {
        let hash = "0af9".repeat(16);
        for (name, slot) in [
            ("manifest.json", Slot::Manifest),
            ("manifest.sha256", Slot::ManifestHash),
            ("work.sqlite3", Slot::Database),
            (&*format!("documents/{hash}.jpg"), Slot::Document),
            (&*format!("documents/{hash}.jpeg"), Slot::Document),
            (&*format!("documents/{hash}.pdf"), Slot::Document),
            (&*format!("documents/{hash}.webp"), Slot::Document),
            (&*format!("thumbnails/{hash}.jpg"), Slot::Thumbnail),
        ] {
            assert_eq!(classify(name), Ok(slot), "{name}");
        }
        for (name, words) in [
            ("../escape", "points outside"),
            ("documents/../../escape.jpg", "points outside"),
            ("..\\escape", "points outside"),
            ("/etc/passwd", "with a full path"),
            ("\\Windows\\win.ini", "with a full path"),
            ("C:/Windows/win.ini", "on a drive"),
            ("c:work.sqlite3", "on a drive"),
            ("notes.txt", "never holds"),
            ("documents/", "never holds"),
            ("documents", "never holds"),
            (&*format!("documents/{hash}.svg"), "never holds"),
            (&*format!("documents/{hash}.JPG"), "never holds"),
            (
                &*format!("documents/{}.jpg", hash.to_uppercase()),
                "never holds",
            ),
            (&*format!("thumbnails/{hash}.png"), "never holds"),
            (&*format!("documents/sub/{hash}.jpg"), "never holds"),
            (&*format!("documents/{hash}.jpg.exe"), "never holds"),
            ("WORK.SQLITE3", "never holds"),
            ("work.sqlite3-wal", "never holds"),
        ] {
            let reason = classify(name).expect_err(name);
            assert!(reason.contains(words), "{name}: {reason}");
        }
    }

    #[test]
    fn a_hostile_name_is_shown_safely_in_a_sentence() {
        let reason = classify(&format!("evil\u{7}{}", "x".repeat(200))).unwrap_err();
        assert!(reason.contains("evil_"), "{reason}");
        assert!(reason.contains('…'));
        assert!(reason.chars().count() < 200);
    }

    #[test]
    fn a_uri_names_the_file_whatever_its_path_holds() {
        assert_eq!(
            immutable_uri(Path::new("C:\\Works\\Bath room #1\\work.sqlite3")),
            "file:///C:/Works/Bath%20room%20%231/work.sqlite3?immutable=1"
        );
        assert_eq!(
            immutable_uri(Path::new("/tmp/a?b%/work.sqlite3")),
            "file:///tmp/a%3Fb%25/work.sqlite3?immutable=1"
        );
        assert_eq!(
            immutable_uri(Path::new("C:\\Obras\\Banheiro\\work.sqlite3")),
            "file:///C:/Obras/Banheiro/work.sqlite3?immutable=1"
        );
        assert!(immutable_uri(Path::new("C:\\Obras\\Cozinha é\\w")).contains("%C3%A9"));
    }
}
