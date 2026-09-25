//! Forward-only, numbered migrations — one runner, two schemas.
//!
//! The application database and a work database are migrated by the same code
//! and never by the same list. Each schema names its migrations and the one row
//! that records how far they have gone: `workspace.schema_version` for the
//! application, `work.schema_version` for a work. A work moves between machines
//! and between versions on its own, which is why its numbering is its own.
//!
//! Each migration runs inside a transaction that also moves the version, so a
//! file is never at a version whose tables it does not have. There is no
//! down-migration: a mistake is corrected by a new migration, never by rewriting
//! an applied one — an applied migration is history, and history already ran on
//! somebody's machine.

use rusqlite::Connection;

use crate::error::{Error, Result};

/// One schema's migrations, and where it records the version it is at.
pub struct Schema {
    /// What the log calls it.
    pub name: &'static str,
    /// Every migration, in order. The index plus one is the version it
    /// produces, so a migration can never be reordered without the compiler and
    /// the round-trip test both objecting.
    migrations: &'static [(&'static str, &'static str)],
    /// Reads the version. A file that has never been migrated has no table yet,
    /// and reports 0.
    read_version: &'static str,
    /// Moves the version to `?1`. Must change exactly one row.
    write_version: &'static str,
}

/// The application's own database, `ridgebeam.sqlite3`.
pub const APP: Schema = Schema {
    name: "application",
    migrations: &[
        ("001_init", include_str!("../../migrations/001_init.sql")),
        (
            "002_settings",
            include_str!("../../migrations/002_settings.sql"),
        ),
    ],
    read_version: "SELECT schema_version FROM workspace WHERE id = 1",
    write_version: "UPDATE workspace SET schema_version = ?1 WHERE id = 1",
};

/// A work's database, `work.sqlite3`, inside the work folder.
///
/// Its version row is the work row itself, which carries what the person typed
/// and so cannot be inserted by a migration. A new work is therefore created by
/// [`crate::db::work::create`], which applies every migration and inserts that
/// row in one transaction; this runner only ever moves an existing work forward.
pub const WORK: Schema = Schema {
    name: "work",
    migrations: &[
        (
            "001_init",
            include_str!("../../work_migrations/001_init.sql"),
        ),
        (
            "002_rooms_and_quantities",
            include_str!("../../work_migrations/002_rooms_and_quantities.sql"),
        ),
        (
            "003_dependencies_and_baselines",
            include_str!("../../work_migrations/003_dependencies_and_baselines.sql"),
        ),
        (
            "004_decisions",
            include_str!("../../work_migrations/004_decisions.sql"),
        ),
    ],
    read_version: "SELECT schema_version FROM work WHERE id = 1",
    write_version: "UPDATE work SET schema_version = ?1 WHERE id = 1",
};

impl Schema {
    /// Every migration, name and SQL, in the order they apply.
    ///
    /// Public so a test can walk the versions one at a time — the runner itself
    /// only ever goes to head, which is right for the product and wrong for a
    /// test that must stand at each step of somebody's history.
    pub fn sources(&self) -> &'static [(&'static str, &'static str)] {
        self.migrations
    }

    /// The schema version this build expects.
    pub fn target_version(&self) -> i64 {
        self.migrations.len() as i64
    }

    /// The version the file is at; 0 when it has never been migrated.
    pub fn current_version(&self, conn: &Connection) -> i64 {
        conn.query_row(self.read_version, [], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
    }

    /// Apply every migration the file has not seen yet.
    ///
    /// # Errors
    ///
    /// [`Error::NewerVersion`] when the file is at a version this build does not
    /// know; [`Error::Database`] when a migration fails, in which case the
    /// transaction is rolled back and the file stays at the version it was.
    pub fn apply(&self, conn: &Connection) -> Result<()> {
        let from = self.current_version(conn);
        let to = self.target_version();

        if from > to {
            return Err(Error::NewerVersion {
                found: from,
                known: to,
            });
        }
        if from == to {
            log::debug!(
                "the {} schema is at version {from}; nothing to apply",
                self.name
            );
            return Ok(());
        }

        for (index, (name, sql)) in self.migrations.iter().enumerate() {
            let version = index as i64 + 1;
            if version <= from {
                continue;
            }
            log::info!("applying {} migration {name}", self.name);
            self.apply_one(conn, sql, version)?;
        }

        log::info!(
            "the {} schema migrated from version {from} to {to}",
            self.name
        );
        Ok(())
    }

    /// One migration and the version it produces, in one transaction.
    fn apply_one(&self, conn: &Connection, sql: &str, version: i64) -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        let moved = tx.execute(self.write_version, [version])?;
        if moved != 1 {
            // The version row is missing: the file is not what this schema
            // expects. Dropping `tx` rolls the migration back.
            return Err(Error::Database(rusqlite::Error::QueryReturnedNoRows));
        }
        tx.commit()?;
        Ok(())
    }

    /// Apply migrations up to and including `version`, and no further — the
    /// state a file a release behind is in. For tests only.
    #[cfg(test)]
    pub fn apply_up_to(&self, conn: &Connection, version: i64) -> Result<()> {
        let from = self.current_version(conn);
        for (index, (_, sql)) in self.migrations.iter().enumerate() {
            let at = index as i64 + 1;
            if at <= from || at > version {
                continue;
            }
            self.apply_one(conn, sql, at)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn
    }

    fn table_exists(conn: &Connection, table: &str) -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            == 1
    }

    #[test]
    fn the_application_schema_applies_from_empty_to_head() {
        let conn = memory();
        assert_eq!(APP.current_version(&conn), 0);

        APP.apply(&conn).expect("migrate");

        assert_eq!(APP.current_version(&conn), APP.target_version());
        assert_eq!(
            APP.target_version(),
            2,
            "F0 ships two application migrations"
        );
    }

    #[test]
    fn the_application_schema_creates_every_table_the_product_needs() {
        let conn = memory();
        APP.apply(&conn).expect("migrate");

        for table in ["workspace", "recent_work", "settings"] {
            assert!(table_exists(&conn, table), "`{table}` is missing");
        }
    }

    #[test]
    fn applying_the_application_schema_again_changes_nothing() {
        let conn = memory();
        APP.apply(&conn).expect("first");
        APP.apply(&conn).expect("second");
        APP.apply(&conn).expect("third");

        assert_eq!(APP.current_version(&conn), APP.target_version());
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM workspace", [], |r| r.get(0))
            .expect("count");
        assert_eq!(
            rows, 1,
            "the workspace is one row, however often it migrates"
        );
    }

    /// From empty and from every version in between, a round trip ends at head
    /// — which is what makes a migration safe to ship to somebody whose file is
    /// a release behind — and keeps what was already recorded.
    #[test]
    fn an_application_database_at_any_earlier_version_migrates_to_this_one_and_keeps_its_rows() {
        for stop_at in 0..=APP.target_version() {
            let conn = memory();
            APP.apply_up_to(&conn, stop_at).expect("stand at a version");
            assert_eq!(APP.current_version(&conn), stop_at);
            if stop_at >= 1 {
                conn.execute(
                    "INSERT INTO recent_work (work_id, name, folder, opened_at)
                     VALUES (?1, 'Kept', 'C:/works/kept', 't')",
                    ["0".repeat(36)],
                )
                .expect("record something before migrating");
            }

            APP.apply(&conn).expect("migrate the rest of the way");

            assert_eq!(APP.current_version(&conn), APP.target_version());
            let kept: i64 = conn
                .query_row("SELECT count(*) FROM recent_work", [], |r| r.get(0))
                .expect("count");
            assert_eq!(
                kept,
                i64::from(stop_at >= 1),
                "a migration must not lose a row"
            );
        }
    }

    #[test]
    fn the_workspace_holds_exactly_one_row() {
        let conn = memory();
        APP.apply(&conn).expect("migrate");

        let inserted = conn.execute("INSERT INTO workspace (id) VALUES (2)", []);
        assert!(inserted.is_err(), "a second workspace row must be refused");
    }

    /// A work's version row is inserted with what the person typed, so the
    /// runner never creates a work: it refuses a file with no work row and
    /// leaves it as it found it.
    #[test]
    fn the_work_runner_refuses_a_file_that_has_no_work_row_and_leaves_it_untouched() {
        let conn = memory();
        assert_eq!(WORK.current_version(&conn), 0);

        let refused = WORK.apply(&conn).expect_err("no work row to move");

        assert_eq!(refused.kind(), "database");
        assert!(
            !table_exists(&conn, "work"),
            "the migration was rolled back"
        );
    }

    /// A newer build's work is not opened by guessing at tables this build has
    /// never seen.
    #[test]
    fn a_file_from_a_newer_version_is_refused_and_not_touched() {
        let conn = memory();
        APP.apply(&conn).expect("migrate");
        conn.execute("UPDATE workspace SET schema_version = 99 WHERE id = 1", [])
            .expect("pretend a newer build wrote it");

        let refused = APP.apply(&conn).expect_err("too new");

        assert!(matches!(
            refused,
            Error::NewerVersion {
                found: 99,
                known: 2
            }
        ));
        assert_eq!(APP.current_version(&conn), 99);
    }
}
