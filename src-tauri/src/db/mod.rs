//! Persistence: a thin repository over SQLite. No business logic lives here.
//!
//! Two databases, never one (docs/DATA_MODEL.md):
//!
//! - **The application's own**, `ridgebeam.sqlite3` in the application data
//!   folder: the person's settings and the list of recent works. Nothing about
//!   the content of a work.
//! - **A work's**, `work.sqlite3` inside the folder the person chose: the plan,
//!   the calendar, the people. Moving the folder moves the work.
//!
//! Both are opened the same way ([`configure`]), migrated by the same runner
//! with different lists ([`migrations::APP`], [`migrations::WORK`]), and written
//! by repositories that hold SQL and no opinion. What a plan means — readiness,
//! the schedule, what is missing — is pure TypeScript in `src/domain/`.
//!
//! # Changelog of this module
//!
//! - F0: the two databases, their pragmas and migrations; settings, recent
//!   works, and the work's plan.
//! - F1: `rooms` (rooms and the rooms an activity touches) and `order` (moves,
//!   and positions kept 1..n with no gaps); work migration 002.
//! - F2: `dependencies` (the graph, its cycle guard, its cascade) and
//!   `baselines` (insert-only, by rule and by trigger); work migration 003.
//! - F3: `decisions` (name, lead time, made or not — never a deadline); work
//!   migration 004.
//! - F4: `diary` (append-only, chained, and holding no statement that edits
//!   or removes a row); work migration 005.

#[cfg(test)]
mod append_only_tests;
pub mod baselines;
pub mod decisions;
pub mod dependencies;
pub mod diary;
#[cfg(test)]
mod diary_tests;
pub mod migrations;
pub mod order;
pub mod recent;
pub mod rooms;
pub mod settings;
pub mod work;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// The application database, held for the lifetime of the process.
pub struct Db(pub Mutex<Connection>);

impl Db {
    /// The connection, for the length of one command.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        lock(&self.0)
    }
}

/// Take a lock whether or not a previous holder panicked.
///
/// A panic mid-command leaves no half-written row behind — every write is a
/// transaction, and SQLite rolls back what was not committed — so the value
/// behind the lock is still sound, and refusing every later command because of
/// one earlier panic would turn a defect into an outage.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The environment variable that relocates the application data folder.
///
/// Set by the end-to-end suite so a test run never opens the person's real
/// settings and recent works. Honoured in a debug build only, and reported by
/// `system_info`, so a relocated folder is never a silent one.
pub const DATA_DIR_ENV: &str = "RIDGEBEAM_DATA_DIR";

/// The application database's file name.
pub const DATABASE_FILE: &str = "ridgebeam.sqlite3";

/// Where `RIDGEBEAM_DATA_DIR` moves the application data folder — **in a debug
/// build only**. The end-to-end suite drives the debug binary; a release build
/// takes no environment variable that could point a person's settings at a
/// folder somebody else chose.
#[cfg(debug_assertions)]
pub fn relocated_data_dir() -> Option<PathBuf> {
    std::env::var_os(DATA_DIR_ENV)
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
}

/// A release build is never relocated.
#[cfg(not(debug_assertions))]
pub fn relocated_data_dir() -> Option<PathBuf> {
    None
}

/// The application data folder: `%APPDATA%/io.github.alexjustino.ridgebeam/`,
/// or the relocated one. Created if it does not exist.
///
/// # Errors
///
/// [`Error::DataDir`] when the folder cannot be resolved or created.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = match relocated_data_dir() {
        Some(dir) => dir,
        None => app.path().app_data_dir().map_err(|_| Error::DataDir)?,
    };
    std::fs::create_dir_all(&dir).map_err(|_| Error::DataDir)?;
    Ok(dir)
}

/// Open the application database, apply pending migrations, and return it.
///
/// # Errors
///
/// [`Error::DataDir`] when the folder is not available; [`Error::Database`] when
/// the file cannot be opened or migrated.
pub fn open(app: &AppHandle) -> Result<Connection> {
    open_app_at(&data_dir(app)?.join(DATABASE_FILE))
}

/// Open the application database at a path, the way start-up does.
///
/// # Errors
///
/// [`Error::Database`] when the file cannot be opened or migrated.
pub fn open_app_at(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrations::APP.apply(&conn)?;
    Ok(conn)
}

/// The pragmas every database this product opens runs under.
///
/// - `journal_mode = WAL` keeps readers from blocking the writer and survives a
///   hard kill far better than the rollback journal.
/// - `synchronous = FULL`, not NORMAL: in WAL mode NORMAL can lose the last
///   committed transactions on power loss, and the last transaction is exactly
///   the edit a person was just shown as kept. FULL flushes the WAL on every
///   commit; the product commits once per edit, so the cost is a flush nobody
///   waits on.
/// - `foreign_keys = ON`, because SQLite leaves them off by default and a
///   schema whose references are decoration is not a schema.
/// - `recursive_triggers = ON`, so that a `REPLACE` fires the `DELETE` triggers
///   the append-only tables of later slices rely on.
/// - `busy_timeout = 5000`, so a moment of contention is a wait, not an error.
///
/// # Errors
///
/// [`Error::Database`] when a pragma is refused — which is also how a file that
/// is not a database first shows itself.
pub fn configure(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "recursive_triggers", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5_000)?;
    Ok(())
}

/// The instant, as every timestamp column stores it: UTC, milliseconds, `Z`.
pub fn now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// A new identifier. UUID v7 sorts by creation time, which keeps insertion
/// order readable in the file without a second column.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

#[cfg(test)]
pub mod testing {
    //! Scratch folders for tests that need a real file on disk.

    use std::path::{Path, PathBuf};

    /// A folder under the system's temporary directory, removed when dropped.
    pub struct Scratch(PathBuf);

    impl Scratch {
        /// A new, empty, uniquely named folder.
        pub fn create() -> Self {
            let path = std::env::temp_dir().join(format!("ridgebeam-test-{}", super::new_id()));
            std::fs::create_dir_all(&path).expect("scratch folder");
            Scratch(path)
        }

        /// The folder.
        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::Scratch;
    use super::*;

    fn pragma<T: rusqlite::types::FromSql>(conn: &Connection, name: &str) -> T {
        conn.query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
            .expect("read the pragma back")
    }

    /// The path the product actually takes: a file on disk, opened the way
    /// start-up opens it. Every pragma is read back rather than trusted.
    #[test]
    fn a_real_application_file_is_opened_migrated_and_runs_under_every_pragma() {
        let scratch = Scratch::create();
        let path = scratch.path().join(DATABASE_FILE);

        let conn = open_app_at(&path).expect("open a new application database");

        assert_eq!(
            migrations::APP.current_version(&conn),
            migrations::APP.target_version()
        );
        assert_eq!(
            pragma::<String>(&conn, "journal_mode").to_lowercase(),
            "wal"
        );
        assert_eq!(
            pragma::<i64>(&conn, "synchronous"),
            2,
            "2 is FULL; 1 would be NORMAL"
        );
        assert_eq!(pragma::<i64>(&conn, "foreign_keys"), 1);
        assert_eq!(pragma::<i64>(&conn, "recursive_triggers"), 1);
        assert_eq!(pragma::<i64>(&conn, "busy_timeout"), 5_000);

        drop(conn);
        let again = open_app_at(&path).expect("open it a second time");
        assert_eq!(
            migrations::APP.current_version(&again),
            migrations::APP.target_version(),
            "opening an already migrated file changes nothing"
        );
    }

    #[test]
    fn a_timestamp_is_utc_with_milliseconds_and_an_id_sorts_by_time() {
        let instant = now();
        assert_eq!(instant.len(), "2026-09-25T12:00:00.000Z".len(), "{instant}");
        assert!(instant.ends_with('Z'));

        let first = new_id();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = new_id();
        assert_eq!(first.len(), 36);
        assert!(first < second, "{first} then {second}");
    }
}
