//! System-level commands: what this build is, the colour the desktop uses, and
//! what Diagnostics shows.
//!
//! Nothing here is a hand-typed constant that could drift from the binary: the
//! version comes from the crate, the paths from where the files really are, and
//! the pragmas are read back from the connections rather than repeated from the
//! code that set them.
//!
//! # Changelog of this boundary
//!
//! - F0: `system_info` for About and Diagnostics, `accent_ramp` for the token
//!   layer, `diagnostics` for the two databases.

use std::path::Path;

use rusqlite::Connection;
use tauri::{AppHandle, State};

use crate::commands::work::with_work;
use crate::contract::{AppDiagnostics, Diagnostics, SystemInfo, WorkDiagnostics};
use crate::db::{self, migrations, Db};
use crate::error::Result;
use crate::folder::OpenWork;
use crate::os::accent;

/// Identity and where the application keeps its own file.
///
/// # Errors
///
/// [`crate::error::Error::DataDir`] when the application data folder is not
/// available.
#[tauri::command(rename_all = "snake_case")]
pub fn system_info(app: AppHandle) -> Result<SystemInfo> {
    Ok(system_info_with(&db::data_dir(&app)?))
}

/// The Windows accent ramp. The interface writes it into the token layer, so
/// the product follows the colour the person chose for their desktop.
#[tauri::command(rename_all = "snake_case")]
pub fn accent_ramp() -> accent::AccentRamp {
    accent::read()
}

/// The two databases as they are: files, schema versions, and — for the open
/// work — the pragmas it runs under.
///
/// # Errors
///
/// [`crate::error::Error::WorkMoved`] when a work is open and its folder is
/// gone; [`crate::error::Error::Database`] when a pragma cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn diagnostics(db: State<'_, Db>, open: State<'_, OpenWork>) -> Result<Diagnostics> {
    diagnostics_with(&db, &open)
}

/// What [`system_info`] does once the folder is known.
pub fn system_info_with(app_data_dir: &Path) -> SystemInfo {
    SystemInfo {
        product: "Ridgebeam",
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        app_data_dir: app_data_dir.to_string_lossy().into_owned(),
        database_relocated: db::relocated_data_dir().is_some(),
    }
}

/// What [`diagnostics`] does once the state is in hand.
pub fn diagnostics_with(db: &Db, open: &OpenWork) -> Result<Diagnostics> {
    let app = {
        let conn = db.conn();
        AppDiagnostics {
            database_path: conn.path().unwrap_or_default().to_string(),
            schema_version: migrations::APP.current_version(&conn),
        }
    };

    let work = match with_work(open, |state| {
        Ok(WorkDiagnostics {
            folder: state.folder.to_string_lossy().into_owned(),
            database_path: state.database_path().to_string_lossy().into_owned(),
            schema_version: migrations::WORK.current_version(&state.conn),
            journal_mode: pragma::<String>(&state.conn, "journal_mode")?.to_lowercase(),
            synchronous: synchronous_name(pragma::<i64>(&state.conn, "synchronous")?),
            foreign_keys: pragma::<i64>(&state.conn, "foreign_keys")? == 1,
        })
    }) {
        Ok(work) => Some(work),
        Err(crate::error::Error::NoWorkOpen) => None,
        Err(other) => return Err(other),
    };

    Ok(Diagnostics { app, work })
}

fn pragma<T: rusqlite::types::FromSql>(conn: &Connection, name: &str) -> Result<T> {
    Ok(conn.query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))?)
}

/// SQLite's number for `synchronous`, as the word a person can look up.
fn synchronous_name(level: i64) -> String {
    match level {
        0 => "off",
        1 => "normal",
        2 => "full",
        3 => "extra",
        _ => "unknown",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::work::tests::{host, host_with_a_work};
    use crate::commands::work::work_close_with;
    use crate::db::testing::Scratch;

    #[test]
    fn system_info_names_the_product_and_the_version_of_this_binary() {
        let info = system_info_with(Path::new("C:/somewhere"));
        let value = serde_json::to_value(&info).unwrap();

        assert_eq!(value["product"], "Ridgebeam");
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["appDataDir"], "C:/somewhere");
        for key in ["os", "arch", "databaseRelocated"] {
            assert!(value.get(key).is_some(), "`{key}` is on the wire");
        }
    }

    #[test]
    fn diagnostics_with_no_work_open_shows_the_application_database_and_null() {
        let scratch = Scratch::create();
        let conn = db::open_app_at(&scratch.path().join(db::DATABASE_FILE)).unwrap();
        let (app_db, open) = (Db(std::sync::Mutex::new(conn)), OpenWork::default());

        let found = diagnostics_with(&app_db, &open).unwrap();

        assert!(found.app.database_path.ends_with(db::DATABASE_FILE));
        assert_eq!(found.app.schema_version, migrations::APP.target_version());
        assert_eq!(found.work, None);
        assert_eq!(
            serde_json::to_value(&found).unwrap()["work"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn diagnostics_reads_the_open_work_s_pragmas_back_from_its_connection() {
        let (app_db, open, _scratch) = host_with_a_work();

        let work = diagnostics_with(&app_db, &open)
            .unwrap()
            .work
            .expect("a work is open");

        assert_eq!(work.journal_mode, "wal");
        assert_eq!(work.synchronous, "full");
        assert!(work.foreign_keys);
        assert_eq!(work.schema_version, migrations::WORK.target_version());
        assert!(work.database_path.ends_with("work.sqlite3"));
        let value = serde_json::to_value(&work).unwrap();
        for key in [
            "folder",
            "databasePath",
            "schemaVersion",
            "journalMode",
            "synchronous",
            "foreignKeys",
        ] {
            assert!(value.get(key).is_some(), "`{key}` is on the wire");
        }
        work_close_with(&open);
    }

    #[test]
    fn an_in_memory_application_database_has_no_path_and_still_answers() {
        let (app_db, open) = host();
        assert!(diagnostics_with(&app_db, &open).is_ok());
    }
}
