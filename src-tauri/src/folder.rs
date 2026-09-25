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

    match write_new(folder, &new_work) {
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

    let work_id = db::work::work(&conn)?.work_id;
    log::info!("a work was opened");
    Ok(WorkState {
        folder: folder.to_path_buf(),
        conn,
        work_id,
    })
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

        assert_eq!(migrations::WORK.current_version(&state.conn), 2);
        let plan = db::work::snapshot(&state.conn).unwrap();
        assert_eq!(plan.activities[0].name, "Tiling");
        assert_eq!(plan.activities[0].duration_days, Some(3));
        assert!(plan.rooms.is_empty());
        close(state);
        assert_eq!(files_in(scratch.path()), vec![WORK_FILE]);
    }
}
