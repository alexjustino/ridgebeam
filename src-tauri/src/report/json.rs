//! The work as JSON, for anybody else's tool (SPEC R4).
//!
//! ```text
//! { "ridgebeamWork": 1,
//!   "exportedAt": "2026-10-09T17:05:30.000Z",
//!   "work": <the WorkSnapshot, exactly as `work_get` returns it>,
//!   "diary": [<every DiaryEntry, in the chain's order, with its hashes>] }
//! ```
//!
//! Pretty-printed, UTF-8, no byte-order mark. The files a work holds are named
//! by their SHA-256 (`documents`, a photo's `fileHash`) and not embedded: the
//! export is the record, not the folder. `ridgebeamWork` is the version of this
//! shape; a field is added under the same number, and anything that changes
//! what a field means takes the next one (docs/DATA_MODEL.md).

use serde::Serialize;

use crate::contract::{DiaryEntry, WorkSnapshot};
use crate::error::{Error, Result};

/// The version of the export's shape.
pub const VERSION: u32 = 1;

/// The export, as written.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkExport<'a> {
    /// [`VERSION`].
    pub ridgebeam_work: u32,
    /// When it was written, UTC.
    pub exported_at: &'a str,
    /// The work.
    pub work: &'a WorkSnapshot,
    /// The diary, from entry 1.
    pub diary: &'a [DiaryEntry],
}

/// The export's text: pretty-printed, ending in a line break.
///
/// # Errors
///
/// [`Error::InvalidInput`] if the work cannot be written as JSON — a number
/// JSON cannot hold; the shapes themselves always serialise.
pub fn work(snapshot: &WorkSnapshot, diary: &[DiaryEntry], exported_at: &str) -> Result<String> {
    let export = WorkExport {
        ridgebeam_work: VERSION,
        exported_at,
        work: snapshot,
        diary,
    };
    let mut text = serde_json::to_string_pretty(&export).map_err(|error| {
        log::error!("the work could not be written as JSON: {error}");
        Error::InvalidInput("The work could not be written as JSON.".into())
    })?;
    text.push('\n');
    Ok(text)
}
