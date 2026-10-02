//! A work is a folder: creating one, opening one, closing one.
//!
//! The folder is the person's. They chose it in a dialog, they can move it,
//! copy it, back it up with whatever they use for everything else, and the
//! product finds the work again from wherever it is now. Everything about a
//! work is inside it — `work.sqlite3` today; documents and thumbnails from
//! slice F7 — and nothing about it is anywhere else.
//!
//! Three promises this module keeps:
//!
//! - **A new work gets a folder of its own.** It is created in a folder that
//!   does not exist yet or is empty, and never mixed into one that holds
//!   somebody's other files.
//! - **A work that is not there is said to be not there.** An open work whose
//!   folder was moved, renamed or deleted is `work_moved` on the next command,
//!   not a write into a file that is no longer the one the person sees.
//! - **A closed work is one file.** Closing checkpoints the write-ahead log into
//!   the database and closes the connection, so the folder holds `work.sqlite3`
//!   and no `-wal` or `-shm` beside it — which is what a person copying the
//!   folder, or a program synchronising it, needs to find (ADR-004).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, ErrorCode, OpenFlags};

use crate::contract::{WorkDraft, WorkSummary};
use crate::db::{self, migrations, work::NewWork};
use crate::error::{Error, Result, NOT_A_WORK, NO_WORK_FILE};
use crate::validate;

/// The work database's file name, inside the work folder.
pub const WORK_FILE: &str = "work.sqlite3";

/// The work that is open, if one is — at most one at a time.
#[derive(Default)]
pub struct OpenWork(pub Mutex<Option<WorkState>>);

/// An open work: where it was opened from, and its connection.
pub struct WorkState {
    /// The folder it was opened from.
    pub folder: PathBuf,
    /// The connection to its `work.sqlite3`.
    pub conn: Connection,
    /// Its UUID.
    pub work_id: String,
}

impl WorkState {
    /// The database file.
    pub fn database_path(&self) -> PathBuf {
        self.folder.join(WORK_FILE)
    }

    /// Refuse to go on if the work is no longer where it was opened from.
    ///
    /// # Errors
    ///
    /// [`Error::WorkMoved`] when `work.sqlite3` is gone from the folder.
    pub fn ensure_present(&self) -> Result<()> {
        if self.database_path().exists() {
            Ok(())
        } else {
            log::warn!("the open work is no longer at {}", self.folder.display());
            Err(Error::WorkMoved)
        }
    }

    /// The work in a line, read from the file so a rename is reflected.
    ///
    /// # Errors
    ///
    /// [`Error::Database`] when the work row cannot be read.
    pub fn summary(&self) -> Result<WorkSummary> {
        let name = db::work::work(&self.conn)?.name;
        Ok(WorkSummary {
            work_id: self.work_id.clone(),
            name,
            folder: self.folder.to_string_lossy().into_owned(),
        })
    }
}

/// Whether a folder holds a work file.
pub fn is_present(folder: &Path) -> bool {
    folder.join(WORK_FILE).is_file()
}

/// The folder a command was handed, as a path the host will use.
///
/// # Errors
///
/// [`Error::InvalidInput`] for nothing, or for a relative path — which would be
/// resolved against wherever the process happens to be running, and so be a
/// different folder on a different day.
pub fn folder_path(folder: &str) -> Result<PathBuf> {
    if folder.trim().is_empty() {
        return Err(Error::InvalidInput("Choose a folder for the work.".into()));
    }
    let path = PathBuf::from(folder);
    if !path.is_absolute() {
        return Err(Error::InvalidInput(
            "A work's folder is a full path, such as C:\\Works\\Bathroom.".into(),
        ));
    }
    Ok(path)
}

/// Check a draft and turn it into the row a new work is written with.
///
/// # Errors
///
/// [`Error::InvalidInput`] for the first field that does not fit.
pub fn check_draft(draft: &WorkDraft) -> Result<NewWork> {
    Ok(NewWork {
        work_id: db::new_id(),
        name: validate::name("work", &draft.name)?,
        place: validate::place(&draft.place)?,
        start_date: validate::date("A work's start", &draft.start_date)?,
        currency: validate::currency(&draft.currency)?,
        working_days: validate::working_days(&draft.working_days)?,
        hours_per_day: validate::hours_per_day(draft.hours_per_day)?,
    })
}

/// Create a work in a folder that does not exist yet or is empty.
///
/// The draft is checked before the disk is touched. If writing the database
/// fails part-way, what was written is removed — and the folder too, when this
/// call created it — so a failed create leaves nothing behind that looks like a
/// work.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a draft that does not fit or a path that is a
/// file; [`Error::WorkFolderNotEmpty`] for a folder that holds anything;
/// [`Error::Io`] when the folder cannot be created; [`Error::Database`] when the
/// database cannot be written.
pub fn create(folder: &Path, draft: &WorkDraft) -> Result<WorkState> {
    create_then(folder, draft, |_| Ok(()))
}

/// [`create`], and then `then` on the new work before it is handed back — a
/// template's plan, applied in the same step. When `then` refuses, the work is
/// closed and removed exactly as a failed create is: its files, and the folder
/// too when this call created it. A folder that was there and empty before the
/// call is left there, empty again.
///
/// # Errors
///
/// As [`create`], and whatever `then` returns.
pub fn create_then(
    folder: &Path,
    draft: &WorkDraft,
    then: impl FnOnce(&Connection) -> Result<()>,
) -> Result<WorkState> {
    let new_work = check_draft(draft)?;

    let created_folder = if folder.exists() {
        if !folder.is_dir() {
            return Err(Error::InvalidInput(
                "That path is a file, not a folder.".into(),
            ));
        }
        if std::fs::read_dir(folder)?.next().is_some() {
            return Err(Error::WorkFolderNotEmpty);
        }
        false
    } else {
        std::fs::create_dir_all(folder)?;
        true
    };

    // The connection is dropped — closed — before anything is removed: a file
    // Windows holds open cannot be deleted.
    let written = write_new(folder, &new_work).and_then(|conn| {
        then(&conn)?;
        Ok(conn)
    });
    match written {
        Ok(conn) => {
            log::info!("a new work was created");
            Ok(WorkState {
                folder: folder.to_path_buf(),
                conn,
                work_id: new_work.work_id,
            })
        }
        Err(error) => {
            remove_database_files(folder);
            if created_folder {
                // `remove_dir`, never `remove_dir_all`: it only removes a folder
                // that is empty, so it cannot take anything that was not ours.
                let _ = std::fs::remove_dir(folder);
            }
            Err(error)
        }
    }
}

fn write_new(folder: &Path, new_work: &NewWork) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        folder.join(WORK_FILE),
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db::configure(&conn)?;
    db::work::create(&conn, new_work)?;
    Ok(conn)
}

fn remove_database_files(folder: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(folder.join(format!("{WORK_FILE}{suffix}")));
    }
}

/// Open the work in a folder, migrating it forward if it was written by an
/// earlier version.
///
/// The file is opened without the flag that creates it, so a folder that loses
/// its work between the check and the open is `work_not_found`, never a new
/// empty database.
///
/// # Errors
///
/// [`Error::WorkNotFound`] when there is no `work.sqlite3`, or it is not a work
/// this product wrote; [`Error::NewerVersion`] when a later version wrote it;
/// [`Error::Database`] when it cannot be read or migrated.
pub fn open(folder: &Path) -> Result<WorkState> {
    let path = folder.join(WORK_FILE);
    if !path.is_file() {
        return Err(Error::WorkNotFound(NO_WORK_FILE));
    }

    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(not_a_work)?;
    db::configure(&conn).map_err(|error| match error {
        Error::Database(inner) => not_a_work(inner),
        other => other,
    })?;

    if migrations::WORK.current_version(&conn) == 0 {
        return Err(Error::WorkNotFound(NOT_A_WORK));
    }
    migrations::WORK.apply(&conn)?;

    // What migration 008's backfill could not know is read from the files.
    db::documents::complete(&conn, folder)?;

    let work_id = db::work::work(&conn)?.work_id;
    log::info!("a work was opened");
    Ok(WorkState {
        folder: folder.to_path_buf(),
        conn,
        work_id,
    })
}

/// Which work a folder holds — its `workId` and its name — read without
/// migrating or completing anything, and closed again at once. Used to find a
/// moved work again before the recent list is told where it is.
///
/// # Errors
///
/// [`Error::WorkNotFound`] when the folder holds no work this product wrote.
pub fn identify(folder: &Path) -> Result<(String, String)> {
    let path = folder.join(WORK_FILE);
    if !path.is_file() {
        return Err(Error::WorkNotFound(NO_WORK_FILE));
    }
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(not_a_work)?;
    let found = conn
        .query_row("SELECT work_id, name FROM work WHERE id = 1", [], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| Error::WorkNotFound(NOT_A_WORK))?;
    if let Err((_, error)) = conn.close() {
        log::warn!("a work read to identify it did not close cleanly: {error}");
    }
    Ok(found)
}

/// A file SQLite will not read as a database is a folder with no work in it,
/// as far as the person is concerned.
fn not_a_work(error: rusqlite::Error) -> Error {
    match error.sqlite_error_code() {
        Some(ErrorCode::NotADatabase) => Error::WorkNotFound(NOT_A_WORK),
        _ => Error::Database(error),
    }
}

/// Close a work: fold the write-ahead log into the database, then close the
/// connection, so the folder holds one file.
///
/// Never fails. A work whose checkpoint cannot run — its folder gone — is still
/// closed; the reason is logged. SQLite checkpoints again on the last close in
/// any case, and a log it could not fold in is replayed on the next open.
pub fn close(state: WorkState) {
    let WorkState { conn, .. } = state;
    let checkpoint = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
        row.get::<_, i64>(0)
    });
    match checkpoint {
        Ok(0) => {}
        Ok(_) => log::warn!("the work's checkpoint was blocked; the log is folded in on close"),
        Err(error) => log::warn!("the work's checkpoint failed: {error}"),
    }
    if let Err((_, error)) = conn.close() {
        log::warn!("the work's database did not close cleanly: {error}");
    }
    log::info!("the work was closed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testing::Scratch;

    pub fn draft() -> WorkDraft {
        WorkDraft {
            name: "Synthetic bathroom".into(),
            place: "A synthetic street".into(),
            start_date: "2026-10-05".into(),
            currency: "brl".into(),
            working_days: "1111100".into(),
            hours_per_day: 8.0,
        }
    }

    fn files_in(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(folder)
            .expect("list the folder")
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_work_created_in_a_folder_that_does_not_exist_yet_creates_it_with_its_rows() {
        let scratch = Scratch::create();
        let folder = scratch.path().join("Bathroom");

        let state = create(&folder, &draft()).expect("create");

        assert!(is_present(&folder));
        let plan = db::work::snapshot(&state.conn).expect("snapshot");
        assert_eq!(plan.work.work_id, state.work_id);
        assert_eq!(plan.work.name, "Synthetic bathroom");
        assert_eq!(plan.work.currency, "BRL", "stored upper-case");
        assert_eq!(plan.calendar.working_days, "1111100");
        assert_eq!(
            migrations::WORK.current_version(&state.conn),
            migrations::WORK.target_version()
        );
        close(state);
    }

    #[test]
    fn a_work_is_created_in_an_empty_folder_that_already_exists() {
        let scratch = Scratch::create();
        let state = create(scratch.path(), &draft()).expect("an empty folder is fine");
        close(state);
    }

    #[test]
    fn a_new_work_is_refused_in_a_folder_that_already_holds_a_file() {
        let scratch = Scratch::create();
        std::fs::write(scratch.path().join("notes.txt"), "someone's file").unwrap();

        let refused = create(scratch.path(), &draft()).err().expect("not empty");

        assert_eq!(refused.kind(), "work_folder_not_empty");
        assert_eq!(
            files_in(scratch.path()),
            vec!["notes.txt"],
            "nothing was added"
        );
    }

    #[test]
    fn a_new_work_is_refused_on_a_path_that_is_a_file() {
        let scratch = Scratch::create();
        let file = scratch.path().join("plan.txt");
        std::fs::write(&file, "x").unwrap();

        let refused = create(&file, &draft()).err().expect("a file");

        assert_eq!(refused.kind(), "invalid_input");
    }

    #[test]
    fn a_draft_that_does_not_fit_is_refused_before_the_folder_is_created() {
        let scratch = Scratch::create();
        let folder = scratch.path().join("Never");

        for broken in [
            WorkDraft {
                working_days: "0000000".into(),
                ..draft()
            },
            WorkDraft {
                hours_per_day: 0.0,
                ..draft()
            },
            WorkDraft {
                name: " ".into(),
                ..draft()
            },
            WorkDraft {
                start_date: "2026-02-30".into(),
                ..draft()
            },
        ] {
            let refused = create(&folder, &broken).err().expect("refused");
            assert_eq!(refused.kind(), "invalid_input");
            assert!(
                !folder.exists(),
                "the folder was not created for a refused draft"
            );
        }
    }

    #[test]
    fn opening_a_folder_without_a_work_file_is_work_not_found() {
        let scratch = Scratch::create();
        std::fs::write(scratch.path().join("notes.txt"), "x").unwrap();

        let refused = open(scratch.path()).err().expect("no work here");

        assert_eq!(refused.kind(), "work_not_found");
        assert_eq!(refused.to_string(), NO_WORK_FILE);
        assert_eq!(
            files_in(scratch.path()),
            vec!["notes.txt"],
            "and none was created"
        );

        let missing = open(&scratch.path().join("gone")).err().expect("no folder");
        assert_eq!(missing.kind(), "work_not_found");
    }

    #[test]
    fn a_work_file_that_is_not_a_database_or_not_a_work_is_work_not_found() {
        let scratch = Scratch::create();
        let garbage = scratch.path().join("garbage");
        std::fs::create_dir(&garbage).unwrap();
        std::fs::write(
            garbage.join(WORK_FILE),
            b"this is not SQLite, only text that says so",
        )
        .unwrap();
        let refused = open(&garbage).err().expect("not a database");
        assert_eq!(refused.kind(), "work_not_found");
        assert_eq!(refused.to_string(), NOT_A_WORK);

        let other = scratch.path().join("other");
        std::fs::create_dir(&other).unwrap();
        Connection::open(other.join(WORK_FILE))
            .unwrap()
            .execute_batch("CREATE TABLE something_else (x)")
            .unwrap();
        let refused = open(&other).err().expect("a database, not a work");
        assert_eq!(refused.kind(), "work_not_found");
        assert_eq!(refused.to_string(), NOT_A_WORK);
    }

    #[test]
    fn a_closed_work_reopens_with_everything_it_held() {
        let scratch = Scratch::create();
        let state = create(scratch.path(), &draft()).expect("create");
        let work_id = state.work_id.clone();
        let stage = db::work::add_stage(&state.conn, "Bathroom").unwrap();
        db::work::add_activity(&state.conn, &stage, "Tiling").unwrap();
        close(state);

        let again = open(scratch.path()).expect("open");

        assert_eq!(again.work_id, work_id);
        let plan = db::work::snapshot(&again.conn).unwrap();
        assert_eq!(plan.stages.len(), 1);
        assert_eq!(plan.activities[0].name, "Tiling");
        close(again);
    }

    /// The folder holds one file after a close — no `-wal`, no `-shm` — which is
    /// what somebody copying it or a program synchronising it needs to find.
    #[test]
    fn closing_a_work_leaves_exactly_one_file_in_its_folder() {
        let scratch = Scratch::create();
        let state = create(scratch.path(), &draft()).expect("create");
        for index in 0..20 {
            db::work::add_stage(&state.conn, &format!("Stage {index}")).unwrap();
        }
        assert!(
            files_in(scratch.path()).len() > 1,
            "while open, the log is beside the database: {:?}",
            files_in(scratch.path())
        );

        close(state);

        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
        let again = open(scratch.path()).expect("and it opens again");
        assert_eq!(db::work::snapshot(&again.conn).unwrap().stages.len(), 20);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    #[test]
    fn an_open_work_runs_under_every_pragma() {
        let scratch = Scratch::create();
        let state = create(scratch.path(), &draft()).expect("create");
        let read = |name: &str| -> String {
            state
                .conn
                .query_row(&format!("PRAGMA {name}"), [], |row| {
                    row.get::<_, rusqlite::types::Value>(0)
                })
                .map(|value| match value {
                    rusqlite::types::Value::Integer(n) => n.to_string(),
                    rusqlite::types::Value::Text(t) => t.to_lowercase(),
                    other => format!("{other:?}"),
                })
                .unwrap()
        };

        assert_eq!(read("journal_mode"), "wal");
        assert_eq!(read("synchronous"), "2", "FULL");
        assert_eq!(read("foreign_keys"), "1");
        assert_eq!(read("recursive_triggers"), "1");
        assert_eq!(read("busy_timeout"), "5000");
        close(state);
    }

    #[test]
    fn a_folder_is_a_full_path_and_never_nothing() {
        assert_eq!(folder_path("").unwrap_err().kind(), "invalid_input");
        assert_eq!(folder_path("  ").unwrap_err().kind(), "invalid_input");
        assert_eq!(
            folder_path("works/bathroom").unwrap_err().kind(),
            "invalid_input"
        );
        let absolute = std::env::temp_dir();
        assert_eq!(folder_path(&absolute.to_string_lossy()).unwrap(), absolute);
    }

    /// A work folder written by F0 — a file on disk at schema 1 — is opened by
    /// F1, migrated in place, and closed back to one file.
    #[test]
    fn a_work_folder_written_at_schema_one_opens_migrated_and_keeps_its_rows() {
        let scratch = Scratch::create();
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
        }

        let state = open(scratch.path()).expect("open an F0 work");

        assert_eq!(
            migrations::WORK.current_version(&state.conn),
            migrations::WORK.target_version()
        );
        let plan = db::work::snapshot(&state.conn).unwrap();
        assert_eq!(plan.activities[0].name, "Tiling");
        assert_eq!(plan.activities[0].duration_days, Some(3));
        assert!(plan.rooms.is_empty());
        close(state);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from F6: a work folder at schema 7 with a
    /// diary photo, an answer's photo, a receipt and a quote document. Opened
    /// by F7, every one becomes a document linked where it came from — the
    /// entry and the payment by their seq, the answer's photo to its check's
    /// stage, the quote to its commitment — completed from its file, except the
    /// one whose file is gone; and the diary chain still verifies.
    #[test]
    fn a_work_folder_at_schema_seven_is_backfilled_with_its_documents_and_the_chain_still_verifies()
    {
        use crate::db::{check_answers, checks, diary, money, payments};
        use crate::files::intake;

        let scratch = Scratch::create();
        let documents = scratch.path().join(intake::DOCUMENTS);
        std::fs::create_dir(&documents).unwrap();
        let file = |bytes: Vec<u8>, extension: &str| -> (String, Vec<u8>) {
            let hash = intake::sha256_hex(&bytes);
            std::fs::write(documents.join(format!("{hash}.{extension}")), &bytes).unwrap();
            (hash, bytes)
        };
        let (photo, photo_bytes) = file(intake::tests::png(64, 48), "png");
        let (inspection, _) = file(intake::tests::jpeg(40, 30), "jpg");
        let (receipt, receipt_bytes) = file(intake::tests::png(20, 30), "png");
        let quote_gone = "ab".repeat(32);

        let stage = "00000000-0000-7000-8000-00000000000b";
        let commitment;
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 7).unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-05".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    hours: None,
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: Vec::new(),
                    present: Vec::new(),
                    photos: vec![crate::contract::Photo {
                        file_hash: photo.clone(),
                        file_name: "wall.png".into(),
                        bytes: photo_bytes.len() as i64,
                        width: 64,
                        height: 48,
                        thumbnail: false,
                    }],
                },
            )
            .unwrap();
            let check = checks::add(&conn, stage, checks::Gate::Close, "Inspected").unwrap();
            check_answers::append(
                &conn,
                &check_answers::NewAnswer {
                    check_id: check,
                    answer: "yes".into(),
                    reason: None,
                    photo_hash: Some(inspection.clone()),
                    author_name: "Synthetic inspector".into(),
                },
            )
            .unwrap();
            payments::append(
                &conn,
                &payments::NewPayment {
                    day: "2026-10-06".into(),
                    person_id: None,
                    stage_id: stage.into(),
                    commitment_id: None,
                    amount_cents: 100_000,
                    what_for: None,
                    receipt_hash: Some(receipt.clone()),
                    author_name: "Synthetic owner".into(),
                },
            )
            .unwrap();
            commitment = money::add_commitment(
                &conn,
                stage,
                &money::CommitmentFields {
                    person_id: None,
                    label: "Tiler's quote".into(),
                    amount_cents: 150_000,
                    agreed_on: "2026-10-01".into(),
                    document_hash: Some(quote_gone.clone()),
                },
            )
            .unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 7);
        }

        let state = open(scratch.path()).expect("an F6 work opens in F7");

        assert_eq!(
            migrations::WORK.current_version(&state.conn),
            migrations::WORK.target_version()
        );
        let report = diary::verify(&state.conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (1, true),
            "the chain still holds"
        );

        let plan = db::work::snapshot(&state.conn).unwrap();
        assert_eq!(plan.documents.len(), 4);
        let of = |hash: &str| plan.documents.iter().find(|d| d.file_hash == hash).unwrap();
        let link = |kind: &str, id: &str| crate::contract::DocumentTarget {
            target_kind: kind.into(),
            target_id: id.into(),
        };

        let d = of(&photo);
        assert_eq!(
            d.id,
            format!(
                "{}-{}-{}-{}-{}",
                &photo[..8],
                &photo[8..12],
                &photo[12..16],
                &photo[16..20],
                &photo[20..32]
            )
        );
        assert_eq!(
            (d.kind.as_str(), d.file_name.as_str(), d.title.as_str()),
            ("photo", "wall.png", "wall.png")
        );
        assert_eq!(
            (d.media_type.as_str(), d.bytes),
            ("image/png", photo_bytes.len() as i64)
        );
        assert_eq!((d.width, d.height), (Some(64), Some(48)));
        assert_eq!(
            (d.added_on.as_str(), d.author_name.as_str()),
            ("2026-10-05", "Synthetic author")
        );
        assert_eq!(d.links, vec![link("entry", "1")]);

        let d = of(&inspection);
        assert_eq!(
            (d.kind.as_str(), d.title.as_str()),
            ("photo", "Photo: Inspected")
        );
        assert_eq!(
            (d.media_type.as_str(), d.width, d.height),
            ("image/jpeg", Some(40), Some(30)),
            "completed from the file"
        );
        assert_eq!(d.links, vec![link("stage", stage)]);

        let d = of(&receipt);
        assert_eq!(
            (d.kind.as_str(), d.title.as_str()),
            ("receipt", "Receipt of payment #1")
        );
        assert_eq!(
            (d.media_type.as_str(), d.bytes),
            ("image/png", receipt_bytes.len() as i64)
        );
        assert_eq!(d.links, vec![link("payment", "1")]);

        let d = of(&quote_gone);
        assert_eq!(
            (d.kind.as_str(), d.title.as_str()),
            ("quote", "Quote: Tiler's quote")
        );
        assert_eq!(
            (d.media_type.as_str(), d.bytes, d.width),
            ("application/octet-stream", 0, None),
            "its file was never in the folder: it stays incomplete, and says so"
        );
        assert_eq!(d.links, vec![link("commitment", &commitment)]);

        close(state);
        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        assert_eq!(db::work::snapshot(&again.conn).unwrap().documents.len(), 4);
        close(again);
    }

    /// The id migration 009 derives for a stage none of whose activities is
    /// left, computed here the long way: four polynomial hashes of the name's
    /// code points, each modulo a prime just under 2^32, in the form of a UUID.
    fn derived_stage_id(name: &str) -> String {
        let (mut a, mut b, mut c, mut d) =
            (2_166_136_261u64, 16_777_619u64, 5381u64, 1_315_423_911u64);
        for ch in name.chars() {
            let u = u64::from(ch);
            a = (a * 31 + u) % 4_294_967_291;
            b = (b * 37 + u) % 4_294_967_279;
            c = (c * 41 + u) % 4_294_967_231;
            d = (d * 43 + u) % 4_294_967_197;
        }
        format!(
            "{a:08x}-{:04x}-{:04x}-{:04x}-{:04x}{d:08x}",
            b >> 16,
            b & 0xffff,
            c >> 16,
            c & 0xffff
        )
    }

    /// The upgrade a person makes from F7: a work folder at schema 8 with two
    /// baselines — taken freely, as F2 to F7 allowed — and a diary entry. The
    /// first baseline names a stage later renamed and a stage ("Demolition")
    /// all of whose activities were removed since; the second names the
    /// renamed stage by its new name, a stage added in between, and
    /// Demolition again. Opened by F8: every baseline gains its stages, by
    /// the id of the stage its activities still belong to — the renamed stage
    /// is one stage in both — and by an id derived from the name where none is
    /// left, the same in both; their money reads "not recorded"; nothing else
    /// in them moves; the diary chain still verifies; no replanning is open,
    /// so the approved plan is locked — and a third baseline, taken through a
    /// replanning, records its money.
    #[test]
    fn a_work_folder_at_schema_eight_with_two_baselines_gains_their_stages_and_the_chain_still_verifies(
    ) {
        use crate::db::{baselines, diary, replanning};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let painting = "00000000-0000-7000-8000-0000000000a1";
        let walls = "00000000-0000-7000-8000-0000000000a2";
        let (first, second) = (
            "00000000-0000-7000-8000-0000000000b1",
            "00000000-0000-7000-8000-0000000000b2",
        );
        let raw_baselines = |conn: &Connection| -> Vec<String> {
            let mut statement = conn
                .prepare(
                    "SELECT b.number, b.reason, b.finish_date, ba.activity_id, ba.position, ba.name,
                            ba.stage_name, ba.duration_days, ba.start, ba.finish
                     FROM baseline b JOIN baseline_activity ba ON ba.baseline_id = b.id
                     ORDER BY b.number, ba.position",
                )
                .unwrap();
            let width = statement.column_count();
            statement
                .query_map([], |row| {
                    (0..width)
                        .map(|i| {
                            row.get::<_, rusqlite::types::Value>(i)
                                .map(|v| format!("{v:?}"))
                        })
                        .collect::<std::result::Result<Vec<_>, _>>()
                        .map(|values| values.join("|"))
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap()
        };

        let rows_before;
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 8).unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO stage (id, position, name, created_at)
                 VALUES ('{painting}', 2, 'Painting', 't');
                 INSERT INTO activity (id, stage_id, position, name, duration_days, created_at)
                 VALUES ('{walls}', '{painting}', 1, 'Walls', 2, 't');
                 UPDATE work SET approved_at = '2026-09-25T12:00:00.000Z';
                 INSERT INTO baseline (id, number, taken_at, finish_date)
                 VALUES ('{first}', 1, '2026-09-25T12:00:00.000Z', '2026-10-09');
                 INSERT INTO baseline_activity (baseline_id, activity_id, position, name,
                                                stage_name, duration_days, start, finish)
                 VALUES ('{first}', '00000000-0000-7000-8000-0000000000d1', 1, 'Strip out',
                         'Demolition', 1, '2026-10-05', '2026-10-05'),
                        ('{first}', '00000000-0000-7000-8000-0000000000d2', 2, 'Skip hire',
                         'Demolition', NULL, NULL, NULL),
                        ('{first}', '{tiling}', 3, 'Tiling', 'Bathroom', 3,
                         '2026-10-06', '2026-10-08');
                 INSERT INTO baseline (id, number, taken_at, finish_date)
                 VALUES ('{second}', 2, '2026-09-28T12:00:00.000Z', '2026-10-12');
                 INSERT INTO baseline_activity (baseline_id, activity_id, position, name,
                                                stage_name, duration_days, start, finish)
                 VALUES ('{second}', '{tiling}', 1, 'Tiling', 'Main bathroom', 3,
                         '2026-10-06', '2026-10-08'),
                        ('{second}', '{walls}', 2, 'Walls', 'Painting', 2,
                         '2026-10-09', '2026-10-12'),
                        ('{second}', '00000000-0000-7000-8000-0000000000d3', 3, 'Rubble out',
                         'Demolition', 1, '2026-10-05', '2026-10-05');
                 UPDATE stage SET name = 'Main bathroom' WHERE id = '{bathroom}';"
            ))
            .expect("an F7 work's two baselines");
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    hours: None,
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: Vec::new(),
                    present: Vec::new(),
                    photos: Vec::new(),
                },
            )
            .unwrap();
            rows_before = raw_baselines(&conn);
            assert_eq!(migrations::WORK.current_version(&conn), 8);
        }

        let state = open(scratch.path()).expect("an F7 work opens in F8");

        assert_eq!(
            migrations::WORK.current_version(&state.conn),
            migrations::WORK.target_version()
        );
        let report = diary::verify(&state.conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (1, true),
            "the chain still holds"
        );
        assert_eq!(
            raw_baselines(&state.conn),
            rows_before,
            "every row a baseline held reads as it did"
        );

        let plan = db::work::snapshot(&state.conn).unwrap();
        let demolition = derived_stage_id("Demolition");
        assert_eq!(demolition.len(), 36);
        let stages = |number: usize| -> Vec<(String, i64, String, Option<i64>)> {
            plan.baselines[number]
                .stages
                .iter()
                .map(|s| {
                    (
                        s.stage_id.clone(),
                        s.position,
                        s.name.clone(),
                        s.planned_cents,
                    )
                })
                .collect()
        };
        assert_eq!(
            stages(0),
            vec![
                (demolition.clone(), 1, "Demolition".into(), None),
                (bathroom.into(), 2, "Bathroom".into(), None),
            ],
            "in the order they first appear; the stage by the id its activity still has"
        );
        assert_eq!(
            stages(1),
            vec![
                (bathroom.into(), 1, "Main bathroom".into(), None),
                (painting.into(), 2, "Painting".into(), None),
                (demolition.clone(), 3, "Demolition".into(), None),
            ],
            "renamed, the same stage; gone, the same derived id in both"
        );
        for baseline in &plan.baselines {
            assert_eq!(baseline.planned_cents, None, "not recorded then");
            assert!(baseline.rows.iter().all(|row| row.planned_cents.is_none()));
        }
        let wire = serde_json::to_value(&plan.baselines[0]).unwrap();
        assert_eq!(wire["plannedCents"], serde_json::Value::Null);
        assert_eq!(wire["stages"][0]["plannedCents"], serde_json::Value::Null);
        assert_eq!(plan.replanning, None);

        // The approved plan is locked; the backfilled rows are insert-only.
        assert_eq!(
            replanning::refuse_if_plan_locked(&state.conn)
                .unwrap_err()
                .kind(),
            "plan_approved"
        );
        for attack in [
            "UPDATE baseline_stage SET name = 'Rewritten'",
            "UPDATE baseline_stage SET planned_cents = 0",
            "DELETE FROM baseline_stage",
            "UPDATE baseline SET planned_cents = 0",
        ] {
            let refused = state.conn.execute(attack, []).expect_err(attack);
            assert!(
                refused.to_string().contains("baseline: append-only"),
                "{attack}"
            );
        }

        // A third baseline, through a replanning, records money — 0 is
        // recorded, and is not "not recorded".
        replanning::open(&state.conn, "Walls need a second coat", "Synthetic author").unwrap();
        let placements: Vec<baselines::Placement> = plan
            .activities
            .iter()
            .map(|a| baselines::Placement {
                activity_id: a.id.clone(),
                start: None,
                finish: None,
            })
            .collect();
        assert_eq!(baselines::take(&state.conn, &placements, None).unwrap(), 3);
        let third = db::work::snapshot(&state.conn).unwrap().baselines.remove(2);
        assert_eq!(third.planned_cents, Some(0));
        assert_eq!(third.reason.as_deref(), Some("Walls need a second coat"));
        assert_eq!(third.stages.len(), 2);
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        assert_eq!(db::work::snapshot(&again.conn).unwrap().baselines.len(), 3);
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
    }

    /// Every row of `sql`, each value in its debug form — raw, not through a
    /// snapshot, so a file at an older schema can be compared with itself
    /// after the migration.
    fn raw_rows(conn: &Connection, sql: &str) -> Vec<String> {
        let mut statement = conn.prepare(sql).unwrap();
        let width = statement.column_count();
        statement
            .query_map([], |row| {
                (0..width)
                    .map(|i| {
                        row.get::<_, rusqlite::types::Value>(i)
                            .map(|v| format!("{v:?}"))
                    })
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map(|values| values.join("|"))
            })
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap()
    }

    /// The upgrade a person makes from F8: a work folder at schema 9 with three
    /// cost lines — on an activity, on the stage, and one of 0 — an approval
    /// with its baseline (stages and money recorded), and a diary entry. Opened
    /// by F9, `cost_line` is rebuilt under `foreign_keys = ON`: every line keeps
    /// its id, its amount (0 stays 0, not "not priced"), its label and when it
    /// was written; its indexes are back; its references still hold and still
    /// cascade; the baseline reads as it did; the diary chain still verifies;
    /// and the work gains no range and no provenance.
    #[test]
    fn a_work_folder_at_schema_nine_with_cost_lines_a_baseline_and_a_diary_rebuilds_its_cost_lines_and_keeps_every_row(
    ) {
        use crate::db::diary;

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let baseline = "00000000-0000-7000-8000-0000000000b1";
        let lines = "SELECT id, stage_id, activity_id, label, amount_cents, created_at
                     FROM cost_line ORDER BY id";
        let baselines = [
            "SELECT id, number, taken_at, reason, finish_date, planned_cents FROM baseline",
            "SELECT * FROM baseline_activity ORDER BY baseline_id, position",
            "SELECT * FROM baseline_stage ORDER BY baseline_id, position",
        ];

        let (lines_before, baselines_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 9).unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO cost_line (id, stage_id, activity_id, label, amount_cents, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000c1', '{bathroom}', '{tiling}',
                         'Tiles', 120000, '2026-09-20T10:00:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000c2', '{bathroom}', NULL,
                         'Labour', 30000, '2026-09-20T10:00:01.000Z'),
                        ('00000000-0000-7000-8000-0000000000c3', '{bathroom}', NULL,
                         'Contingency', 0, '2026-09-20T10:00:02.000Z');
                 UPDATE work SET approved_at = '2026-09-25T12:00:00.000Z';
                 INSERT INTO baseline (id, number, taken_at, finish_date, planned_cents)
                 VALUES ('{baseline}', 1, '2026-09-25T12:00:00.000Z', '2026-10-07', 150000);
                 INSERT INTO baseline_stage (baseline_id, stage_id, position, name, planned_cents)
                 VALUES ('{baseline}', '{bathroom}', 1, 'Bathroom', 150000);
                 INSERT INTO baseline_activity (baseline_id, activity_id, position, name,
                                                stage_name, duration_days, start, finish,
                                                planned_cents)
                 VALUES ('{baseline}', '{tiling}', 1, 'Tiling', 'Bathroom', 3, '2026-10-05',
                         '2026-10-07', 120000);"
            ))
            .expect("an F8 work's money and its baseline");
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    hours: None,
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: vec![crate::contract::DoneLine {
                        activity_id: tiling.into(),
                        state: "worked".into(),
                        quantity: Some(4.0),
                        note: None,
                    }],
                    present: Vec::new(),
                    photos: Vec::new(),
                },
            )
            .unwrap();
            lines_before = raw_rows(&conn, lines);
            baselines_before = baselines.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::list(&conn, None, None).unwrap();
            assert_eq!(lines_before.len(), 3);
            assert_eq!(migrations::WORK.current_version(&conn), 9);
        }

        let state = open(scratch.path()).expect("an F8 work opens in F9, and on to head");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(raw_rows(conn, lines), lines_before, "every line, as it was");
        assert_eq!(
            baselines.map(|sql| raw_rows(conn, sql)),
            baselines_before,
            "every baseline row, untouched"
        );
        assert_eq!(diary::list(conn, None, None).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (1, true),
            "the chain still holds"
        );

        let plan = db::work::snapshot(conn).unwrap();
        let amounts: Vec<Option<i64>> = plan.cost_lines.iter().map(|c| c.amount_cents).collect();
        assert_eq!(
            amounts,
            vec![Some(120_000), Some(30_000), Some(0)],
            "0 stays 0: every line in a file before F9 is priced"
        );
        assert_eq!(plan.baselines[0].planned_cents, Some(150_000));
        assert_eq!(
            (
                plan.work.template_id.clone(),
                plan.work.template_version,
                plan.work.template_title.clone()
            ),
            (None, None, None)
        );
        assert_eq!(
            (
                plan.activities[0].duration_days,
                plan.activities[0].duration_min_days,
                plan.activities[0].duration_max_days
            ),
            (Some(3), None, None)
        );

        // The table is the one migration 007 made, less the NOT NULL.
        let indexes = raw_rows(
            conn,
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cost_line'
             AND name LIKE 'idx_%' ORDER BY name",
        );
        assert_eq!(
            indexes,
            vec![
                "Text(\"idx_cost_line_activity\")",
                "Text(\"idx_cost_line_stage\")"
            ]
        );
        assert_eq!(
            raw_rows(
                conn,
                "SELECT count(*) FROM sqlite_master WHERE name = 'cost_line_010'"
            ),
            vec!["Integer(0)"]
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());
        assert_eq!(raw_rows(conn, "PRAGMA foreign_keys"), vec!["Integer(1)"]);
        let refused = conn
            .execute(
                "INSERT INTO cost_line (id, stage_id, label, amount_cents, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000c9',
                         '00000000-0000-7000-8000-0000000000ff', 'Nowhere', 1, 't')",
                [],
            )
            .expect_err("a line on a stage that is not there");
        assert!(refused.to_string().contains("FOREIGN KEY"), "{refused}");
        for amount in ["-1", "1.5", "'ten'"] {
            conn.execute(
                &format!(
                    "INSERT INTO cost_line (id, stage_id, label, amount_cents, created_at)
                     VALUES ('00000000-0000-7000-8000-0000000000c8', '{bathroom}', 'X',
                             {amount}, 't')"
                ),
                [],
            )
            .expect_err(amount);
        }
        conn.execute(
            &format!(
                "INSERT INTO cost_line (id, stage_id, label, amount_cents, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000c8', '{bathroom}', 'Unpriced',
                         NULL, 't')"
            ),
            [],
        )
        .expect("not priced yet");
        conn.execute("DELETE FROM activity WHERE id = ?1", [tiling])
            .unwrap();
        assert_eq!(
            db::work::snapshot(conn).unwrap().cost_lines.len(),
            3,
            "the activity's line went with it: the cascade survived the rebuild"
        );
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from D1: a work folder at schema 10 with
    /// money — a cost line, two commitments, one paid against (a payment and
    /// its reversal) and one not — and a diary entry. Opened by D2, it gains
    /// `payment_milestone`, empty: every commitment reads "no payment plan",
    /// and nothing already written moves. The paid commitment's plan is fixed
    /// from the start — the reversal does not unfix it — and the unpaid one
    /// takes the usual plan. The diary chain still verifies.
    #[test]
    fn a_work_folder_at_schema_ten_with_money_and_a_diary_gains_payment_plans_and_keeps_every_row()
    {
        use crate::db::{diary, milestones};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let paid = "00000000-0000-7000-8000-0000000000d1";
        let unpaid = "00000000-0000-7000-8000-0000000000d2";
        let money = [
            "SELECT * FROM cost_line ORDER BY id",
            "SELECT * FROM commitment ORDER BY id",
            "SELECT * FROM payment ORDER BY seq",
            "SELECT id, name, trade FROM person ORDER BY id",
        ];

        let (money_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 10).unwrap();
            conn.execute_batch(&format!(
                "UPDATE person SET trade = 'Tiler';
                 INSERT INTO cost_line (id, stage_id, activity_id, label, amount_cents, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000c1', '{bathroom}', '{tiling}',
                         'Tiles', 120000, '2026-09-20T10:00:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000c2', '{bathroom}', NULL,
                         'Grout', NULL, '2026-09-20T10:00:01.000Z');
                 INSERT INTO commitment (id, stage_id, person_id, label, amount_cents, agreed_on,
                                         created_at)
                 VALUES ('{paid}', '{bathroom}', '00000000-0000-7000-8000-00000000000a',
                         'Tiler''s quote', 100000, '2026-10-01', '2026-10-01T09:00:00.000Z'),
                        ('{unpaid}', '{bathroom}', NULL, 'Plumber''s quote', 50000,
                         '2026-10-02', '2026-10-02T09:00:00.000Z');
                 INSERT INTO payment (id, seq, day, person_id, stage_id, commitment_id,
                                      amount_cents, what_for, author_name, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000e1', 1, '2026-10-03',
                         '00000000-0000-7000-8000-00000000000a', '{bathroom}', '{paid}', 30000,
                         'Advance', 'Synthetic author', '2026-10-03T09:00:00.000Z');
                 INSERT INTO payment (id, seq, day, person_id, stage_id, commitment_id,
                                      amount_cents, what_for, reverses_seq, author_name,
                                      created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000e2', 2, '2026-10-04',
                         '00000000-0000-7000-8000-00000000000a', '{bathroom}', '{paid}', -30000,
                         'Paid by mistake.', 1, 'Synthetic author',
                         '2026-10-04T09:00:00.000Z');"
            ))
            .expect("a D1 work's money");
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    hours: None,
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: vec![crate::contract::DoneLine {
                        activity_id: tiling.into(),
                        state: "finished".into(),
                        quantity: None,
                        note: None,
                    }],
                    present: Vec::new(),
                    photos: Vec::new(),
                },
            )
            .unwrap();
            money_before = money.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::list(&conn, None, None).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 10);
            assert_eq!(
                raw_rows(
                    &conn,
                    "SELECT count(*) FROM sqlite_master WHERE name = 'payment_milestone'"
                ),
                vec!["Integer(0)"]
            );
        }

        let state = open(scratch.path()).expect("a D1 work opens in D2");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            money.map(|sql| raw_rows(conn, sql)),
            money_before,
            "every row of money, as it was"
        );
        assert_eq!(diary::list(conn, None, None).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!((report.entries, report.intact), (1, true));

        let plan = db::work::snapshot(conn).unwrap();
        let commitments: Vec<(&str, bool, usize)> = plan
            .commitments
            .iter()
            .map(|c| (c.id.as_str(), c.locked, c.milestones.len()))
            .collect();
        assert_eq!(
            commitments,
            vec![(paid, true, 0), (unpaid, false, 0)],
            "no payment plan yet, on either; the paid one stays paid"
        );
        assert_eq!(
            serde_json::to_value(&plan.commitments[1]).unwrap()["milestones"],
            serde_json::json!([])
        );
        assert_eq!(
            raw_rows(
                conn,
                "SELECT name FROM sqlite_master WHERE tbl_name = 'payment_milestone'
                 AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ),
            [
                "idx_payment_milestone_activity",
                "payment_milestone_activity_insert",
                "payment_milestone_activity_update",
                "payment_milestone_locked_delete",
                "payment_milestone_locked_insert",
                "payment_milestone_locked_update",
                "payment_milestone_sum_insert",
                "payment_milestone_sum_update",
            ]
            .map(|name| format!("Text(\"{name}\")"))
        );

        assert_eq!(
            milestones::add_usual(conn, paid, ["Start", "Laid", "Closed"])
                .unwrap_err()
                .to_string(),
            milestones::PLAN_LOCKED,
            "a payment and its reversal name it: fixed from the start"
        );
        let refused = conn
            .execute(
                &format!(
                    "INSERT INTO payment_milestone (id, commitment_id, position, label, share_bp,
                                                    trigger, created_at)
                     VALUES ('00000000-0000-7000-8000-0000000000f1', '{paid}', 1, 'Advance',
                             3000, 'advance', 't')"
                ),
                [],
            )
            .unwrap_err();
        assert!(refused.to_string().contains("money: payment plan locked"));
        milestones::add_usual(conn, unpaid, ["Start", "Laid", "Closed"]).unwrap();
        let plan = db::work::snapshot(conn).unwrap();
        assert_eq!(
            plan.commitments[1]
                .milestones
                .iter()
                .map(|m| (m.share_bp, m.activity_id.as_deref()))
                .collect::<Vec<_>>(),
            vec![(3_000, None), (4_000, Some(tiling)), (3_000, None)]
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        assert_eq!(
            db::work::snapshot(&again.conn).unwrap().commitments[1]
                .milestones
                .len(),
            3
        );
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from D2: a work folder at schema 11 with
    /// documents — a diary photo linked to its entry, an answer's photo to its
    /// stage, a receipt to its payment, a permit PDF to the work and to a stage,
    /// and one attached to nothing — checks with answers, and a diary. Opened by
    /// D3, `document` is rebuilt under `foreign_keys = ON` for two more kinds:
    /// every document keeps its id and every column, every link is still there
    /// and still cascades, the index is back under its name, nothing of the
    /// rebuild is left behind, and there was no trigger on either table to lose.
    /// Every check reads "needs no photo", no care note exists yet, and the
    /// diary chain still verifies.
    #[test]
    fn a_work_folder_at_schema_eleven_with_documents_and_links_rebuilds_its_documents_and_keeps_every_row(
    ) {
        use crate::db::{check_answers, checks, diary, documents};
        use crate::files::intake::{self, Format};

        let scratch = Scratch::create();
        let folder_documents = scratch.path().join(intake::DOCUMENTS);
        std::fs::create_dir(&folder_documents).unwrap();
        let file = |bytes: Vec<u8>, format: Format| -> (String, i64) {
            let hash = intake::sha256_hex(&bytes);
            std::fs::write(
                folder_documents.join(format!("{hash}.{}", format.extension())),
                &bytes,
            )
            .unwrap();
            (hash, bytes.len() as i64)
        };
        let (photo, photo_bytes) = file(intake::tests::png(64, 48), Format::Png);
        let (inspection, inspection_bytes) = file(intake::tests::jpeg(40, 30), Format::Jpeg);
        let (permit, permit_bytes) = file(
            crate::commands::documents::tests::minimal_pdf(),
            Format::Pdf,
        );
        let (loose, loose_bytes) = file(intake::tests::png(8, 8), Format::Png);
        let stage = "00000000-0000-7000-8000-00000000000b";
        let documents_sql = "SELECT * FROM document ORDER BY id";
        let links_sql = "SELECT * FROM document_link ORDER BY document_id, target_kind, target_id";
        let triggers_sql = "SELECT name FROM sqlite_master WHERE type = 'trigger'
                            AND tbl_name IN ('document', 'document_link') ORDER BY name";

        let (documents_before, links_before, triggers_before, checks_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 11).unwrap();
            let work_id: String = conn
                .query_row("SELECT work_id FROM work", [], |r| r.get(0))
                .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-05".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Pipes in.".into()),
                    weather: None,
                    lost_day: false,
                    hours: None,
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: Vec::new(),
                    present: Vec::new(),
                    photos: vec![crate::contract::Photo {
                        file_hash: photo.clone(),
                        file_name: "pipes.png".into(),
                        bytes: photo_bytes,
                        width: 64,
                        height: 48,
                        thumbnail: false,
                    }],
                },
            )
            .unwrap();
            let check =
                checks::add(&conn, stage, checks::Gate::Close, "Pipes photographed?").unwrap();
            check_answers::append(
                &conn,
                &check_answers::NewAnswer {
                    check_id: check.clone(),
                    answer: "yes".into(),
                    reason: None,
                    photo_hash: Some(inspection.clone()),
                    author_name: "Synthetic inspector".into(),
                },
            )
            .unwrap();
            checks::add(&conn, stage, checks::Gate::Start, "Water off?").unwrap();
            let target = |kind: &str, id: &str| crate::contract::DocumentTarget {
                target_kind: kind.into(),
                target_id: id.into(),
            };
            let record =
                |hash: &str,
                 name: &str,
                 format: Format,
                 bytes: i64,
                 size,
                 kind,
                 target: Option<&crate::contract::DocumentTarget>| {
                    documents::record(
                        &conn,
                        &documents::NewDocument {
                            file_hash: hash,
                            file_name: name,
                            format,
                            bytes,
                            size,
                            kind,
                            added_on: "2026-10-05",
                            author_name: "Synthetic author",
                        },
                        target,
                    )
                    .unwrap()
                };
            record(
                &photo,
                "pipes.png",
                Format::Png,
                photo_bytes,
                Some((64, 48)),
                "photo",
                Some(&target("entry", "1")),
            );
            record(
                &inspection,
                "inspection.jpg",
                Format::Jpeg,
                inspection_bytes,
                Some((40, 30)),
                "photo",
                Some(&target("stage", stage)),
            );
            record(
                &permit,
                "permit.pdf",
                Format::Pdf,
                permit_bytes,
                None,
                "permit",
                Some(&target("work", &work_id)),
            );
            record(
                &permit,
                "permit.pdf",
                Format::Pdf,
                permit_bytes,
                None,
                "permit",
                Some(&target("stage", stage)),
            );
            record(
                &loose,
                "loose.png",
                Format::Png,
                loose_bytes,
                Some((8, 8)),
                "other",
                None,
            );

            documents_before = raw_rows(&conn, documents_sql);
            links_before = raw_rows(&conn, links_sql);
            triggers_before = raw_rows(&conn, triggers_sql);
            checks_before = raw_rows(
                &conn,
                "SELECT id, stage_id, gate, position, name, created_at FROM stage_check ORDER BY id",
            );
            diary_before = diary::list(&conn, None, None).unwrap();
            assert_eq!(documents_before.len(), 4);
            assert_eq!(links_before.len(), 4, "the permit is linked twice");
            assert_eq!(migrations::WORK.current_version(&conn), 11);
        }

        let state = open(scratch.path()).expect("a D2 work opens in D3");
        let conn = &state.conn;

        assert_eq!(migrations::WORK.current_version(conn), 12);
        assert_eq!(
            raw_rows(conn, documents_sql),
            documents_before,
            "every document, as it was"
        );
        assert_eq!(
            raw_rows(conn, links_sql),
            links_before,
            "every link, as it was"
        );
        assert_eq!(
            raw_rows(conn, triggers_sql),
            triggers_before,
            "no trigger, before or after"
        );
        assert!(triggers_before.is_empty());
        assert_eq!(
            raw_rows(
                conn,
                "SELECT id, stage_id, gate, position, name, created_at FROM stage_check ORDER BY id"
            ),
            checks_before
        );
        assert_eq!(
            raw_rows(conn, "SELECT DISTINCT needs_photo FROM stage_check"),
            vec!["Integer(0)"],
            "no check already in a file needs a photo"
        );
        assert_eq!(diary::list(conn, None, None).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!(
            (report.entries, report.intact),
            (1, true),
            "the chain still holds"
        );

        // The rebuild left nothing behind, and the index is back.
        assert_eq!(
            raw_rows(
                conn,
                "SELECT count(*) FROM sqlite_master WHERE name IN ('document_012', 'document_link_012')"
            ),
            vec!["Integer(0)"]
        );
        assert_eq!(
            raw_rows(
                conn,
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_document%'"
            ),
            vec!["Text(\"idx_document_link_target\")"]
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());
        assert_eq!(raw_rows(conn, "PRAGMA foreign_keys"), vec!["Integer(1)"]);
        assert_eq!(
            raw_rows(conn, "SELECT count(*) FROM care_note"),
            vec!["Integer(0)"]
        );

        let plan = db::work::snapshot(conn).unwrap();
        let permit_row = plan
            .documents
            .iter()
            .find(|d| d.file_hash == permit)
            .unwrap();
        assert_eq!(permit_row.links.len(), 2);
        assert!(plan.checks.iter().all(|c| !c.needs_photo));

        // The two new kinds are taken; a kind that is not one is still refused.
        for kind in ["warranty", "manual"] {
            db::documents::update(conn, &permit_row.id, None, Some(kind)).unwrap();
        }
        let refused = conn
            .execute(
                "UPDATE document SET kind = 'invoice' WHERE id = ?1",
                [&permit_row.id],
            )
            .unwrap_err();
        assert!(refused.to_string().contains("CHECK"), "{refused}");
        // A link to a document that is not there is refused; removing a
        // document still takes its links with it.
        let refused = conn
            .execute(
                "INSERT INTO document_link (document_id, target_kind, target_id)
                 VALUES ('00000000-0000-7000-8000-0000000000ff', 'work', 'x')",
                [],
            )
            .unwrap_err();
        assert!(refused.to_string().contains("FOREIGN KEY"), "{refused}");
        conn.execute("DELETE FROM document WHERE id = ?1", [&permit_row.id])
            .unwrap();
        assert_eq!(
            raw_rows(conn, links_sql).len(),
            2,
            "the cascade survived the rebuild"
        );
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![intake::DOCUMENTS, WORK_FILE]);
    }
}
