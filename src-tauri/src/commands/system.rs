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
//! - F11: `diagnostics` lists every migration each database has been through,
//!   by number and name; `diagnostics_summary` is the whole of Diagnostics as
//!   plain text, for a bug report — the chain verified as it is copied, the
//!   folder measured, the last backup. It keeps the paths of this computer as
//!   they are, and says so in its first lines: the person reads it before
//!   sending it anywhere.

use std::fmt::Write as _;
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, State};

use crate::commands::documents::folder_health_with;
use crate::commands::work::with_work;
use crate::contract::{AppDiagnostics, Diagnostics, MigrationApplied, SystemInfo, WorkDiagnostics};
use crate::db::{self, backups, diary, migrations, Db};
use crate::error::{Error, Result};
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

/// Diagnostics as plain text, for the person to paste into a bug report.
///
/// # Errors
///
/// [`Error::DataDir`] when the application data folder is not available;
/// [`Error::WorkMoved`] when a work is open and its folder is gone;
/// [`Error::Database`] when a database cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn diagnostics_summary(
    app: AppHandle,
    db: State<'_, Db>,
    open: State<'_, OpenWork>,
) -> Result<String> {
    diagnostics_summary_with(&db, &open, &db::data_dir(&app)?, Utc::now())
}

/// Every migration of `schema` that a database at `version` has been
/// through, by number and name.
pub fn applied(schema: &migrations::Schema, version: i64) -> Vec<MigrationApplied> {
    schema
        .sources()
        .iter()
        .zip(1i64..)
        .take_while(|(_, number)| *number <= version)
        .map(|((name, _), number)| MigrationApplied {
            number,
            name: (*name).to_string(),
        })
        .collect()
}

fn names(migrations: &[MigrationApplied]) -> String {
    if migrations.is_empty() {
        return "none".into();
    }
    migrations
        .iter()
        .map(|m| m.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// What [`diagnostics_summary`] does once the state, the folder and the
/// moment are in hand.
pub fn diagnostics_summary_with(
    db: &Db,
    open: &OpenWork,
    app_data_dir: &Path,
    now: DateTime<Utc>,
) -> Result<String> {
    let found = diagnostics_with(db, open)?;
    let info = system_info_with(app_data_dir);
    let mut text = String::new();
    // Writing into a String cannot fail.
    let _ = writeln!(text, "Ridgebeam {} — diagnostics", info.version);
    let _ = writeln!(text, "Copied {}", now.format("%Y-%m-%d %H:%M UTC"));
    let _ = writeln!(
        text,
        "This text holds the folders of this computer as they are. Read it before you send it."
    );
    let _ = writeln!(text);
    let _ = writeln!(text, "System: {} {}", info.os, info.arch);
    let _ = writeln!(
        text,
        "Application data: {}{}",
        info.app_data_dir,
        if info.database_relocated {
            " (relocated for a test run)"
        } else {
            ""
        }
    );
    let _ = writeln!(text, "Application database: {}", found.app.database_path);
    let _ = writeln!(
        text,
        "  Schema: {} of {} — {}",
        found.app.schema_version,
        migrations::APP.target_version(),
        names(&found.app.migrations)
    );
    let _ = writeln!(text);

    match &found.work {
        None => {
            let _ = writeln!(text, "No work is open.");
        }
        Some(work) => {
            // Lock order: the open work first, then the application database.
            let (name, work_id, chain, last) = with_work(open, |state| {
                let row = db::work::work(&state.conn)?;
                let chain = diary::verify(&state.conn)?;
                let last = backups::last(&db.conn(), &state.work_id)?;
                Ok((row.name, state.work_id.clone(), chain, last))
            })?;
            let health = folder_health_with(open)?;
            let _ = writeln!(text, "Open work: {name}");
            let _ = writeln!(text, "  Id: {work_id}");
            let _ = writeln!(text, "  Folder: {}", work.folder);
            let _ = writeln!(
                text,
                "  Schema: {} of {} — {}",
                work.schema_version,
                migrations::WORK.target_version(),
                names(&work.migrations)
            );
            let _ = writeln!(
                text,
                "  Database: journal {}, synchronous {}, foreign keys {}",
                work.journal_mode,
                work.synchronous,
                if work.foreign_keys { "on" } else { "off" }
            );
            let chain_text = if chain.intact {
                format!("{} entries, chain verified", chain.entries)
            } else {
                format!(
                    "{} entries, chain broken — {}",
                    chain.entries,
                    chain.reason.as_deref().unwrap_or("no reason given")
                )
            };
            let _ = writeln!(text, "  Diary: {chain_text}");
            let _ = writeln!(
                text,
                "  Folder health: {} bytes, {} document files, {} thumbnail files",
                health.folder_bytes, health.document_files, health.thumbnail_files
            );
            let _ = writeln!(
                text,
                "  Last backup: {}",
                last.as_deref().unwrap_or("never")
            );
        }
    }
    Ok(text)
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
        let schema_version = migrations::APP.current_version(&conn);
        AppDiagnostics {
            database_path: conn.path().unwrap_or_default().to_string(),
            schema_version,
            migrations: applied(&migrations::APP, schema_version),
        }
    };

    let work = match with_work(open, |state| {
        let schema_version = migrations::WORK.current_version(&state.conn);
        Ok(WorkDiagnostics {
            folder: state.folder.to_string_lossy().into_owned(),
            database_path: state.database_path().to_string_lossy().into_owned(),
            schema_version,
            migrations: applied(&migrations::WORK, schema_version),
            journal_mode: pragma::<String>(&state.conn, "journal_mode")?.to_lowercase(),
            synchronous: synchronous_name(pragma::<i64>(&state.conn, "synchronous")?),
            foreign_keys: pragma::<i64>(&state.conn, "foreign_keys")? == 1,
        })
    }) {
        Ok(work) => Some(work),
        Err(Error::NoWorkOpen) => None,
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
    use chrono::TimeZone;

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
            "migrations",
            "journalMode",
            "synchronous",
            "foreignKeys",
        ] {
            assert!(value.get(key).is_some(), "`{key}` is on the wire");
        }
        work_close_with(&open);
    }

    #[test]
    fn diagnostics_lists_every_migration_applied_by_number_and_name() {
        let (app_db, open, _scratch) = host_with_a_work();

        let found = diagnostics_with(&app_db, &open).unwrap();

        let app = serde_json::to_value(&found.app).unwrap();
        assert_eq!(
            app["migrations"],
            serde_json::json!([
                { "number": 1, "name": "001_init" },
                { "number": 2, "name": "002_settings" },
                { "number": 3, "name": "003_backups" }
            ])
        );
        let work = found.work.unwrap();
        assert_eq!(
            work.migrations.len() as i64,
            migrations::WORK.target_version()
        );
        assert_eq!(work.migrations[0].name, "001_init");
        assert_eq!(work.migrations[9].name, "010_templates");
        assert_eq!(work.migrations[10].name, "011_payment_milestones");
        assert_eq!(
            applied(&migrations::WORK, 7).last().map(|m| m.number),
            Some(7),
            "a work at an older schema lists only what it has been through"
        );
        assert!(applied(&migrations::WORK, 0).is_empty());
        work_close_with(&open);
    }

    #[test]
    fn the_summary_is_plain_text_that_says_it_holds_this_computer_s_folders() {
        let (app_db, open) = host();
        let now = chrono::Utc.with_ymd_and_hms(2026, 10, 9, 17, 5, 0).unwrap();

        let text = diagnostics_summary_with(&app_db, &open, Path::new("C:/data"), now).unwrap();

        assert!(text.starts_with(&format!(
            "Ridgebeam {} — diagnostics\nCopied 2026-10-09 17:05 UTC\n",
            env!("CARGO_PKG_VERSION")
        )));
        assert!(text.contains("Read it before you send it."));
        assert!(text.contains("Application data: C:/data\n"));
        assert!(text.contains("  Schema: 3 of 3 — 001_init, 002_settings, 003_backups\n"));
        assert!(text.ends_with("No work is open.\n"));
    }

    #[test]
    fn the_summary_of_an_open_work_names_its_schema_chain_folder_and_last_backup() {
        let (app_db, open, _scratch) = host_with_a_work();
        let now = chrono::Utc.with_ymd_and_hms(2026, 10, 9, 17, 5, 0).unwrap();
        let summary =
            || diagnostics_summary_with(&app_db, &open, Path::new("C:/data"), now).unwrap();

        let text = summary();
        assert!(text.contains("Open work: Synthetic bathroom\n"), "{text}");
        assert!(text.contains(&format!(
            "  Schema: {0} of {0} — 001_init, 002_rooms_and_quantities,",
            migrations::WORK.target_version()
        )));
        assert!(text.contains(
            "011_payment_milestones, 012_handover, 013_change_orders, 014_funding, 015_lost_cause, 016_snags\n"
        ));
        assert!(text.contains("  Database: journal wal, synchronous full, foreign keys on\n"));
        assert!(text.contains("  Diary: 0 entries, chain verified\n"));
        assert!(text.contains("  Folder health: "));
        assert!(text.contains("  Last backup: never\n"));

        let backups = Scratch::create();
        let local = chrono::Local
            .with_ymd_and_hms(2026, 10, 9, 14, 5, 30)
            .unwrap();
        crate::commands::backup::backup_write_with(
            &app_db,
            &open,
            &backups.path().join("b.ridgebeam").to_string_lossy(),
            false,
            local,
        )
        .unwrap();
        assert!(summary().contains("  Last backup: 2026-10-09\n"));
        work_close_with(&open);
    }

    #[test]
    fn an_in_memory_application_database_has_no_path_and_still_answers() {
        let (app_db, open) = host();
        assert!(diagnostics_with(&app_db, &open).is_ok());
    }
}
