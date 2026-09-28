//! A report, as the interface composes it: a document already in words.
//!
//! The interface builds a [`ReportDocument`] from the same domain rows the
//! screen shows, in the language on screen (the weekly report in the owner's
//! words), and the host lays it out and writes it. The host adds nothing to
//! what it says — except the diary's verification block, which only the host
//! can claim (`report::verification`).
//!
//! A document is checked before anything is laid out ([`check`]): at most
//! [`MAX_BLOCKS`] blocks, [`MAX_ROWS`] rows in its tables, figures and
//! schedules together, and [`MAX_TEXT_CHARS`] characters in any one string. A
//! document past a limit is refused with a sentence, whole.
//!
//! On the wire (camelCase, `type` tags):
//!
//! ```text
//! { kind: 'weekly' | 'diary' | 'schedule', title, subtitle,
//!   pageSize: 'a4' | 'a4-landscape', language: 'en' | 'pt-BR',
//!   blocks: [
//!     { type: 'heading', level: 1 | 2, text }
//!     { type: 'paragraph', text, tone?: 'normal' | 'muted' | 'strong' }
//!     { type: 'figure', label, value, rows: string[] }
//!     { type: 'table', columns: [{ text, align: 'left' | 'right', width }], rows: string[][] }
//!     { type: 'gantt', days, dayLabels: string[], rows: [{ label, start, length,
//!       critical, baselineStart: number | null, baselineLength: number | null }] }
//!     { type: 'rule' }
//!     { type: 'pageBreak' } ] }
//! ```

use serde::Deserialize;

use crate::error::{Error, Result};

/// The most blocks a report holds.
pub const MAX_BLOCKS: usize = 5000;

/// The most rows a report holds: table rows, a figure's rows and schedule bars
/// together.
pub const MAX_ROWS: usize = 20_000;

/// The longest string anywhere in a report, in characters.
pub const MAX_TEXT_CHARS: usize = 2000;

/// The most columns a table has.
pub const MAX_COLUMNS: usize = 16;

/// The most days a printed schedule runs over: ten years.
pub const MAX_GANTT_DAYS: i64 = 3660;

/// Which report a document is. The diary is written only through its own
/// export, which verifies the chain first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportKind {
    /// The weekly report, in the owner's words.
    Weekly,
    /// The diary, exported.
    Diary,
    /// The schedule, printed.
    Schedule,
}

/// The paper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum PageSize {
    /// A4, portrait.
    #[serde(rename = "a4")]
    A4,
    /// A4, landscape — the schedule.
    #[serde(rename = "a4-landscape")]
    A4Landscape,
}

/// The language the document's words are in. The host writes its own few
/// words — the footer's "page N of M" and the diary's verification block — in
/// it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Language {
    /// English.
    #[serde(rename = "en")]
    En,
    /// Portuguese, as spoken in Brazil.
    #[serde(rename = "pt-BR")]
    PtBr,
}

impl Language {
    /// The BCP 47 tag, for the PDF's `/Lang`.
    pub fn tag(self) -> &'static str {
        match self {
            Language::En => "en",
            Language::PtBr => "pt-BR",
        }
    }
}

/// A paragraph's weight.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    /// Regular, black.
    #[default]
    Normal,
    /// Regular, grey.
    Muted,
    /// Bold, black — the line that must not be missed.
    Strong,
}

/// Where a column's cells sit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    /// Words.
    Left,
    /// Numbers.
    Right,
}

/// A table's column.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    /// Its heading.
    pub text: String,
    /// Where its cells sit.
    pub align: Align,
    /// Its share of the line: a fraction, more than 0. The shares are scaled to
    /// fill the line.
    pub width: f64,
}

/// One bar of a printed schedule, in day columns counted from day 0.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttRow {
    /// The activity, as the table under the chart names it.
    pub label: String,
    /// The first day column it covers.
    pub start: i64,
    /// How many day columns; 0 for a milestone.
    pub length: i64,
    /// On the critical path: filled dark; otherwise outlined.
    pub critical: bool,
    /// Where the latest baseline had it, or `null`. May lie before day 0 or
    /// past the last day: only the part inside is drawn.
    pub baseline_start: Option<i64>,
    /// With `baselineStart`, or `null` with it.
    pub baseline_length: Option<i64>,
}

/// A block of a report, in the order it is printed.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Block {
    /// A heading: level 1 or 2.
    Heading {
        /// 1 or 2.
        level: u8,
        /// Its words.
        text: String,
    },
    /// A paragraph.
    Paragraph {
        /// Its words; a line break is kept.
        text: String,
        /// Its weight; `normal` when left out.
        #[serde(default)]
        tone: Tone,
    },
    /// A figure with its rows listed under it: a report carries its rows too.
    Figure {
        /// What it counts.
        label: String,
        /// The count, in words.
        value: String,
        /// The rows it counts.
        rows: Vec<String>,
    },
    /// A table; it breaks across pages repeating its header.
    Table {
        /// Its columns.
        columns: Vec<Column>,
        /// Its rows, one cell per column.
        rows: Vec<Vec<String>>,
    },
    /// A schedule drawn as bars on a day grid; it breaks across pages
    /// repeating its day header.
    Gantt {
        /// How many day columns.
        days: i64,
        /// One label per day column (an empty string leaves it unlabelled), or
        /// none at all.
        day_labels: Vec<String>,
        /// The bars.
        rows: Vec<GanttRow>,
    },
    /// A line across the page.
    Rule,
    /// The next block starts a page.
    PageBreak,
}

/// What the interface sends: a report, already in words.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDocument {
    /// Which report.
    pub kind: ReportKind,
    /// Printed at the top, in every page's footer and as the PDF's title.
    pub title: String,
    /// Printed under the title; may be empty.
    pub subtitle: String,
    /// The paper.
    pub page_size: PageSize,
    /// The language the words are in.
    pub language: Language,
    /// What it says.
    pub blocks: Vec<Block>,
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// A string no longer than [`MAX_TEXT_CHARS`].
fn text(value: &str, place: &dyn Fn() -> String) -> Result<()> {
    if value.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(format!(
            "{} has a text longer than {MAX_TEXT_CHARS} characters; a report holds at most {MAX_TEXT_CHARS} in one.",
            place()
        )));
    }
    Ok(())
}

/// Check a document against the limits and its own shape, before anything is
/// laid out.
///
/// # Errors
///
/// [`Error::InvalidInput`], naming the first block that does not fit and why.
pub fn check(document: &ReportDocument) -> Result<()> {
    if document.title.trim().is_empty() {
        return Err(invalid("A report needs a title."));
    }
    let whole = || "The report".to_string();
    text(&document.title, &whole)?;
    text(&document.subtitle, &whole)?;
    if document.blocks.len() > MAX_BLOCKS {
        return Err(invalid(format!(
            "A report holds at most {MAX_BLOCKS} blocks; this one has {}.",
            document.blocks.len()
        )));
    }

    let mut rows = 0usize;
    for (index, block) in document.blocks.iter().enumerate() {
        let number = index + 1;
        let place = || format!("Block {number}");
        match block {
            Block::Heading { level, text: words } => {
                if !matches!(level, 1 | 2) {
                    return Err(invalid(format!(
                        "Block {number} is a heading of level {level}; a heading is level 1 or 2."
                    )));
                }
                text(words, &place)?;
            }
            Block::Paragraph { text: words, .. } => text(words, &place)?,
            Block::Figure {
                label,
                value,
                rows: listed,
            } => {
                text(label, &place)?;
                text(value, &place)?;
                for row in listed {
                    text(row, &place)?;
                }
                rows += listed.len();
            }
            Block::Table {
                columns,
                rows: listed,
            } => {
                if columns.is_empty() || columns.len() > MAX_COLUMNS {
                    return Err(invalid(format!(
                        "Block {number} is a table of {} columns; a table has 1 to {MAX_COLUMNS}.",
                        columns.len()
                    )));
                }
                for column in columns {
                    text(&column.text, &place)?;
                    if !(column.width.is_finite() && column.width > 0.0 && column.width <= 1.0) {
                        return Err(invalid(format!(
                            "Block {number} has a column whose width is not a fraction of the line above 0."
                        )));
                    }
                }
                for (r, row) in listed.iter().enumerate() {
                    if row.len() != columns.len() {
                        return Err(invalid(format!(
                            "Row {} of block {number} has {} cells; its table has {} columns.",
                            r + 1,
                            row.len(),
                            columns.len()
                        )));
                    }
                    for cell in row {
                        text(cell, &place)?;
                    }
                }
                rows += listed.len();
            }
            Block::Gantt {
                days,
                day_labels,
                rows: bars,
            } => {
                if !(1..=MAX_GANTT_DAYS).contains(days) {
                    return Err(invalid(format!(
                        "Block {number} is a schedule over {days} days; a printed schedule runs over 1 to {MAX_GANTT_DAYS}."
                    )));
                }
                if !day_labels.is_empty() && day_labels.len() as i64 != *days {
                    return Err(invalid(format!(
                        "Block {number} has {} day labels for {days} days: one per day, or none.",
                        day_labels.len()
                    )));
                }
                for label in day_labels {
                    text(label, &place)?;
                }
                for bar in bars {
                    text(&bar.label, &place)?;
                    if bar.start < 0 || bar.length < 0 || bar.start + bar.length > *days {
                        return Err(invalid(format!(
                            "Block {number} has a bar “{}” that does not lie inside its {days} days.",
                            bar.label
                        )));
                    }
                    match (bar.baseline_start, bar.baseline_length) {
                        (None, None) => {}
                        (Some(_), Some(length)) if length >= 0 => {}
                        _ => {
                            return Err(invalid(format!(
                                "Block {number} has a bar “{}” whose baseline needs a start and a length of 0 or more, or neither.",
                                bar.label
                            )))
                        }
                    }
                }
                rows += bars.len();
            }
            Block::Rule | Block::PageBreak => {}
        }
        if rows > MAX_ROWS {
            return Err(invalid(format!(
                "A report holds at most {MAX_ROWS} rows in its tables, figures and schedules together."
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A document with one block of every type.
    pub fn every_block() -> ReportDocument {
        serde_json::from_value(serde_json::json!({
            "kind": "weekly",
            "title": "Weekly report — Synthetic bathroom",
            "subtitle": "Week of 5 October 2026",
            "pageSize": "a4",
            "language": "en",
            "blocks": [
                { "type": "heading", "level": 1, "text": "This week on site" },
                { "type": "paragraph", "text": "Two entries were written this week.", "tone": "strong" },
                { "type": "paragraph", "text": "Nothing was written on Friday." },
                { "type": "paragraph", "text": "Photos are not in this report.", "tone": "muted" },
                { "type": "heading", "level": 2, "text": "Readiness" },
                { "type": "figure", "label": "Readiness", "value": "3 of 5", "rows": ["Tiles chosen", "Plumber named"] },
                { "type": "rule" },
                { "type": "table",
                  "columns": [
                    { "text": "Activity", "align": "left", "width": 0.6 },
                    { "text": "Days", "align": "right", "width": 0.4 }
                  ],
                  "rows": [["Tiling", "4"], ["Grout", "1"]] },
                { "type": "gantt", "days": 5, "dayLabels": ["Mon", "Tue", "Wed", "Thu", "Fri"],
                  "rows": [
                    { "label": "Tiling", "start": 0, "length": 4, "critical": true, "baselineStart": 0, "baselineLength": 3 },
                    { "label": "Grout", "start": 4, "length": 1, "critical": false, "baselineStart": null, "baselineLength": null }
                  ] },
                { "type": "pageBreak" },
                { "type": "paragraph", "text": "After the break." }
            ]
        }))
        .expect("the wire shape the interface sends")
    }

    #[test]
    fn the_wire_shape_reads_into_the_model() {
        let document = every_block();
        assert_eq!(document.kind, ReportKind::Weekly);
        assert_eq!(document.page_size, PageSize::A4);
        assert_eq!(document.language, Language::En);
        assert_eq!(document.blocks.len(), 11);
        assert!(matches!(
            &document.blocks[3],
            Block::Paragraph {
                tone: Tone::Muted,
                ..
            }
        ));
        assert!(matches!(
            &document.blocks[2],
            Block::Paragraph {
                tone: Tone::Normal,
                ..
            }
        ));
        assert!(matches!(&document.blocks[9], Block::PageBreak));
        check(&document).expect("inside every limit");

        let landscape: PageSize = serde_json::from_str("\"a4-landscape\"").unwrap();
        assert_eq!(landscape, PageSize::A4Landscape);
        let portuguese: Language = serde_json::from_str("\"pt-BR\"").unwrap();
        assert_eq!(portuguese.tag(), "pt-BR");
        assert!(serde_json::from_str::<Language>("\"fr\"").is_err());
        assert!(serde_json::from_str::<ReportKind>("\"invoice\"").is_err());
    }

    fn refused(document: &ReportDocument) -> String {
        let error = check(document).unwrap_err();
        assert_eq!(error.kind(), "invalid_input");
        error.to_string()
    }

    fn with_blocks(blocks: Vec<Block>) -> ReportDocument {
        ReportDocument {
            blocks,
            ..every_block()
        }
    }

    fn paragraph(text: &str) -> Block {
        Block::Paragraph {
            text: text.into(),
            tone: Tone::Normal,
        }
    }

    #[test]
    fn every_limit_is_refused_with_a_sentence_and_the_limit_itself_is_accepted() {
        // Blocks.
        check(&with_blocks(vec![Block::Rule; MAX_BLOCKS])).expect("5000 blocks");
        assert_eq!(
            refused(&with_blocks(vec![Block::Rule; MAX_BLOCKS + 1])),
            "A report holds at most 5000 blocks; this one has 5001."
        );

        // Rows, across tables, figures and schedules together.
        let table = |rows: usize| Block::Table {
            columns: vec![Column {
                text: "#".into(),
                align: Align::Right,
                width: 1.0,
            }],
            rows: vec![vec!["1".into()]; rows],
        };
        check(&with_blocks(vec![table(MAX_ROWS)])).expect("20000 rows");
        let too_many =
            "A report holds at most 20000 rows in its tables, figures and schedules together.";
        assert_eq!(refused(&with_blocks(vec![table(MAX_ROWS + 1)])), too_many);
        let figure = Block::Figure {
            label: "Rows".into(),
            value: "1".into(),
            rows: vec!["one".into()],
        };
        assert_eq!(
            refused(&with_blocks(vec![table(MAX_ROWS), figure])),
            too_many
        );

        // Text.
        let longest = "x".repeat(MAX_TEXT_CHARS);
        check(&with_blocks(vec![paragraph(&longest)])).expect("2000 characters");
        let accents = "é".repeat(MAX_TEXT_CHARS);
        check(&with_blocks(vec![paragraph(&accents)])).expect("counted in characters, not bytes");
        let over = "x".repeat(MAX_TEXT_CHARS + 1);
        assert_eq!(
            refused(&with_blocks(vec![Block::Rule, paragraph(&over)])),
            "Block 2 has a text longer than 2000 characters; a report holds at most 2000 in one."
        );
        let mut cell = with_blocks(vec![table(1)]);
        if let Block::Table { rows, .. } = &mut cell.blocks[0] {
            rows[0][0] = over.clone();
        }
        assert!(refused(&cell).starts_with("Block 1 has a text longer"));
        let long_title = ReportDocument {
            title: over.clone(),
            ..every_block()
        };
        assert!(refused(&long_title).starts_with("The report has a text longer"));
        let no_title = ReportDocument {
            title: "  ".into(),
            ..every_block()
        };
        assert_eq!(refused(&no_title), "A report needs a title.");
    }

    #[test]
    fn a_block_that_does_not_fit_its_own_shape_is_refused_by_number() {
        let heading = Block::Heading {
            level: 3,
            text: "Deep".into(),
        };
        assert_eq!(
            refused(&with_blocks(vec![heading])),
            "Block 1 is a heading of level 3; a heading is level 1 or 2."
        );

        let ragged = Block::Table {
            columns: vec![
                Column {
                    text: "A".into(),
                    align: Align::Left,
                    width: 0.5,
                },
                Column {
                    text: "B".into(),
                    align: Align::Left,
                    width: 0.5,
                },
            ],
            rows: vec![vec!["a".into(), "b".into()], vec!["a".into()]],
        };
        assert_eq!(
            refused(&with_blocks(vec![ragged])),
            "Row 2 of block 1 has 1 cells; its table has 2 columns."
        );
        let no_columns = Block::Table {
            columns: vec![],
            rows: vec![],
        };
        assert!(refused(&with_blocks(vec![no_columns])).contains("1 to 16"));
        let zero_width = Block::Table {
            columns: vec![Column {
                text: "A".into(),
                align: Align::Left,
                width: 0.0,
            }],
            rows: vec![],
        };
        assert!(refused(&with_blocks(vec![zero_width])).contains("fraction"));

        let bar = |start: i64, length: i64, baseline: (Option<i64>, Option<i64>)| GanttRow {
            label: "Tiling".into(),
            start,
            length,
            critical: false,
            baseline_start: baseline.0,
            baseline_length: baseline.1,
        };
        let gantt = |days: i64, labels: usize, rows: Vec<GanttRow>| Block::Gantt {
            days,
            day_labels: vec![String::new(); labels],
            rows,
        };
        check(&with_blocks(vec![gantt(
            10,
            0,
            vec![bar(0, 10, (Some(-3), Some(20)))],
        )]))
        .expect("a baseline outside the days is drawn clipped");
        check(&with_blocks(vec![gantt(
            10,
            10,
            vec![bar(9, 0, (None, None))],
        )]))
        .expect("a milestone on the last day");
        for (block, words) in [
            (gantt(0, 0, vec![]), "over 0 days"),
            (gantt(MAX_GANTT_DAYS + 1, 0, vec![]), "1 to 3660"),
            (gantt(10, 3, vec![]), "3 day labels for 10 days"),
            (
                gantt(10, 0, vec![bar(8, 3, (None, None))]),
                "does not lie inside",
            ),
            (
                gantt(10, 0, vec![bar(-1, 3, (None, None))]),
                "does not lie inside",
            ),
            (gantt(10, 0, vec![bar(0, 3, (Some(1), None))]), "or neither"),
            (
                gantt(10, 0, vec![bar(0, 3, (Some(1), Some(-1)))]),
                "or neither",
            ),
        ] {
            let sentence = refused(&with_blocks(vec![block]));
            assert!(sentence.contains(words), "{sentence}");
        }
    }
}
