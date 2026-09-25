//! The single error type that crosses the command boundary.
//!
//! Everything the interface can see is serialised as `{ "kind": ..., "message": ... }`.
//! `kind` is stable and machine-readable — the interface maps it to a sentence
//! in the person's language. `message` is a plain English sentence, for the log
//! and for a kind the interface does not know yet. Internal detail (paths, SQL,
//! operating-system codes) is logged, never returned.
//!
//! The kinds are a closed list, and the interface is built to the same list:
//!
//! | kind                    | when                                                            |
//! | ----------------------- | --------------------------------------------------------------- |
//! | `database`              | SQLite refused or failed — including a work from a newer build  |
//! | `io`                    | a file or folder could not be read, written or created          |
//! | `data_dir`              | the application data folder is not available                    |
//! | `work_folder_not_empty` | a new work was asked for in a folder that already holds files   |
//! | `work_not_found`        | the folder holds no work — no `work.sqlite3`, or not one of ours |
//! | `work_moved`            | the open work's folder is no longer where it was opened from    |
//! | `no_work_open`          | a work command arrived with no work open                        |
//! | `invalid_input`         | a value the host refuses; the message says which and why        |
//! | `settings_key`          | a setting that is not on the closed list                        |

use serde::Serialize;

/// Every way a command can fail, as the host sees it.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// SQLite refused or failed. The detail is logged; the sentence is generic
    /// because the detail is SQL, not something a person can act on.
    #[error("The database could not be read or written.")]
    Database(#[from] rusqlite::Error),

    /// A file written by a later version of the product, whose schema this
    /// build does not know. Opening it anyway would be guessing at the meaning
    /// of tables this build has never seen.
    #[error("This file was saved by a newer version of Ridgebeam. Update Ridgebeam to open it.")]
    NewerVersion {
        /// The version the file is at.
        found: i64,
        /// The newest version this build knows.
        known: i64,
    },

    /// A file or folder could not be read, written or created.
    #[error("A file or folder could not be read or written.")]
    Io(#[from] std::io::Error),

    /// The application data folder could not be resolved or created.
    #[error("The application data folder is not available.")]
    DataDir,

    /// A new work needs a folder of its own.
    #[error(
        "That folder already holds files. A new work needs an empty folder, or one that does not exist yet."
    )]
    WorkFolderNotEmpty,

    /// The folder holds no work this product can open. The sentence says which
    /// of the two it is: nothing there, or something that is not a work.
    #[error("{0}")]
    WorkNotFound(&'static str),

    /// The open work's folder was moved, renamed or deleted while it was open.
    #[error(
        "The work's folder is no longer where it was opened from. Close the work, then open it again from where it is now."
    )]
    WorkMoved,

    /// A command that needs an open work arrived when none is open.
    #[error("No work is open.")]
    NoWorkOpen,

    /// A value the host refuses. The sentence names the field and what it takes.
    #[error("{0}")]
    InvalidInput(String),

    /// A setting that is not on the host's closed list.
    #[error("That is not a setting Ridgebeam keeps.")]
    SettingsKey,
}

/// The sentence for a folder with no `work.sqlite3` in it.
pub const NO_WORK_FILE: &str = "That folder does not hold a work: there is no work.sqlite3 in it.";

/// The sentence for a `work.sqlite3` that is not a work this product wrote.
pub const NOT_A_WORK: &str = "That folder holds a work.sqlite3 that is not a Ridgebeam work.";

impl Error {
    /// The stable, machine-readable name of this error, as the interface reads it.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Database(_) | Error::NewerVersion { .. } => "database",
            Error::Io(_) => "io",
            Error::DataDir => "data_dir",
            Error::WorkFolderNotEmpty => "work_folder_not_empty",
            Error::WorkNotFound(_) => "work_not_found",
            Error::WorkMoved => "work_moved",
            Error::NoWorkOpen => "no_work_open",
            Error::InvalidInput(_) => "invalid_input",
            Error::SettingsKey => "settings_key",
        }
    }
}

/// What the interface receives.
#[derive(Serialize)]
struct SerializedError {
    kind: &'static str,
    message: String,
}

impl Serialize for Error {
    // `Result` in this module is the crate alias, so the trait signature has to
    // spell out the standard one.
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let kind = self.kind();
        // The detail goes to the log; the interface gets the sentence.
        log::error!("{kind}: {self:?}");
        SerializedError {
            kind,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

/// The crate's result: every command returns one.
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    /// One of every variant, with the kind the interface expects for it.
    fn every_error() -> Vec<(Error, &'static str)> {
        vec![
            (
                Error::Database(rusqlite::Error::QueryReturnedNoRows),
                "database",
            ),
            (Error::NewerVersion { found: 9, known: 1 }, "database"),
            (Error::Io(std::io::Error::other("disk")), "io"),
            (Error::DataDir, "data_dir"),
            (Error::WorkFolderNotEmpty, "work_folder_not_empty"),
            (Error::WorkNotFound(NO_WORK_FILE), "work_not_found"),
            (Error::WorkNotFound(NOT_A_WORK), "work_not_found"),
            (Error::WorkMoved, "work_moved"),
            (Error::NoWorkOpen, "no_work_open"),
            (
                Error::InvalidInput("The name is empty.".into()),
                "invalid_input",
            ),
            (Error::SettingsKey, "settings_key"),
        ]
    }

    #[test]
    fn every_error_kind_serialises_to_a_kind_and_a_message_and_nothing_else() {
        for (error, kind) in every_error() {
            let value = serde_json::to_value(&error).expect("serialise");
            let object = value.as_object().expect("an object");
            assert_eq!(object.len(), 2, "{kind}: exactly two fields, got {value}");
            assert_eq!(object["kind"], kind);
            let message = object["message"].as_str().expect("a string message");
            assert!(!message.is_empty(), "{kind}: an empty message");
            assert!(
                message.ends_with('.'),
                "{kind}: a message is a sentence: {message}"
            );
        }
    }

    /// The contract lists nine kinds. A variant that maps outside the list is a
    /// kind the interface cannot translate.
    #[test]
    fn the_kinds_are_exactly_the_closed_list_the_interface_translates() {
        let mut kinds: Vec<&str> = every_error().iter().map(|(e, _)| e.kind()).collect();
        kinds.sort_unstable();
        kinds.dedup();
        assert_eq!(
            kinds,
            vec![
                "data_dir",
                "database",
                "invalid_input",
                "io",
                "no_work_open",
                "settings_key",
                "work_folder_not_empty",
                "work_moved",
                "work_not_found",
            ]
        );
    }

    /// SQL and paths are for the log. What reaches the screen is a sentence.
    #[test]
    fn a_database_error_does_not_carry_its_sql_to_the_interface() {
        let error = Error::Database(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(19),
            Some("CHECK constraint failed: length(name) BETWEEN 1 AND 120".into()),
        ));
        let value = serde_json::to_value(&error).expect("serialise");
        assert_eq!(
            value["message"],
            "The database could not be read or written."
        );
    }
}
