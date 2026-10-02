//! A template as a file: read as text, written as text, and never parsed here.
//!
//! A template from a file is somebody else's file, and hostile (SECURITY.md,
//! "Files are hostile"). The host does the part that needs the disk and
//! nothing more: it takes a path a person chose, refuses what is not a
//! `.json` file of at most [`MAX_TEMPLATE_BYTES`] in UTF-8, and hands the
//! text to the domain — which parses it, refuses any field it does not know,
//! and validates it as data (`validateTemplate`, origin `file`). The host
//! never reads a template's contents: there is nothing in one it could run.
//!
//! Writing is the export: the domain builds the text, the host writes it next
//! to where it will live — a temporary file in the same folder, flushed, then
//! renamed over the name — so a template is either the whole file or not
//! there, never half of one. An existing file is replaced only when the
//! person chose it in the save dialog, which asked them first.
//!
//! Every refusal is `invalid_input`, with a sentence that names the file.
//!
//! # Changelog of this module
//!
//! - F9: `read` and `write`.
//! - F10: `write` goes through `files::save`, the one path every file the host
//!   saves takes; its sentences are unchanged.

use std::io::Read;
use std::path::Path;

use crate::error::{Error, Result};
use crate::files::save::{self, display_name};

/// The largest template read or written: 1 MiB — far past any plan a person
/// could read, and small enough that a hostile file is refused before it is
/// read whole.
pub const MAX_TEMPLATE_BYTES: u64 = 1024 * 1024;

/// The sentence for a template chosen by a path that is not a full one.
pub const FULL_PATH: &str = "A template file is chosen by its full path.";

/// Whether the name ends in `.json`, in any case.
fn is_json(path: &Path) -> bool {
    save::has_extension(path, "json")
}

/// The text of a template file, for the domain to parse.
///
/// A byte-order mark at the start is dropped: it is not text, and a JSON
/// parser refuses it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that is not a full one, a file that is
/// not `.json`, not there, not a file, empty, larger than
/// [`MAX_TEMPLATE_BYTES`], or not UTF-8 — each named, nothing read past the
/// cap.
pub fn read(path: &Path) -> Result<String> {
    if !path.is_absolute() {
        return Err(Error::InvalidInput(FULL_PATH.into()));
    }
    let name = display_name(path);
    let refuse = |reason: &str| Error::InvalidInput(format!("“{name}” was not read: {reason}."));
    if !is_json(path) {
        return Err(refuse("a template is a .json file"));
    }
    let metadata = std::fs::metadata(path).map_err(|_| refuse("it could not be found"))?;
    if !metadata.is_file() {
        return Err(refuse("it is not a file"));
    }
    if metadata.len() == 0 {
        return Err(refuse("it is empty"));
    }
    if metadata.len() > MAX_TEMPLATE_BYTES {
        return Err(refuse("it is larger than 1 MiB"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_TEMPLATE_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| refuse("it could not be read"))?;
    if bytes.is_empty() {
        return Err(refuse("it is empty"));
    }
    if bytes.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err(refuse("it is larger than 1 MiB"));
    }
    let text = String::from_utf8(bytes).map_err(|_| refuse("it is not text in UTF-8"))?;
    Ok(text
        .strip_prefix('\u{feff}')
        .map(str::to_string)
        .unwrap_or(text))
}

/// A template as a file to save: `.json`, at most [`MAX_TEMPLATE_BYTES`].
pub const TEMPLATE_FILE: save::Kind = save::Kind {
    extension: "json",
    not_this_kind: "a template is a .json file",
    max_bytes: MAX_TEMPLATE_BYTES,
    too_large: "it would be larger than 1 MiB",
    full_path: FULL_PATH,
    logged_as: "a template",
};

/// Write a template file, whole or not at all, through the one path every
/// file the host saves takes ([`save::write`]): a temporary file in the same
/// folder, flushed to the disk, then renamed to `path`. An existing file is
/// replaced only when `overwrite` says the person chose it in the save dialog.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path that is not a full one, a name that is
/// not `.json`, text larger than [`MAX_TEMPLATE_BYTES`], a folder that is not
/// there, a folder where the file would be, or a file already there without
/// `overwrite`; [`Error::Io`] when the disk refuses the write — and then no
/// temporary file is left behind.
pub fn write(path: &Path, text: &str, overwrite: bool) -> Result<()> {
    save::write(path, text.as_bytes(), overwrite, &TEMPLATE_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testing::Scratch;

    fn files_in(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_template_is_read_as_its_text_and_a_byte_order_mark_is_dropped() {
        let scratch = Scratch::create();
        let plain = scratch.path().join("bathroom.json");
        std::fs::write(
            &plain,
            r#"{ "ridgebeamTemplate": 1, "title": { "pt-BR": "Banheiro" } }"#,
        )
        .unwrap();
        assert_eq!(
            read(&plain).unwrap(),
            r#"{ "ridgebeamTemplate": 1, "title": { "pt-BR": "Banheiro" } }"#
        );

        let marked = scratch.path().join("KITCHEN.JSON");
        std::fs::write(&marked, "\u{feff}{}").unwrap();
        assert_eq!(
            read(&marked).unwrap(),
            "{}",
            "any case of .json; the mark is not text"
        );
    }

    #[test]
    fn a_template_that_is_not_json_by_name_empty_too_large_or_not_utf8_is_refused_by_name() {
        let scratch = Scratch::create();
        let at = |name: &str, bytes: &[u8]| {
            let path = scratch.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        };
        let cap = MAX_TEMPLATE_BYTES as usize;
        let mut exactly = vec![b' '; cap - 2];
        exactly.splice(0..0, *b"{}");
        read(&at("exactly.json", &exactly)).expect("1 MiB is inside the cap");

        for (path, sentence) in [
            (
                at("plan.txt", b"{}"),
                "“plan.txt” was not read: a template is a .json file.",
            ),
            (
                at("script.js", b"{}"),
                "“script.js” was not read: a template is a .json file.",
            ),
            (
                at("empty.json", b""),
                "“empty.json” was not read: it is empty.",
            ),
            (
                at("large.json", &vec![b' '; cap + 1]),
                "“large.json” was not read: it is larger than 1 MiB.",
            ),
            (
                at("latin1.json", b"{ \"title\": \"Cozinha \xe9\" }"),
                "“latin1.json” was not read: it is not text in UTF-8.",
            ),
            (
                scratch.path().join("gone.json"),
                "“gone.json” was not read: it could not be found.",
            ),
        ] {
            let refused = read(&path).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), sentence);
        }
        let folder = scratch.path().join("folder.json");
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(
            read(&folder).unwrap_err().to_string(),
            "“folder.json” was not read: it is not a file."
        );
        assert_eq!(
            read(Path::new("relative.json")).unwrap_err().to_string(),
            FULL_PATH
        );
    }

    #[test]
    fn a_template_is_written_whole_and_leaves_no_temporary_file() {
        let scratch = Scratch::create();
        let path = scratch.path().join("my-bathroom.json");

        write(&path, "{ \"id\": \"my-bathroom\" }", false).unwrap();

        assert_eq!(read(&path).unwrap(), "{ \"id\": \"my-bathroom\" }");
        assert_eq!(files_in(scratch.path()), vec!["my-bathroom.json"]);
    }

    #[test]
    fn an_existing_file_is_replaced_only_when_the_person_chose_it() {
        let scratch = Scratch::create();
        let path = scratch.path().join("kept.json");
        std::fs::write(&path, "somebody's file").unwrap();

        let refused = write(&path, "{}", false).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "“kept.json” was not saved: a file of that name is already there; choose it in the save dialog to replace it."
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "somebody's file");

        write(&path, "{}", true).expect("chosen in the save dialog");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        assert_eq!(files_in(scratch.path()), vec!["kept.json"]);
    }

    #[test]
    fn a_template_is_not_written_by_another_name_past_the_cap_or_where_there_is_no_folder() {
        let scratch = Scratch::create();
        let cap = MAX_TEMPLATE_BYTES as usize;
        write(&scratch.path().join("full.json"), &" ".repeat(cap), false)
            .expect("1 MiB is inside the cap");

        for (path, text, sentence) in [
            (
                scratch.path().join("plan.txt"),
                "{}".to_string(),
                "“plan.txt” was not saved: a template is a .json file.",
            ),
            (
                scratch.path().join("large.json"),
                " ".repeat(cap + 1),
                "“large.json” was not saved: it would be larger than 1 MiB.",
            ),
            (
                scratch.path().join("nowhere").join("plan.json"),
                "{}".to_string(),
                "“plan.json” was not saved: the folder it would go in is not there.",
            ),
        ] {
            let refused = write(&path, &text, true).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), sentence);
        }
        let folder = scratch.path().join("folder.json");
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(
            write(&folder, "{}", true).unwrap_err().to_string(),
            "“folder.json” was not saved: a folder of that name is already there."
        );
        assert_eq!(
            write(Path::new("relative.json"), "{}", true)
                .unwrap_err()
                .to_string(),
            FULL_PATH
        );
        assert_eq!(files_in(scratch.path()), vec!["folder.json", "full.json"]);
    }
}
