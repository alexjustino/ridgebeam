//! Reports and exports: a document the interface composes, laid out and
//! written by the host; the diary as CSV; the work as JSON (ADR-031, ADR-032).
//!
//! - [`model`] — the [`ReportDocument`](model::ReportDocument) the interface
//!   sends, already in words, and its limits.
//! - [`winansi`] — text as the standard faces print it, the documented
//!   stand-ins, and the faces' widths.
//! - [`layout`] — pure: blocks in, positioned marks per page out.
//! - [`pdf`] — those pages written with `pdf-writer`.
//! - [`images`] — the photos an image block names, found by hash in the open
//!   work only, read under the caps and made ready to embed (D3).
//! - [`html`] — the owner's snapshot: the same document as one HTML page with
//!   nothing that runs and nothing loaded, escaped, verified before it is
//!   written (D4).
//! - [`csv`] — the diary from the database: neutralised, quoted, BOM,
//!   separator.
//! - [`json`] — the work and its diary, for anybody else's tool.
//!
//! The host writes its own words in two places only, in the document's
//! language: the footer ("page N of M", `layout::footer`) and the diary's
//! verification block ([`verification`]), which the interface cannot claim.
//! Nothing here reads the clock, the network or a file: the commands do the
//! disk (`commands::reports`), through `files::save`.
//!
//! # Changelog of this module
//!
//! - F10: the module.
//! - D3: the `image` block and the `handover` kind; [`render_with`] embeds the
//!   photos `images::resolve` prepared.
//! - D4: [`html`], the `snapshot` kind and [`HTML_FILE`]; `images` takes a
//!   setting, the snapshot's own (`html::SENT`: 1 024 px, quality 78, always
//!   re-encoded).
//! - G1: the `minutes` kind — a meeting's minutes, laid out as any other
//!   report.
//! - G6: the `third` image size — up to three to a row, in the PDF and the
//!   snapshot alike; a photo placed only as a third is prepared smaller
//!   (`images::THIRD_SIDE`, `html::THIRD_SIDE`).

pub mod csv;
pub mod html;
pub mod images;
pub mod json;
pub mod layout;
pub mod model;
pub mod pdf;
pub mod winansi;

#[cfg(test)]
pub(crate) mod reader_tests;

use chrono::{DateTime, FixedOffset};

use crate::error::{Error, Result};
use crate::files::save::Kind;
use crate::report::model::{Block, Language, ReportDocument, Tone};

/// The largest file a report or an export writes: far past any work a person
/// keeps, and a bound on a file nobody could open.
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;

/// The sentence for a report saved to a path that is not a full one.
pub const FULL_PATH: &str = "A report is saved to a file chosen by its full path.";

/// A PDF report.
pub const PDF_FILE: Kind = Kind {
    extension: "pdf",
    not_this_kind: "a report is a .pdf file",
    max_bytes: MAX_FILE_BYTES,
    too_large: "it would be larger than 256 MiB",
    full_path: FULL_PATH,
    logged_as: "a report",
};

/// The diary as CSV.
pub const CSV_FILE: Kind = Kind {
    extension: "csv",
    not_this_kind: "the diary's table is a .csv file",
    max_bytes: MAX_FILE_BYTES,
    too_large: "it would be larger than 256 MiB",
    full_path: FULL_PATH,
    logged_as: "the diary as CSV",
};

/// The work as JSON.
pub const JSON_FILE: Kind = Kind {
    extension: "json",
    not_this_kind: "the work's export is a .json file",
    max_bytes: MAX_FILE_BYTES,
    too_large: "it would be larger than 256 MiB",
    full_path: FULL_PATH,
    logged_as: "the work as JSON",
};

/// The owner's snapshot, one HTML page (D4): 12 MiB at most.
pub const HTML_FILE: Kind = Kind {
    extension: "html",
    not_this_kind: "the owner's snapshot is a .html file",
    max_bytes: html::MAX_FILE_BYTES,
    too_large: "it would be larger than 12 MiB; a snapshot is at most 12 MiB",
    full_path: FULL_PATH,
    logged_as: "the owner's snapshot",
};

/// The sentence for a moment that is not one.
pub const CREATED_AT: &str =
    "A report's date is a moment in RFC 3339, such as 2026-10-09T14:05:00-03:00.";

/// The moment the interface says the report was made.
///
/// # Errors
///
/// [`Error::InvalidInput`] for anything but an RFC 3339 moment.
pub fn created_at(value: &str) -> Result<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value.trim()).map_err(|_| Error::InvalidInput(CREATED_AT.into()))
}

/// What the chain was when the diary was exported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    /// How many entries.
    pub entries: i64,
    /// The last entry's hash; `None` for an empty diary.
    pub head: Option<String>,
}

/// The diary's verification block, in the document's language, dated by the
/// moment the report was made: what the host found when it verified the chain
/// just before writing, and what that does and does not mean (SPEC R6). The
/// interface cannot write it: the host puts it in front of the document's
/// blocks.
pub fn verification(
    language: Language,
    verified: &Verified,
    on: &DateTime<FixedOffset>,
) -> Vec<Block> {
    let head = verified
        .head
        .as_deref()
        .map(|hash| &hash[..hash.len().min(16)]);
    let (found, meaning, limit) = match language {
        Language::En => {
            let date = on.format("%Y-%m-%d");
            let count = match verified.entries {
                1 => "1 entry".to_string(),
                n => format!("{n} entries"),
            };
            (
                match head {
                    Some(head) => format!("Chain verified on {date}: {count}, head {head}."),
                    None => format!("Chain verified on {date}: {count}."),
                },
                "This is tamper-evidence: it shows whether the file was changed outside Ridgebeam.",
                "It is not a signature and not legal proof.",
            )
        }
        Language::PtBr => {
            let date = on.format("%d/%m/%Y");
            let count = match verified.entries {
                1 => "1 entrada".to_string(),
                n => format!("{n} entradas"),
            };
            (
                match head {
                    Some(head) => format!(
                        "Cadeia verificada em {date}: {count}, impressão digital da última {head}."
                    ),
                    None => format!("Cadeia verificada em {date}: {count}."),
                },
                "Isto é evidência de adulteração: mostra se o arquivo foi alterado fora do Ridgebeam.",
                "Não é uma assinatura e não é prova legal.",
            )
        }
    };
    vec![
        Block::Paragraph {
            text: found,
            tone: Tone::Strong,
        },
        Block::Paragraph {
            text: meaning.into(),
            tone: Tone::Normal,
        },
        Block::Paragraph {
            text: limit.into(),
            tone: Tone::Normal,
        },
        Block::Rule,
    ]
}

/// Lay a checked document out and write it as a PDF, with `prelude` — the
/// host's own blocks — in front of the document's.
///
/// # Errors
///
/// As [`pdf::write`].
pub fn render(
    document: &ReportDocument,
    prelude: &[Block],
    created_at: &DateTime<FixedOffset>,
) -> Result<pdf::Rendered> {
    render_with(document, prelude, created_at, &images::Images::new())
}

/// [`render`], with the photos the document's image blocks name, already
/// resolved in the open work (`images::resolve`).
///
/// # Errors
///
/// As [`pdf::write`].
pub fn render_with(
    document: &ReportDocument,
    prelude: &[Block],
    created_at: &DateTime<FixedOffset>,
    photos: &images::Images,
) -> Result<pdf::Rendered> {
    let blocks: Vec<Block> = prelude.iter().chain(&document.blocks).cloned().collect();
    let pages = layout::lay_out_with(
        &document.title,
        &document.subtitle,
        document.page_size,
        document.language,
        &blocks,
        &images::sizes(photos),
    );
    pdf::write(
        &pages,
        &pdf::Metadata {
            title: &document.title,
            language: document.language,
            created_at: *created_at,
        },
        photos,
    )
}
