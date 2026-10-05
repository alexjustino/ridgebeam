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
                    lost_cause: None,
                    lost_party_person_id: None,
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
                    lost_cause: None,
                    lost_party_person_id: None,
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
                    lost_cause: None,
                    lost_party_person_id: None,
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
                    lost_cause: None,
                    lost_party_person_id: None,
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
                    lost_cause: None,
                    lost_party_person_id: None,
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

        let state = open(scratch.path()).expect("a D2 work opens in D3, and on to head");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
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
        // None before; after, only the one a later migration adds to
        // `document` (019: a document filed again as another kind lets go of
        // the warranty that named it).
        assert!(triggers_before.is_empty());
        assert_eq!(
            raw_rows(conn, triggers_sql),
            vec!["Text(\"document_kind_lets_go_of_warranty\")"],
            "no trigger lost by the rebuild, none added but 019's"
        );
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

    /// The upgrade a person makes from D4: a work folder at schema 12 with an
    /// approved plan — two activities, a link, a cost line, baseline 1 — a
    /// replanning open, a payment, a care note and a diary. Opened by E1, it
    /// gains `change_order` and `change_order_decision`, empty and guarded by
    /// their triggers; every row it held is as it was and the chain still
    /// verifies. A change raised on the migrated file and approved joins the
    /// open replanning, which keeps its reason, and the next baseline closes it.
    #[test]
    fn a_work_folder_at_schema_twelve_with_an_approved_plan_gains_change_orders_and_keeps_every_row(
    ) {
        use crate::contract::ChangeEffect;
        use crate::db::baselines::{self, Placement};
        use crate::db::change_orders::{self, AskedBy, NewChangeOrder, NewDecision, Outcome};
        use crate::db::dependencies::{self, End, Kind};
        use crate::db::payments::{self, NewPayment};
        use crate::db::{care_notes, diary, money, replanning};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let kept = [
            "SELECT * FROM stage ORDER BY id",
            "SELECT * FROM activity ORDER BY id",
            "SELECT * FROM dependency ORDER BY id",
            "SELECT * FROM cost_line ORDER BY id",
            "SELECT * FROM payment ORDER BY seq",
            "SELECT * FROM baseline ORDER BY number",
            "SELECT * FROM baseline_activity ORDER BY baseline_id, activity_id",
            "SELECT * FROM baseline_stage ORDER BY baseline_id, stage_id",
            "SELECT * FROM replanning ORDER BY id",
            "SELECT * FROM care_note ORDER BY id",
            "SELECT approved_at FROM work",
        ];

        let (rows_before, diary_before, grout);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 12).unwrap();
            grout = db::work::add_activity(&conn, bathroom, "Grout").unwrap();
            dependencies::add(
                &conn,
                &End {
                    kind: Kind::Activity,
                    id: tiling.into(),
                },
                &End {
                    kind: Kind::Activity,
                    id: grout.clone(),
                },
                0,
            )
            .unwrap();
            money::add_cost_line(&conn, bathroom, Some(tiling), "Tiles", Some(120_000)).unwrap();
            let placed = |id: &str, start: &str, finish: &str| Placement {
                activity_id: id.into(),
                start: Some(start.into()),
                finish: Some(finish.into()),
            };
            baselines::take(
                &conn,
                &[
                    placed(tiling, "2026-10-05", "2026-10-07"),
                    Placement {
                        activity_id: grout.clone(),
                        start: None,
                        finish: None,
                    },
                ],
                Some("2026-10-07"),
            )
            .unwrap();
            replanning::open(&conn, "Tiles arrive two weeks late", "Synthetic author").unwrap();
            payments::append(
                &conn,
                &NewPayment {
                    day: "2026-10-05".into(),
                    person_id: None,
                    stage_id: bathroom.into(),
                    commitment_id: None,
                    amount_cents: 30_000,
                    what_for: Some("Advance".into()),
                    receipt_hash: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            care_notes::add(&conn, "stage", bathroom, "Reseal the grout once a year.").unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
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

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::list(&conn, None, None).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 12);
        }

        let state = open(scratch.path()).expect("a D4 work opens in E1, and on to head");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every row, as it was"
        );
        assert_eq!(diary::list(conn, None, None).unwrap(), diary_before);
        assert!(diary::verify(conn).unwrap().intact, "the chain still holds");
        for table in ["change_order", "change_order_decision"] {
            assert_eq!(
                raw_rows(conn, &format!("SELECT count(*) FROM {table}")),
                vec!["Integer(0)"],
                "`{table}` is there, and empty"
            );
        }
        assert_eq!(
            raw_rows(
                conn,
                "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                 AND tbl_name IN ('change_order', 'change_order_decision')"
            ),
            vec!["Integer(9)"],
            "insert-only, numbered, after approval, matching its change"
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());
        let plan = db::work::snapshot(conn).unwrap();
        assert!(plan.change_orders.is_empty());
        assert_eq!(
            plan.replanning.as_ref().unwrap().reason,
            "Tiles arrive two weeks late"
        );

        // A change on the migrated file: raised, approved into the replanning
        // already open, and closed by the next baseline with that reason.
        change_orders::raise(
            conn,
            &NewChangeOrder {
                raised_on: "2026-10-07".into(),
                title: "Longer grout".into(),
                description: None,
                asked_by: AskedBy::Owner,
                stage_id: bathroom.into(),
                cost_cents: Some(5_000),
                effects: vec![ChangeEffect::Duration {
                    activity_id: grout.clone(),
                    duration_days: 2,
                }],
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        let id = db::work::snapshot(conn).unwrap().change_orders[0]
            .id
            .clone();
        change_orders::decide(
            conn,
            &NewDecision {
                change_order_id: id,
                outcome: Outcome::Approved,
                decided_on: "2026-10-08".into(),
                note: None,
                finish_before: None,
                finish_after: None,
                days_delta: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        let plan = db::work::snapshot(conn).unwrap();
        assert_eq!(
            plan.activities
                .iter()
                .find(|a| a.id == grout)
                .unwrap()
                .duration_days,
            Some(2)
        );
        assert!(plan.cost_lines.iter().any(|l| l.label == "Change order #1"));
        let rows: Vec<Placement> = plan
            .activities
            .iter()
            .map(|a| Placement {
                activity_id: a.id.clone(),
                start: None,
                finish: None,
            })
            .collect();
        assert_eq!(baselines::take(conn, &rows, None).unwrap(), 2);
        let plan = db::work::snapshot(conn).unwrap();
        assert_eq!(
            plan.baselines[1].reason.as_deref(),
            Some("Tiles arrive two weeks late")
        );
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        assert_eq!(
            db::work::snapshot(&again.conn).unwrap().change_orders.len(),
            1
        );
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from E1: a work folder at schema 13 with an
    /// approved plan, a payment and its reversal, a change order decided and a
    /// diary. Opened by E2, it gains `funding` and `funding_receipt`, empty and
    /// the ledger guarded by its triggers; every row it held is as it was and
    /// the chain still verifies. A fund and its receipt written on the
    /// migrated file are there when it opens again.
    #[test]
    fn a_work_folder_at_schema_thirteen_with_money_and_a_change_order_gains_funding_and_keeps_every_row(
    ) {
        use crate::db::baselines::{self, Placement};
        use crate::db::change_orders::{self, AskedBy, NewChangeOrder, NewDecision, Outcome};
        use crate::db::funding::{self, FundingFields, FUNDING_RECEIVED};
        use crate::db::funding_receipts::{self, NewReceipt};
        use crate::db::payments::{self, NewPayment};
        use crate::db::{diary, money};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let kept = [
            "SELECT * FROM stage ORDER BY id",
            "SELECT * FROM activity ORDER BY id",
            "SELECT * FROM cost_line ORDER BY id",
            "SELECT * FROM payment ORDER BY seq",
            "SELECT * FROM baseline ORDER BY number",
            "SELECT * FROM baseline_activity ORDER BY baseline_id, activity_id",
            "SELECT * FROM change_order ORDER BY number",
            "SELECT * FROM change_order_decision ORDER BY change_order_id",
            "SELECT approved_at FROM work",
        ];

        let (rows_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 13).unwrap();
            money::add_cost_line(&conn, bathroom, Some(tiling), "Tiles", Some(120_000)).unwrap();
            baselines::take(
                &conn,
                &[Placement {
                    activity_id: tiling.into(),
                    start: Some("2026-10-05".into()),
                    finish: Some("2026-10-07".into()),
                }],
                Some("2026-10-07"),
            )
            .unwrap();
            let paid = payments::append(
                &conn,
                &NewPayment {
                    day: "2026-10-05".into(),
                    person_id: None,
                    stage_id: bathroom.into(),
                    commitment_id: None,
                    amount_cents: 30_000,
                    what_for: Some("Advance".into()),
                    receipt_hash: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            payments::reverse(&conn, paid, "Paid twice.", "2026-10-06", "Synthetic author")
                .unwrap();
            change_orders::raise(
                &conn,
                &NewChangeOrder {
                    raised_on: "2026-10-07".into(),
                    title: "Heated floor".into(),
                    description: None,
                    asked_by: AskedBy::Owner,
                    stage_id: bathroom.into(),
                    cost_cents: Some(250_000),
                    effects: Vec::new(),
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            // This build's snapshot reads E2's tables, which a file at schema
            // 13 does not have yet: the id is read raw.
            let id: String = conn
                .query_row("SELECT id FROM change_order", [], |row| row.get(0))
                .unwrap();
            change_orders::decide(
                &conn,
                &NewDecision {
                    change_order_id: id,
                    outcome: Outcome::Declined,
                    decided_on: "2026-10-08".into(),
                    note: Some("Not in this budget.".into()),
                    finish_before: None,
                    finish_after: None,
                    days_delta: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
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

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::list(&conn, None, None).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 13);
        }

        let state = open(scratch.path()).expect("an E1 work opens in E2, and on to head");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every row, as it was"
        );
        assert_eq!(diary::list(conn, None, None).unwrap(), diary_before);
        assert!(diary::verify(conn).unwrap().intact, "the chain still holds");
        for table in ["funding", "funding_receipt"] {
            assert_eq!(
                raw_rows(conn, &format!("SELECT count(*) FROM {table}")),
                vec!["Integer(0)"],
                "`{table}` is there, and empty"
            );
        }
        assert_eq!(
            raw_rows(
                conn,
                "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                 AND tbl_name = 'funding_receipt'"
            ),
            vec!["Integer(5)"],
            "append-only, continuing, its reversals checked"
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());
        let plan = db::work::snapshot(conn).unwrap();
        assert!(plan.funding.is_empty() && plan.funding_receipts.is_empty());
        assert_eq!(plan.payments.len(), 2);

        // A fund and its receipt on the migrated file — the plan approved, and
        // no replanning needed.
        let savings = funding::add(
            conn,
            &FundingFields {
                label: "Savings".into(),
                source: None,
                amount_cents: 500_000,
                expected_on: "2026-10-01".into(),
                note: None,
            },
        )
        .unwrap();
        funding_receipts::append(
            conn,
            &NewReceipt {
                day: "2026-10-02".into(),
                funding_id: Some(savings.clone()),
                amount_cents: 500_000,
                note: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        assert_eq!(
            funding::remove(conn, &savings).unwrap_err().to_string(),
            FUNDING_RECEIVED
        );
        assert!(
            conn.execute("DELETE FROM funding_receipt", []).is_err(),
            "the ledger is guarded on the migrated file"
        );
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        let plan = db::work::snapshot(&again.conn).unwrap();
        assert_eq!((plan.funding.len(), plan.funding_receipts.len()), (1, 1));
        assert_eq!(plan.change_orders.len(), 1);
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from E2: a work folder at schema 14 with a
    /// diary — an entry with a done line, a person present and two photos, a
    /// lost day (which could not say why yet), a correction re-attaching a
    /// photo, and a plain entry. Opened by E3, `diary_entry` gains `lost_cause`
    /// and `lost_party_person_id` by a plain ADD COLUMN: every row of the four
    /// diary tables is as it was, byte for byte; every stored hash is the hash
    /// recomputed under E3's canonical form; the chain verifies; the triggers
    /// are the same triggers, and they guard the new columns. An entry with a
    /// cause written on the migrated file continues the chain and verifies, and
    /// is there when the work opens again.
    #[test]
    fn a_work_folder_at_schema_fourteen_with_a_diary_gains_lost_causes_and_every_hash_is_unchanged()
    {
        use crate::contract::{DoneLine, Photo};
        use crate::db::diary;

        let scratch = Scratch::create();
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let photo = |hash: &str, name: &str| Photo {
            file_hash: hash.into(),
            file_name: name.into(),
            bytes: 2048,
            width: 640,
            height: 480,
            thumbnail: true,
        };
        let entry = |day: &str| diary::NewEntry {
            day: day.into(),
            kind: "entry".into(),
            corrects_seq: None,
            note: None,
            weather: None,
            lost_day: false,
            lost_cause: None,
            lost_party_person_id: None,
            hours: None,
            deliveries: None,
            incidents: None,
            visitors: None,
            author_name: "Synthetic author".into(),
            done: Vec::new(),
            present: Vec::new(),
            photos: Vec::new(),
        };
        // The columns a schema-14 diary has — read the same way after 15.
        let kept = [
            "SELECT seq, day, kind, corrects_seq, note, weather, lost_day, hours, deliveries,
                    incidents, visitors, author_name, created_at, prev_hash, hash
             FROM diary_entry ORDER BY seq",
            "SELECT * FROM diary_done ORDER BY entry_seq, activity_id",
            "SELECT * FROM diary_present ORDER BY entry_seq, person_id",
            "SELECT * FROM diary_photo ORDER BY entry_seq, position",
            "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'index')
               AND tbl_name LIKE 'diary%' ORDER BY name",
        ];

        let (rows_before, diary_before, person);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 14).unwrap();
            person = db::work::add_person(&conn, "A. Tiler").unwrap();
            let (wall, floor) = ("a1".repeat(32), "b2".repeat(32));

            diary::append(
                &conn,
                &diary::NewEntry {
                    note: Some("Tiles laid in the shower.".into()),
                    weather: Some("sun".into()),
                    hours: Some(7.5),
                    done: vec![DoneLine {
                        activity_id: tiling.into(),
                        state: "worked".into(),
                        quantity: Some(6.0),
                        note: Some("North wall.".into()),
                    }],
                    present: vec![person.clone()],
                    photos: vec![photo(&wall, "wall.png"), photo(&floor, "floor.jpg")],
                    ..entry("2026-10-05")
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    weather: Some("rain".into()),
                    lost_day: true,
                    note: Some("Rained all day.".into()),
                    ..entry("2026-10-06")
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    kind: "correction".into(),
                    corrects_seq: Some(1),
                    note: Some("It was five square metres.".into()),
                    photos: vec![photo(&wall, "wall.png")],
                    ..entry("2026-10-05")
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    deliveries: Some("Grout, 4 bags".into()),
                    ..entry("2026-10-07")
                },
            )
            .unwrap();

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::all(&conn).unwrap();
            assert!(diary::verify(&conn).unwrap().intact);
            assert_eq!(migrations::WORK.current_version(&conn), 14);
        }

        let state = open(scratch.path()).expect("an E2 work opens in E3");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every diary row, every trigger and index, as it was"
        );
        let diary_after = diary::all(conn).unwrap();
        assert_eq!(diary_after, diary_before);
        assert_eq!(diary_after.len(), 4);
        for entry in &diary_after {
            assert_eq!(
                diary::hash_of(entry),
                entry.hash,
                "#{}: its hash, recomputed under E3's canonical form, is the one written",
                entry.seq
            );
            assert_eq!(
                (&entry.lost_cause, &entry.lost_party_person_id),
                (&None, &None)
            );
        }
        let report = diary::verify(conn).unwrap();
        assert_eq!((report.entries, report.intact), (4, true));
        assert_eq!(
            raw_rows(
                conn,
                "SELECT name FROM pragma_table_info('diary_entry')
                 WHERE name IN ('lost_cause', 'lost_party_person_id') ORDER BY cid"
            ),
            vec!["Text(\"lost_cause\")", "Text(\"lost_party_person_id\")"]
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());

        // On the migrated file: an entry with a cause continues the chain, and
        // the old triggers guard the new columns.
        let seq = diary::append(
            conn,
            &diary::NewEntry {
                lost_day: true,
                lost_cause: Some("absence".into()),
                lost_party_person_id: Some(person.clone()),
                note: Some("The tiler did not come.".into()),
                ..entry("2026-10-08")
            },
        )
        .unwrap();
        assert_eq!(seq, 5);
        assert!(diary::verify(conn).unwrap().intact);
        for attack in [
            "UPDATE diary_entry SET lost_cause = 'weather' WHERE seq = 5",
            "UPDATE diary_entry SET lost_party_person_id = NULL WHERE seq = 5",
        ] {
            assert!(
                conn.execute(attack, [])
                    .unwrap_err()
                    .to_string()
                    .contains("diary: append-only"),
                "{attack}"
            );
        }
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        let lost = diary::get(&again.conn, 5).unwrap().unwrap();
        assert_eq!(
            (
                lost.lost_cause.as_deref(),
                lost.lost_party_person_id.as_deref()
            ),
            (Some("absence"), Some(person.as_str()))
        );
        assert_eq!(diary::all(&again.conn).unwrap()[..4], diary_before[..]);
        let report = diary::verify(&again.conn).unwrap();
        assert_eq!((report.entries, report.intact), (5, true));
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from E3: a work folder at schema 15 with
    /// money — two commitments with payment plans, one paid against (its plan
    /// fixed) and one not — a closed stage, documents and a diary. Opened by
    /// E4, `payment_milestone` is rebuilt for the `retention` trigger: every
    /// milestone keeps its id and every column, the index and the seven
    /// triggers of migration 011 are back word for word, nothing of the
    /// rebuild is left behind, and the paid plan is still fixed. `snag` and
    /// `snag_closure` are there, empty and guarded. A retention milestone and
    /// a snag fixed with its photo are written on the migrated file, the
    /// chain verifies, and they are there when it opens again.
    #[test]
    fn a_work_folder_at_schema_fifteen_with_payment_plans_rebuilds_them_for_retention_and_keeps_every_row(
    ) {
        use crate::db::{diary, milestones, snags};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let tiler = "00000000-0000-7000-8000-00000000000a";
        let paid = "00000000-0000-7000-8000-0000000000d1";
        let unpaid = "00000000-0000-7000-8000-0000000000d2";
        let (crack, mended) = ("a1".repeat(32), "b2".repeat(32));
        let kept = [
            "SELECT * FROM payment_milestone ORDER BY id",
            "SELECT * FROM commitment ORDER BY id",
            "SELECT * FROM payment ORDER BY seq",
            "SELECT * FROM stage ORDER BY id",
            "SELECT * FROM activity ORDER BY id",
            "SELECT * FROM document ORDER BY id",
            "SELECT * FROM document_link ORDER BY document_id, target_kind, target_id",
            "SELECT * FROM person ORDER BY id",
            "SELECT * FROM diary_entry ORDER BY seq",
            "SELECT * FROM diary_done ORDER BY entry_seq, activity_id",
            "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'index')
               AND tbl_name = 'payment_milestone' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ];

        let (rows_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 15).unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO commitment (id, stage_id, person_id, label, amount_cents, agreed_on,
                                         created_at)
                 VALUES ('{paid}', '{bathroom}', '{tiler}', 'Tiler''s quote', 1000000,
                         '2026-10-01', '2026-10-01T09:00:00.000Z'),
                        ('{unpaid}', '{bathroom}', NULL, 'Plumber''s quote', 500000,
                         '2026-10-02', '2026-10-02T09:00:00.000Z');
                 INSERT INTO payment_milestone (id, commitment_id, position, label, share_bp,
                                                trigger, activity_id, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000f1', '{paid}', 1, 'Advance', 3000,
                         'advance', NULL, '2026-10-01T09:01:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000f2', '{paid}', 2, 'Tiles laid', 4000,
                         'activity_finished', '{tiling}', '2026-10-01T09:02:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000f3', '{paid}', 3, 'Handover', 3000,
                         'stage_closed', NULL, '2026-10-01T09:03:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000f4', '{unpaid}', 1, 'Start', 3000,
                         'stage_started', NULL, '2026-10-02T09:01:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000f5', '{unpaid}', 2, 'Pipes in', 4000,
                         'activity_finished', '{tiling}', '2026-10-02T09:02:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000f6', '{unpaid}', 3, 'Closed', 2500,
                         'stage_closed', NULL, '2026-10-02T09:03:00.000Z');
                 INSERT INTO payment (id, seq, day, person_id, stage_id, commitment_id,
                                      amount_cents, what_for, author_name, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000e1', 1, '2026-10-03', '{tiler}',
                         '{bathroom}', '{paid}', 300000, 'Advance', 'Synthetic author',
                         '2026-10-03T09:00:00.000Z');
                 INSERT INTO document (id, file_hash, file_name, media_type, bytes, width,
                                       height, kind, title, added_on, author_name, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000c1', '{crack}', 'crack.jpg',
                         'image/jpeg', 2048, 640, 480, 'photo', 'The crack', '2026-10-06',
                         'Synthetic author', '2026-10-06T09:00:00.000Z'),
                        ('00000000-0000-7000-8000-0000000000c2', '{mended}', 'mended.png',
                         'image/png', 1024, 320, 240, 'photo', 'Mended', '2026-10-08',
                         'Synthetic author', '2026-10-08T09:00:00.000Z');
                 INSERT INTO document_link (document_id, target_kind, target_id)
                 VALUES ('00000000-0000-7000-8000-0000000000c1', 'stage', '{bathroom}');"
            ))
            .expect("an E3 work's payment plans and documents");
            db::checks::start(&conn, bathroom).unwrap();
            db::checks::close(&conn, bathroom).unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
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

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::all(&conn).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 15);
            assert_eq!(
                raw_rows(
                    &conn,
                    "SELECT count(*) FROM sqlite_master WHERE name IN ('snag', 'snag_closure')"
                ),
                vec!["Integer(0)"]
            );
        }

        let state = open(scratch.path()).expect("an E3 work opens in E4");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every row as it was; the index and the triggers word for word"
        );
        assert_eq!(rows_before[0].len(), 6, "six milestones");
        assert_eq!(rows_before[10].len(), 8, "an index and seven triggers");
        assert_eq!(diary::all(conn).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!((report.entries, report.intact), (1, true));
        assert!(
            raw_rows(
                conn,
                "SELECT sql FROM sqlite_master WHERE name = 'payment_milestone'"
            )[0]
            .contains("'retention'"),
            "the trigger rule is widened"
        );
        assert_eq!(
            raw_rows(
                conn,
                "SELECT count(*) FROM sqlite_master WHERE name LIKE '%016%'
                 OR sql LIKE '%payment_milestone_016%'"
            ),
            vec!["Integer(0)"],
            "nothing of the rebuild is left behind"
        );
        for table in ["snag", "snag_closure"] {
            assert_eq!(
                raw_rows(conn, &format!("SELECT count(*) FROM {table}")),
                vec!["Integer(0)"],
                "`{table}` is there, and empty"
            );
            assert_eq!(
                raw_rows(
                    conn,
                    &format!(
                        "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                         AND tbl_name = '{table}'"
                    )
                ),
                vec!["Integer(4)"],
                "`{table}` is insert-only"
            );
        }
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());

        // The paid plan is still fixed, by the host and by the schema.
        let retention = milestones::MilestoneFields {
            label: "Retention".into(),
            share_bp: 500,
            trigger: "retention".into(),
            activity_id: None,
        };
        assert_eq!(
            milestones::add(conn, paid, &retention)
                .unwrap_err()
                .to_string(),
            milestones::PLAN_LOCKED
        );
        for attack in [
            "DELETE FROM payment_milestone WHERE id = '00000000-0000-7000-8000-0000000000f3'",
            "UPDATE payment_milestone SET trigger = 'retention'
             WHERE id = '00000000-0000-7000-8000-0000000000f3'",
        ] {
            assert!(
                conn.execute(attack, [])
                    .unwrap_err()
                    .to_string()
                    .contains("money: payment plan locked"),
                "{attack}"
            );
        }
        // The unpaid one takes its last 5 % as retention; a snag on the closed
        // stage is raised and fixed with its photo.
        milestones::add(conn, unpaid, &retention).unwrap();
        snags::raise(
            conn,
            &snags::NewSnag {
                raised_on: "2026-10-06".into(),
                title: "Cracked tile by the drain".into(),
                description: None,
                stage_id: bathroom.into(),
                activity_id: Some(tiling.into()),
                person_id: Some(tiler.into()),
                due_on: Some("2026-10-08".into()),
                photo_hash: Some(crack.clone()),
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        let id = db::work::snapshot(conn).unwrap().snags[0].id.clone();
        snags::close(
            conn,
            &snags::NewClosure {
                snag_id: id,
                outcome: snags::Outcome::Fixed,
                closed_on: "2026-10-08".into(),
                photo_hash: Some(mended.clone()),
                note: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        assert!(conn.execute("DELETE FROM snag", []).is_err(), "guarded");
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        let plan = db::work::snapshot(&again.conn).unwrap();
        assert_eq!(
            plan.commitments
                .iter()
                .map(|c| (c.id.as_str(), c.locked, c.milestones.len()))
                .collect::<Vec<_>>(),
            vec![(paid, true, 3), (unpaid, false, 4)]
        );
        let last = plan.commitments[1].milestones.last().unwrap();
        assert_eq!(
            (last.position, last.trigger.as_str(), last.share_bp),
            (4, "retention", 500)
        );
        assert_eq!(plan.snags.len(), 1);
        assert_eq!(
            plan.snags[0]
                .closure
                .as_ref()
                .unwrap()
                .photo_hash
                .as_deref(),
            Some(mended.as_str())
        );
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from E4: a work folder at schema 16 with an
    /// approved plan, a change order, two snags — one withdrawn — and a diary.
    /// Opened by G1, the five meeting tables are there, empty and guarded, and
    /// every row is as it was. Minutes with an attendee and an action on a
    /// person are written on the migrated file, the action is closed between
    /// meetings, the chain verifies, and they are there when it opens again.
    #[test]
    fn a_work_folder_at_schema_sixteen_with_snags_and_a_change_order_gains_meetings_and_keeps_every_row(
    ) {
        use crate::db::baselines::{self, Placement};
        use crate::db::change_orders::{self, AskedBy, NewChangeOrder};
        use crate::db::meetings::{self, Attendee, NewAction, NewActionClosure, NewMinutes};
        use crate::db::{diary, snags};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let tiler = "00000000-0000-7000-8000-00000000000a";
        let kept = [
            "SELECT * FROM stage ORDER BY id",
            "SELECT * FROM activity ORDER BY id",
            "SELECT * FROM person ORDER BY id",
            "SELECT * FROM baseline ORDER BY number",
            "SELECT * FROM baseline_activity ORDER BY baseline_id, activity_id",
            "SELECT * FROM change_order ORDER BY number",
            "SELECT * FROM snag ORDER BY number",
            "SELECT * FROM snag_closure ORDER BY snag_id",
            "SELECT * FROM diary_entry ORDER BY seq",
            "SELECT * FROM diary_done ORDER BY entry_seq, activity_id",
            "SELECT approved_at FROM work",
        ];
        let snag = |title: &str| snags::NewSnag {
            raised_on: "2026-10-06".into(),
            title: title.into(),
            description: None,
            stage_id: bathroom.into(),
            activity_id: Some(tiling.into()),
            person_id: Some(tiler.into()),
            due_on: Some("2026-10-08".into()),
            photo_hash: None,
            author_name: "Synthetic author".into(),
        };

        let (rows_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 16).unwrap();
            baselines::take(
                &conn,
                &[Placement {
                    activity_id: tiling.into(),
                    start: Some("2026-10-05".into()),
                    finish: Some("2026-10-07".into()),
                }],
                Some("2026-10-07"),
            )
            .unwrap();
            change_orders::raise(
                &conn,
                &NewChangeOrder {
                    raised_on: "2026-10-07".into(),
                    title: "Heated floor".into(),
                    description: None,
                    asked_by: AskedBy::Owner,
                    stage_id: bathroom.into(),
                    cost_cents: Some(250_000),
                    effects: Vec::new(),
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            snags::raise(&conn, &snag("Cracked tile by the drain")).unwrap();
            snags::raise(&conn, &snag("Grout missing")).unwrap();
            // This build's snapshot reads G1's tables, which a file at schema
            // 16 does not have yet: the id is read raw.
            let second: String = conn
                .query_row("SELECT id FROM snag WHERE number = 2", [], |row| row.get(0))
                .unwrap();
            snags::close(
                &conn,
                &snags::NewClosure {
                    snag_id: second,
                    outcome: snags::Outcome::Withdrawn,
                    closed_on: "2026-10-07".into(),
                    photo_hash: None,
                    note: Some("Raised by mistake.".into()),
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid; one cracked.".into()),
                    weather: None,
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
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

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::all(&conn).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 16);
            assert_eq!(
                raw_rows(
                    &conn,
                    "SELECT count(*) FROM sqlite_master WHERE name LIKE 'meeting%'"
                ),
                vec!["Integer(0)"]
            );
        }

        let state = open(scratch.path()).expect("an E4 work opens in G1");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every row as it was"
        );
        assert_eq!(rows_before[6].len(), 2, "two snags");
        assert_eq!(rows_before[7].len(), 1, "one closed");
        assert_eq!(rows_before[5].len(), 1, "a change order");
        assert_eq!(diary::all(conn).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!((report.entries, report.intact), (1, true));
        for (table, triggers) in [
            ("meeting", 4),
            ("meeting_attendee", 5),
            ("meeting_item", 4),
            ("meeting_action", 5),
            ("meeting_action_closure", 4),
        ] {
            assert_eq!(
                raw_rows(conn, &format!("SELECT count(*) FROM {table}")),
                vec!["Integer(0)"],
                "`{table}` is there, and empty"
            );
            assert_eq!(
                raw_rows(
                    conn,
                    &format!(
                        "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                         AND tbl_name = '{table}'"
                    )
                ),
                vec![format!("Integer({triggers})")],
                "`{table}` is insert-only"
            );
        }
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());

        // Minutes on the migrated file: the tiler there, an action on the
        // tiler, closed between meetings.
        meetings::record(
            conn,
            &NewMinutes {
                held_on: "2026-10-08".into(),
                notes: None,
                attendees: vec![
                    Attendee::Person(tiler.into()),
                    Attendee::Named("The neighbour".into()),
                ],
                items: vec![meetings::NewItem {
                    kind: "snag".into(),
                    ref_id: None,
                    title: "Snag #1 — Cracked tile by the drain".into(),
                    note: Some("A new tile is coming.".into()),
                    outcome: None,
                }],
                actions: vec![NewAction {
                    text: "Replace the cracked tile".into(),
                    on: Some(Attendee::Person(tiler.into())),
                    due_on: Some("2026-10-09".into()),
                }],
                closures: Vec::new(),
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        let action = db::work::snapshot(conn).unwrap().meetings[0].actions[0]
            .id
            .clone();
        meetings::close_action(
            conn,
            &NewActionClosure {
                action_id: action,
                outcome: meetings::Outcome::Done,
                closed_on: "2026-10-09".into(),
                note: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        assert!(conn.execute("DELETE FROM meeting", []).is_err(), "guarded");
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        let plan = db::work::snapshot(&again.conn).unwrap();
        assert_eq!(plan.meetings.len(), 1);
        assert_eq!(plan.meetings[0].attendees.len(), 2);
        assert_eq!(
            plan.meetings[0].actions[0]
                .closure
                .as_ref()
                .map(|c| (c.outcome.as_str(), c.meeting_id.clone())),
            Some(("done", None))
        );
        assert_eq!(plan.snags.len(), 2);
        assert_eq!(plan.change_orders.len(), 1);
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from G1: a work folder at schema 17 with an
    /// approved plan, a fund and its receipt, a snag, the minutes of a meeting
    /// with an action closed between meetings, and a diary. Opened by G2, the
    /// two purchase tables are there, empty and guarded, and every row is as
    /// it was. A purchase is added on the migrated file, ordered and
    /// delivered, the chain verifies, and it is there when it opens again.
    #[test]
    fn a_work_folder_at_schema_seventeen_with_minutes_and_funding_gains_purchases_and_keeps_every_row(
    ) {
        use crate::db::baselines::{self, Placement};
        use crate::db::funding::{self, FundingFields};
        use crate::db::funding_receipts::{self, NewReceipt};
        use crate::db::meetings::{self, Attendee, NewAction, NewActionClosure, NewMinutes};
        use crate::db::purchase_events::{self, Kind, NewEvent};
        use crate::db::purchases::{self, PurchaseFields};
        use crate::db::{diary, snags};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let tiler = "00000000-0000-7000-8000-00000000000a";
        let kept = [
            "SELECT * FROM stage ORDER BY id",
            "SELECT * FROM activity ORDER BY id",
            "SELECT * FROM person ORDER BY id",
            "SELECT * FROM baseline ORDER BY number",
            "SELECT * FROM baseline_activity ORDER BY baseline_id, activity_id",
            "SELECT * FROM funding ORDER BY position",
            "SELECT * FROM funding_receipt ORDER BY seq",
            "SELECT * FROM snag ORDER BY number",
            "SELECT * FROM meeting ORDER BY number",
            "SELECT * FROM meeting_attendee ORDER BY meeting_id, position",
            "SELECT * FROM meeting_item ORDER BY meeting_id, position",
            "SELECT * FROM meeting_action ORDER BY meeting_id, position",
            "SELECT * FROM meeting_action_closure ORDER BY action_id",
            "SELECT * FROM diary_entry ORDER BY seq",
            "SELECT * FROM diary_done ORDER BY entry_seq, activity_id",
            "SELECT approved_at FROM work",
        ];

        let (rows_before, diary_before);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 17).unwrap();
            baselines::take(
                &conn,
                &[Placement {
                    activity_id: tiling.into(),
                    start: Some("2026-10-05".into()),
                    finish: Some("2026-10-07".into()),
                }],
                Some("2026-10-07"),
            )
            .unwrap();
            let savings = funding::add(
                &conn,
                &FundingFields {
                    label: "Savings".into(),
                    source: None,
                    amount_cents: 500_000,
                    expected_on: "2026-10-01".into(),
                    note: None,
                },
            )
            .unwrap();
            funding_receipts::append(
                &conn,
                &NewReceipt {
                    day: "2026-10-02".into(),
                    funding_id: Some(savings),
                    amount_cents: 500_000,
                    note: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            snags::raise(
                &conn,
                &snags::NewSnag {
                    raised_on: "2026-10-06".into(),
                    title: "Cracked tile by the drain".into(),
                    description: None,
                    stage_id: bathroom.into(),
                    activity_id: Some(tiling.into()),
                    person_id: Some(tiler.into()),
                    due_on: None,
                    photo_hash: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            meetings::record(
                &conn,
                &NewMinutes {
                    held_on: "2026-10-07".into(),
                    notes: None,
                    attendees: vec![Attendee::Person(tiler.into())],
                    items: vec![meetings::NewItem {
                        kind: "snag".into(),
                        ref_id: None,
                        title: "Snag #1 — Cracked tile by the drain".into(),
                        note: None,
                        outcome: None,
                    }],
                    actions: vec![NewAction {
                        text: "Replace the cracked tile".into(),
                        on: Some(Attendee::Person(tiler.into())),
                        due_on: Some("2026-10-09".into()),
                    }],
                    closures: Vec::new(),
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            // This build's snapshot reads G2's tables, which a file at schema
            // 17 does not have yet: the id is read raw.
            let action: String = conn
                .query_row("SELECT id FROM meeting_action", [], |row| row.get(0))
                .unwrap();
            meetings::close_action(
                &conn,
                &NewActionClosure {
                    action_id: action,
                    outcome: meetings::Outcome::Done,
                    closed_on: "2026-10-08".into(),
                    note: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid; one cracked.".into()),
                    weather: None,
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
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

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::all(&conn).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 17);
            assert_eq!(
                raw_rows(
                    &conn,
                    "SELECT count(*) FROM sqlite_master WHERE name LIKE 'purchase%'"
                ),
                vec!["Integer(0)"]
            );
        }

        let state = open(scratch.path()).expect("a G1 work opens in G2");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every row as it was"
        );
        assert_eq!(rows_before[6].len(), 1, "a receipt");
        assert_eq!(rows_before[8].len(), 1, "a meeting");
        assert_eq!(rows_before[12].len(), 1, "an action closed");
        assert_eq!(diary::all(conn).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!((report.entries, report.intact), (1, true));
        for (table, triggers) in [("purchase", 3), ("purchase_event", 5)] {
            assert_eq!(
                raw_rows(conn, &format!("SELECT count(*) FROM {table}")),
                vec!["Integer(0)"],
                "`{table}` is there, and empty"
            );
            assert_eq!(
                raw_rows(
                    conn,
                    &format!(
                        "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                         AND tbl_name = '{table}'"
                    )
                ),
                vec![format!("Integer({triggers})")],
                "`{table}` is guarded"
            );
        }
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());

        // A purchase on the migrated file, ordered and delivered.
        let worktop = purchases::add(
            conn,
            &PurchaseFields {
                stage_id: bathroom.into(),
                activity_id: Some(tiling.into()),
                name: "Replacement tile".into(),
                quantity: Some("1 box".into()),
                supplier: None,
                lead_days: 7,
                note: None,
            },
        )
        .unwrap();
        for (kind, day) in [
            (Kind::Ordered, "2026-10-08"),
            (Kind::Delivered, "2026-10-09"),
        ] {
            purchase_events::append(
                conn,
                &NewEvent {
                    purchase_id: worktop.clone(),
                    kind,
                    day: day.into(),
                    note: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
        }
        assert!(
            conn.execute("DELETE FROM purchase_event", []).is_err(),
            "guarded"
        );
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        let plan = db::work::snapshot(&again.conn).unwrap();
        assert_eq!(plan.purchases.len(), 1);
        assert_eq!(
            plan.purchases[0]
                .events
                .iter()
                .map(|e| e.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["ordered", "delivered"]
        );
        assert_eq!(plan.meetings.len(), 1);
        assert_eq!(plan.funding_receipts.len(), 1);
        assert_eq!(plan.snags.len(), 1);
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }

    /// The upgrade a person makes from G3: a work folder at schema 18 with an
    /// approved plan, a room with a care note, a document filed as a warranty,
    /// a purchase ordered and a diary. Opened by G4, the three aftercare tables
    /// are there, empty and guarded, and every row is as it was. A warranty
    /// naming the filed paper and a task done are added on the migrated file,
    /// the chain verifies, and they are there when it opens again.
    #[test]
    fn a_work_folder_at_schema_eighteen_with_purchases_and_documents_gains_aftercare_and_keeps_every_row(
    ) {
        use crate::db::baselines::{self, Placement};
        use crate::db::maintenance::{self, TaskFields};
        use crate::db::maintenance_done::{self, NewDone};
        use crate::db::purchase_events::{self, Kind, NewEvent};
        use crate::db::purchases::{self, PurchaseFields};
        use crate::db::warranties::{self, WarrantyFields};
        use crate::db::{care_notes, diary, documents, rooms};
        use crate::files::intake::{self, Format};

        let scratch = Scratch::create();
        let bathroom = "00000000-0000-7000-8000-00000000000b";
        let tiling = "00000000-0000-7000-8000-00000000000c";
        let folder_documents = scratch.path().join(intake::DOCUMENTS);
        std::fs::create_dir(&folder_documents).unwrap();
        let pdf = crate::commands::documents::tests::minimal_pdf();
        let hash = intake::sha256_hex(&pdf);
        std::fs::write(folder_documents.join(format!("{hash}.pdf")), &pdf).unwrap();
        let kept = [
            "SELECT * FROM stage ORDER BY id",
            "SELECT * FROM activity ORDER BY id",
            "SELECT * FROM room ORDER BY id",
            "SELECT * FROM care_note ORDER BY id",
            "SELECT * FROM document ORDER BY id",
            "SELECT * FROM document_link ORDER BY document_id, target_kind, target_id",
            "SELECT * FROM baseline ORDER BY number",
            "SELECT * FROM purchase ORDER BY position",
            "SELECT * FROM purchase_event ORDER BY purchase_id, seq",
            "SELECT * FROM diary_entry ORDER BY seq",
            "SELECT * FROM diary_done ORDER BY entry_seq, activity_id",
            "SELECT approved_at FROM work",
        ];

        let (rows_before, diary_before, room, paper);
        {
            let conn = Connection::open(scratch.path().join(WORK_FILE)).unwrap();
            db::configure(&conn).unwrap();
            db::work::tests::a_work_at_schema_one(&conn);
            migrations::WORK.apply_up_to(&conn, 18).unwrap();
            baselines::take(
                &conn,
                &[Placement {
                    activity_id: tiling.into(),
                    start: Some("2026-10-05".into()),
                    finish: Some("2026-10-07".into()),
                }],
                Some("2026-10-07"),
            )
            .unwrap();
            room = rooms::add_room(&conn, "Bathroom").unwrap();
            care_notes::add(&conn, "room", &room, "Reseal the grout once a year").unwrap();
            paper = documents::record(
                &conn,
                &documents::NewDocument {
                    file_hash: &hash,
                    file_name: "valve-warranty.pdf",
                    format: Format::Pdf,
                    bytes: pdf.len() as i64,
                    size: None,
                    kind: "warranty",
                    added_on: "2026-10-07",
                    author_name: "Synthetic author",
                },
                None,
            )
            .unwrap();
            let tiles = purchases::add(
                &conn,
                &PurchaseFields {
                    stage_id: bathroom.into(),
                    activity_id: Some(tiling.into()),
                    name: "Wall tiles".into(),
                    quantity: Some("12 m²".into()),
                    supplier: None,
                    lead_days: 14,
                    note: None,
                },
            )
            .unwrap();
            purchase_events::append(
                &conn,
                &NewEvent {
                    purchase_id: tiles,
                    kind: Kind::Ordered,
                    day: "2026-10-01".into(),
                    note: None,
                    author_name: "Synthetic author".into(),
                },
            )
            .unwrap();
            diary::append(
                &conn,
                &diary::NewEntry {
                    day: "2026-10-06".into(),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some("Tiles laid.".into()),
                    weather: None,
                    lost_day: false,
                    lost_cause: None,
                    lost_party_person_id: None,
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

            rows_before = kept.map(|sql| raw_rows(&conn, sql));
            diary_before = diary::all(&conn).unwrap();
            assert_eq!(migrations::WORK.current_version(&conn), 18);
            assert_eq!(
                raw_rows(
                    &conn,
                    "SELECT count(*) FROM sqlite_master
                     WHERE name IN ('warranty', 'maintenance_task', 'maintenance_done')"
                ),
                vec!["Integer(0)"]
            );
        }

        let state = open(scratch.path()).expect("a G3 work opens in G4");
        let conn = &state.conn;

        assert_eq!(
            migrations::WORK.current_version(conn),
            migrations::WORK.target_version()
        );
        assert_eq!(
            kept.map(|sql| raw_rows(conn, sql)),
            rows_before,
            "every row as it was"
        );
        assert_eq!(rows_before[3].len(), 1, "a care note");
        assert_eq!(rows_before[4].len(), 1, "a document");
        assert_eq!(rows_before[8].len(), 1, "an order");
        assert_eq!(diary::all(conn).unwrap(), diary_before);
        let report = diary::verify(conn).unwrap();
        assert_eq!((report.entries, report.intact), (1, true));
        for (table, triggers) in [
            ("warranty", 2),
            ("maintenance_task", 0),
            ("maintenance_done", 5),
        ] {
            assert_eq!(
                raw_rows(conn, &format!("SELECT count(*) FROM {table}")),
                vec!["Integer(0)"],
                "`{table}` is there, and empty"
            );
            assert_eq!(
                raw_rows(
                    conn,
                    &format!(
                        "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                         AND tbl_name = '{table}'"
                    )
                ),
                vec![format!("Integer({triggers})")],
                "`{table}` is guarded"
            );
        }
        assert_eq!(
            raw_rows(
                conn,
                "SELECT name FROM sqlite_master WHERE type = 'trigger'
                 AND name IN ('document_kind_lets_go_of_warranty', 'room_keeps_maintenance_done',
                              'stage_keeps_maintenance_done')
                 ORDER BY name"
            ),
            vec![
                "Text(\"document_kind_lets_go_of_warranty\")",
                "Text(\"room_keeps_maintenance_done\")",
                "Text(\"stage_keeps_maintenance_done\")"
            ]
        );
        assert!(raw_rows(conn, "PRAGMA foreign_key_check").is_empty());

        // A warranty naming the filed paper, and a task done, on the migrated
        // file.
        warranties::add(
            conn,
            &WarrantyFields {
                target_kind: "stage".into(),
                target_id: bathroom.into(),
                title: "Shower valve".into(),
                given_by: Some("The plumber".into()),
                starts_on: "2026-10-07".into(),
                months: 24,
                document_id: Some(paper.clone()),
                note: None,
            },
        )
        .unwrap();
        let reseal = maintenance::add(
            conn,
            &TaskFields {
                target_kind: "room".into(),
                target_id: room.clone(),
                title: "Reseal the shower".into(),
                every_months: 12,
                first_due_on: "2027-10-07".into(),
                note: None,
            },
        )
        .unwrap();
        maintenance_done::append(
            conn,
            &NewDone {
                task_id: reseal,
                done_on: "2026-10-08".into(),
                note: None,
                author_name: "Synthetic author".into(),
            },
        )
        .unwrap();
        assert!(
            conn.execute("DELETE FROM maintenance_done", []).is_err(),
            "guarded"
        );
        assert!(
            conn.execute("DELETE FROM room WHERE id = ?1", [&room])
                .is_err(),
            "its room kept"
        );
        close(state);

        let again = open(scratch.path()).expect("and opens again, with nothing left to do");
        let plan = db::work::snapshot(&again.conn).unwrap();
        assert_eq!(plan.warranties.len(), 1);
        assert_eq!(
            plan.warranties[0].document_id.as_deref(),
            Some(paper.as_str())
        );
        assert_eq!(plan.maintenance.len(), 1);
        assert_eq!(
            plan.maintenance[0]
                .done
                .iter()
                .map(|d| d.done_on.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-10-08"]
        );
        assert_eq!(plan.care_notes.len(), 1);
        assert_eq!(plan.purchases[0].events.len(), 1);
        assert!(diary::verify(&again.conn).unwrap().intact);
        close(again);
        let mut names = files_in(scratch.path());
        names.sort();
        assert_eq!(
            names,
            vec![intake::DOCUMENTS.to_string(), WORK_FILE.to_string()]
        );
    }
}
