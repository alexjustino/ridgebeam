//! The diary as CSV, written by the host from the database itself.
//!
//! The rows are the diary's own (`db::diary::all`), verified before they are
//! written, one per entry in the chain's order — never rows the interface
//! sends. Fifteen columns:
//!
//! `seq, day, created_at, author, weather, done, finished, present, note,
//! corrects_seq, photos, entry_hash, previous_hash, lost_cause, lost_party`
//!
//! - `done` and `finished` name the activities worked on and finished, joined
//!   by `; `, each with its quantity and unit when one was said
//!   (`Tiling (12 m²)`); an activity since removed from the plan is named by
//!   its id.
//! - `present` names the people on site, joined by `; `; a person since
//!   removed is named by id.
//! - `photos` is the photos' SHA-256 hashes, joined by a space — the names the
//!   work folder keeps them under.
//! - `weather` is the stored word (`sun`, `cloud`, `rain`, `storm`, `wind`,
//!   `other`); an empty cell is nothing said.
//! - `lost_cause` (E3) is the stored word for why a day was lost (`weather`,
//!   `decision`, `absence`, `material`, `owner`, `access`, `other`), and
//!   `lost_party` names the person it is put down to — by id when since
//!   removed. Both are empty when nothing was said. They come last, so a
//!   spreadsheet built on the thirteen columns before E3 still finds each
//!   where it was.
//!
//! The file is UTF-8 with a byte-order mark (so a spreadsheet reads it as
//! UTF-8), lines end in CR LF, the separator is `,` or `;` — what an English or
//! a Portuguese spreadsheet expects — and a cell is quoted as RFC 4180 says:
//! when it holds the separator, a double quote, a CR or an LF, with every
//! double quote doubled.
//!
//! **No cell can carry a formula** (OWASP, "CSV Injection"): a cell whose first
//! character is `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with
//! `'`, whatever column it is in — a note, a name, an author. The spreadsheet
//! shows the text; it runs nothing.

use std::borrow::Cow;
use std::collections::HashMap;

use crate::contract::{DiaryEntry, WorkSnapshot};
use crate::error::{Error, Result};

/// The columns, in order.
pub const COLUMNS: [&str; 15] = [
    "seq",
    "day",
    "created_at",
    "author",
    "weather",
    "done",
    "finished",
    "present",
    "note",
    "corrects_seq",
    "photos",
    "entry_hash",
    "previous_hash",
    "lost_cause",
    "lost_party",
];

/// The UTF-8 byte-order mark.
pub const BOM: &str = "\u{FEFF}";

/// The sentence for a separator that is neither.
pub const SEPARATOR: &str = "A CSV's separator is a comma or a semicolon.";

/// A cell's separator: `,` for English, `;` for Portuguese.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Separator(char);

impl Separator {
    /// The separator the interface named.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidInput`] for anything but `,` or `;`.
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "," => Ok(Separator(',')),
            ";" => Ok(Separator(';')),
            _ => Err(Error::InvalidInput(SEPARATOR.into())),
        }
    }
}

/// A cell that cannot start a formula: prefixed with `'` when its first
/// character is one a spreadsheet would read as the start of one.
pub fn neutralise(cell: &str) -> Cow<'_, str> {
    match cell.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => Cow::Owned(format!("'{cell}")),
        _ => Cow::Borrowed(cell),
    }
}

/// A cell as RFC 4180 writes it: quoted when it holds the separator, a double
/// quote, a CR or an LF, with every double quote doubled.
pub fn quote(cell: &str, separator: Separator) -> Cow<'_, str> {
    if cell.contains([separator.0, '"', '\r', '\n']) {
        Cow::Owned(format!("\"{}\"", cell.replace('"', "\"\"")))
    } else {
        Cow::Borrowed(cell)
    }
}

/// A line of cells, neutralised and quoted, ending in CR LF.
fn line(cells: &[String], separator: Separator, out: &mut String) {
    for (index, cell) in cells.iter().enumerate() {
        if index > 0 {
            out.push(separator.0);
        }
        out.push_str(&quote(&neutralise(cell), separator));
    }
    out.push_str("\r\n");
}

/// How the diary names the rows it points at by id.
pub struct Names {
    activities: HashMap<String, (String, Option<String>)>,
    people: HashMap<String, String>,
}

impl Names {
    /// The names in the work as it is now.
    pub fn of(snapshot: &WorkSnapshot) -> Self {
        Names {
            activities: snapshot
                .activities
                .iter()
                .map(|a| (a.id.clone(), (a.name.clone(), a.unit.clone())))
                .collect(),
            people: snapshot
                .people
                .iter()
                .map(|p| (p.id.clone(), p.name.clone()))
                .collect(),
        }
    }

    fn activity(&self, id: &str, quantity: Option<f64>) -> String {
        let (name, unit) = self
            .activities
            .get(id)
            .map(|(name, unit)| (name.as_str(), unit.as_deref()))
            .unwrap_or((id, None));
        match (quantity, unit) {
            (Some(q), Some(unit)) => format!("{name} ({q} {unit})"),
            (Some(q), None) => format!("{name} ({q})"),
            _ => name.to_string(),
        }
    }

    fn person(&self, id: &str) -> String {
        self.people
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.to_string())
    }
}

/// The diary as CSV text, the byte-order mark first.
pub fn diary(entries: &[DiaryEntry], names: &Names, separator: Separator) -> String {
    let mut out = String::from(BOM);
    let header: Vec<String> = COLUMNS.iter().map(|c| c.to_string()).collect();
    line(&header, separator, &mut out);
    for entry in entries {
        let done = |state: &str| -> String {
            entry
                .done
                .iter()
                .filter(|line| line.state == state)
                .map(|line| names.activity(&line.activity_id, line.quantity))
                .collect::<Vec<_>>()
                .join("; ")
        };
        let cells = vec![
            entry.seq.to_string(),
            entry.day.clone(),
            entry.created_at.clone(),
            entry.author_name.clone(),
            entry.weather.clone().unwrap_or_default(),
            done("worked"),
            done("finished"),
            entry
                .present
                .iter()
                .map(|id| names.person(id))
                .collect::<Vec<_>>()
                .join("; "),
            entry.note.clone().unwrap_or_default(),
            entry
                .corrects_seq
                .map(|seq| seq.to_string())
                .unwrap_or_default(),
            entry
                .photos
                .iter()
                .map(|p| p.file_hash.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            entry.hash.clone(),
            entry.prev_hash.clone(),
            entry.lost_cause.clone().unwrap_or_default(),
            entry
                .lost_party_person_id
                .as_deref()
                .map(|id| names.person(id))
                .unwrap_or_default(),
        ];
        line(&cells, separator, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comma() -> Separator {
        Separator::parse(",").unwrap()
    }

    fn semicolon() -> Separator {
        Separator::parse(";").unwrap()
    }

    #[test]
    fn every_trigger_character_is_neutralised_and_a_safe_cell_is_untouched() {
        for (cell, written) in [
            ("=HYPERLINK(\"http://x\")", "'=HYPERLINK(\"http://x\")"),
            ("+1+1", "'+1+1"),
            ("-2+3", "'-2+3"),
            ("@SUM(A1)", "'@SUM(A1)"),
            ("\t=1", "'\t=1"),
            ("\r=1", "'\r=1"),
        ] {
            assert_eq!(neutralise(cell), written, "{cell:?}");
        }
        for safe in [
            "Tiling",
            "a = b",
            "12",
            "2026-10-09",
            "",
            " =not first",
            "'already",
        ] {
            assert!(
                matches!(neutralise(safe), Cow::Borrowed(_)),
                "{safe:?} is left as it is"
            );
        }
    }

    #[test]
    fn a_cell_is_quoted_as_rfc_4180_says_and_only_when_it_must_be() {
        assert_eq!(quote("plain", comma()), "plain");
        assert_eq!(quote("a,b", comma()), "\"a,b\"");
        assert_eq!(quote("a,b", semicolon()), "a,b", "a comma is safe with ;");
        assert_eq!(quote("a;b", semicolon()), "\"a;b\"");
        assert_eq!(quote("a;b", comma()), "a;b");
        assert_eq!(quote("say \"hi\"", comma()), "\"say \"\"hi\"\"\"");
        assert_eq!(quote("two\nlines", comma()), "\"two\nlines\"");
        assert_eq!(quote("cr\rhere", comma()), "\"cr\rhere\"");
    }

    #[test]
    fn a_separator_is_a_comma_or_a_semicolon() {
        comma();
        semicolon();
        for other in ["\t", "|", "", ",,", " "] {
            let refused = Separator::parse(other).unwrap_err();
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), SEPARATOR);
        }
    }

    #[test]
    fn a_line_neutralises_then_quotes() {
        let mut out = String::new();
        line(
            &["=HYPERLINK(\"x\")".into(), "-,".into(), "safe".into()],
            comma(),
            &mut out,
        );
        assert_eq!(out, "\"'=HYPERLINK(\"\"x\"\")\",\"'-,\",safe\r\n");
    }
}
