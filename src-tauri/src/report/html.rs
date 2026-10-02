//! The owner's snapshot (D4): the same document a report is, rendered as one
//! HTML page with nothing that runs and nothing loaded from anywhere.
//!
//! The interface composes a [`ReportDocument`] of kind `snapshot` in the
//! owner's words, as it composes the weekly report; the host renders it here —
//! pure, from the model and the photos `images::resolve_with` prepared under
//! [`SENT`] — and verifies the bytes ([`verify`]) before `commands::reports`
//! writes them. Sending the file is the person's act: the product sends
//! nothing.
//!
//! # The page
//!
//! - `<!DOCTYPE html>`, `<html lang="en|pt-BR">`, `<meta charset="utf-8">`
//!   first, then the Content-Security-Policy ([`CSP`]) — before anything it
//!   governs — the viewport, `color-scheme`, `referrer` and the moment the
//!   page was made; the title; one inline `<style>` ([`STYLE`]).
//! - A single readable column (42 rem at most), the system's own fonts, light
//!   and dark following the reader's phone (`prefers-color-scheme`) in the
//!   product's palette, print styles.
//! - Blocks, in order: a heading of level 1 or 2 is `<h2>` or `<h3>` (the
//!   title is the page's `<h1>`); a paragraph is `<p>`, its tone a class, its
//!   line breaks `<br>`; a figure is `<details><summary>label — value</summary>
//!   <ul>rows</ul></details>` — opening it needs no script — or, with no rows,
//!   the same line that opens onto nothing; a table is `<table>` inside a
//!   region that scrolls sideways on a phone; `rule` is `<hr>`; `pageBreak` is
//!   ignored; an image is `<figure><img src="data:image/jpeg;base64,…">` with
//!   its caption, two half images in a row side by side; a schedule is an
//!   inline `<svg>` of bars with each activity's label as text and a `<title>`
//!   per bar.
//!
//! # Escaping
//!
//! Every string of the document goes through [`escape`] — in text and in
//! attributes alike: `& < > " '` and also `/ : = @ ( \``, as character
//! references, which read the same on the page. So a hostile string cannot
//! become markup, and neither can it spell an address, a handler or a CSS
//! import for [`verify`] to find: what the verifier finds is the renderer's
//! own bug. Control characters are dropped.
//!
//! # Caps
//!
//! At most [`MAX_IMAGES`] image blocks — each embedded in full where it is
//! placed, so placements are counted —, at most [`MAX_IMAGE_BYTES`] of JPEG
//! data embedded, and a file of at most [`MAX_FILE_BYTES`]. Each is refused
//! with a sentence.

use base64::Engine as _;
use chrono::{DateTime, FixedOffset};

use crate::error::{Error, Result};
use crate::report::images::{Images, Setting};
use crate::report::model::{Align, Block, GanttRow, ImageSize, Language, ReportDocument, Tone};

/// The most image blocks a snapshot holds. Each is embedded where it is
/// placed — a page has no way to reuse one without a script —, so the same
/// photo placed twice counts twice.
pub const MAX_IMAGES: usize = 60;

/// The most JPEG data a snapshot embeds, counted where it is placed: 8 MiB,
/// about 10.7 MiB once written as base64.
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

/// The largest snapshot written: 12 MiB — something a messaging app still
/// takes.
pub const MAX_FILE_BYTES: u64 = 12 * 1024 * 1024;

/// The longest edge of a photo in a snapshot, in pixels.
pub const MAX_SIDE: u32 = 1024;

/// The JPEG quality a photo in a snapshot is encoded at.
pub const QUALITY: u8 = 78;

/// The sentence for a snapshot whose photos come to more than
/// [`MAX_IMAGE_BYTES`].
pub const TOO_MUCH_IMAGE_DATA: &str =
    "The photos of this snapshot come to more than 8 MiB; a snapshot holds at most 8 MiB of photos.";

/// How a snapshot's photos are prepared: 1 024 px, quality 78, **always
/// re-encoded** — not even a stripped original goes into a file meant to be
/// sent.
pub const SENT: Setting = Setting {
    max_side: MAX_SIDE,
    quality: QUALITY,
    pass_through: false,
    max_bytes: MAX_IMAGE_BYTES,
    too_much: TOO_MUCH_IMAGE_DATA,
};

/// The Content-Security-Policy the page carries, exactly: nothing loads but
/// the photos written into it and its own style; nothing runs.
pub const CSP: &str = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/// The CSP as the page writes it — the one `<meta http-equiv>` it holds.
const CSP_META: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">";

/// How an embedded photo begins.
const DATA_JPEG: &str = "data:image/jpeg;base64,";

/// The sentence for a snapshot with more than [`MAX_IMAGES`] image blocks.
fn too_many_images(count: usize) -> Error {
    Error::InvalidInput(format!(
        "A snapshot holds at most {MAX_IMAGES} photos; this one places {count}."
    ))
}

/// Check what only a snapshot limits, before any photo is read: the number
/// of image blocks.
///
/// # Errors
///
/// [`Error::InvalidInput`] past [`MAX_IMAGES`].
pub fn check(document: &ReportDocument) -> Result<()> {
    let placed = placements(&document.blocks).count();
    if placed > MAX_IMAGES {
        return Err(too_many_images(placed));
    }
    Ok(())
}

fn placements(blocks: &[Block]) -> impl Iterator<Item = &str> {
    blocks.iter().filter_map(|block| match block {
        Block::Image { hash, .. } => Some(hash.as_str()),
        _ => None,
    })
}

/// The JPEG data the page will embed: each placement in full.
pub fn embedded_bytes(document: &ReportDocument, images: &Images) -> usize {
    placements(&document.blocks)
        .filter_map(|hash| images.get(hash))
        .map(|image| image.jpeg.len())
        .sum()
}

/// Refuse a page whose photos, placed, come to more than [`MAX_IMAGE_BYTES`].
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`TOO_MUCH_IMAGE_DATA`].
pub fn check_image_data(document: &ReportDocument, images: &Images) -> Result<()> {
    check_image_data_within(document, images, MAX_IMAGE_BYTES)
}

/// [`check_image_data`] under another cap — so a test reaches it without
/// 8 MiB of photos.
pub(crate) fn check_image_data_within(
    document: &ReportDocument,
    images: &Images,
    max_bytes: usize,
) -> Result<()> {
    if embedded_bytes(document, images) > max_bytes {
        return Err(Error::InvalidInput(TOO_MUCH_IMAGE_DATA.into()));
    }
    Ok(())
}

/// A string made safe for HTML text and for a double-quoted attribute: the
/// five markup characters and `/ : = @ ( \`` as character references (they
/// read the same), control characters dropped, a line break kept as `\n`.
pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + value.len() / 8);
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            '/' => out.push_str("&#47;"),
            ':' => out.push_str("&#58;"),
            '=' => out.push_str("&#61;"),
            '@' => out.push_str("&#64;"),
            '(' => out.push_str("&#40;"),
            '`' => out.push_str("&#96;"),
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// One line: escaped, a line break read as a space.
fn line(value: &str) -> String {
    escape(value).replace(['\n', '\t'], " ")
}

/// Running text: escaped, a line break kept as `<br>`.
fn lines(value: &str) -> String {
    escape(value).replace('\t', " ").replace('\n', "<br>")
}

/// The inline style: the product's palette (DESIGN_SYSTEM.md,
/// `src/styles/tokens.css`) as hex, light first and dark by the reader's
/// setting; a single column; the system's fonts; tap targets of 44 px on what
/// opens; print styles.
pub const STYLE: &str = "\
:root{color-scheme:light dark;\
--bg:#fafafa;--card:#ffffff;--fg:#1a1a1a;--fg2:#424242;--fg3:#616161;\
--stroke:#d1d1d1;--subtle:#e5e5e5;--accent:#005fb8;--tint:#005fb81a}\
@media (prefers-color-scheme:dark){:root{\
--bg:#202020;--card:#2b2b2b;--fg:#ffffff;--fg2:#d6d6d6;--fg3:#adadad;\
--stroke:#545454;--subtle:#3d3d3d;--accent:#60cdff;--tint:#60cdff1f}}\
*{box-sizing:border-box}\
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}\
body{margin:0;background:var(--bg);color:var(--fg);\
font-family:'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,Roboto,'Helvetica Neue',Arial,sans-serif;\
font-size:1rem;line-height:1.5;overflow-wrap:anywhere}\
main{max-width:42rem;margin:0 auto;padding:1.5rem 1rem 3rem}\
header{margin-bottom:1.5rem}\
h1{font-size:1.75rem;line-height:1.25;margin:0 0 .25rem}\
h2{font-size:1.25rem;line-height:1.4;margin:2rem 0 .75rem}\
h3{font-size:1.0625rem;line-height:1.4;margin:1.5rem 0 .5rem}\
p{margin:0 0 .75rem}\
.subtitle,.muted{color:var(--fg3)}\
.strong{font-weight:600}\
hr{border:0;border-top:1px solid var(--stroke);margin:1.5rem 0}\
details,.figure{background:var(--card);border:1px solid var(--subtle);border-radius:8px;margin:0 0 .5rem}\
summary,.figure{display:list-item;list-style:none;min-height:2.75rem;padding:.625rem .875rem}\
summary{cursor:pointer;list-style:disclosure-closed inside}\
details[open] summary{list-style-type:disclosure-open;border-bottom:1px solid var(--subtle)}\
summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\
.value{font-weight:600}\
details ul{margin:0;padding:.5rem .875rem .75rem 2rem}\
details li{margin:.25rem 0}\
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 1rem;border:1px solid var(--subtle);border-radius:8px;background:var(--card)}\
.scroll:focus-visible{outline:2px solid var(--accent)}\
table{border-collapse:collapse;min-width:100%;font-size:.9375rem}\
th,td{padding:.5rem .75rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--subtle)}\
th{color:var(--fg2);font-weight:600;white-space:nowrap;background:var(--tint)}\
.r{text-align:right;font-variant-numeric:tabular-nums}\
figure{margin:0 0 1rem}\
img{display:block;max-width:100%;height:auto;border-radius:6px;background:var(--subtle)}\
figcaption{color:var(--fg3);font-size:.875rem;margin-top:.375rem}\
.pair{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin:0 0 1rem}\
.pair figure{margin:0}\
.gantt svg{display:block;overflow:visible}\
.gantt{padding:.5rem;border:1px solid var(--subtle);border-radius:8px;background:var(--card)}\
.grid{stroke:var(--subtle);stroke-width:1}\
.day{fill:var(--fg3);font-size:11px}\
.lbl{fill:var(--fg);font-size:13px}\
.bar{fill:var(--accent);stroke:var(--accent);stroke-width:1}\
.bar.open{fill:var(--card);stroke:var(--accent);stroke-width:1.5}\
.base{fill:var(--fg3)}\
@media print{\
:root{--bg:#ffffff;--card:#ffffff;--fg:#000000;--fg2:#000000;--fg3:#424242;--subtle:#d1d1d1;--accent:#000000;--tint:#f3f3f3}\
body{font-size:11pt}\
main{max-width:none;padding:0}\
summary{list-style:none}\
details::details-content{content-visibility:visible;display:block}\
.scroll{overflow:visible}\
details,figure,.gantt,tr{break-inside:avoid}\
h2,h3{break-after:avoid}}";

/// Render a checked document as the page, with the photos its image blocks
/// name already prepared under [`SENT`].
///
/// # Errors
///
/// [`Error::InvalidInput`] when an image block names a photo that was not
/// prepared — a bug, said as such.
pub fn render(
    document: &ReportDocument,
    images: &Images,
    created_at: &DateTime<FixedOffset>,
) -> Result<String> {
    let mut out = String::with_capacity(16 * 1024 + embedded_bytes(document, images) * 4 / 3);
    out.push_str("<!DOCTYPE html>\n<html lang=\"");
    out.push_str(document.language.tag());
    out.push_str("\">\n<head>\n<meta charset=\"utf-8\">\n");
    out.push_str(CSP_META);
    out.push_str("\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    out.push_str("<meta name=\"color-scheme\" content=\"light dark\">\n");
    out.push_str("<meta name=\"referrer\" content=\"no-referrer\">\n");
    out.push_str("<meta name=\"generator\" content=\"Ridgebeam\">\n");
    out.push_str("<meta name=\"dcterms.created\" content=\"");
    out.push_str(&escape(&created_at.to_rfc3339()));
    out.push_str("\">\n<title>");
    out.push_str(&line(&document.title));
    out.push_str("</title>\n<style>");
    out.push_str(STYLE);
    out.push_str("</style>\n</head>\n<body>\n<main>\n<header>\n<h1>");
    out.push_str(&line(&document.title));
    out.push_str("</h1>\n");
    if !document.subtitle.trim().is_empty() {
        out.push_str("<p class=\"subtitle\">");
        out.push_str(&lines(&document.subtitle));
        out.push_str("</p>\n");
    }
    out.push_str("</header>\n");

    let blocks = &document.blocks;
    let mut index = 0;
    while index < blocks.len() {
        match &blocks[index] {
            Block::Heading { level, text } => {
                let tag = if *level == 1 { "h2" } else { "h3" };
                out.push_str(&format!("<{tag}>{}</{tag}>\n", line(text)));
            }
            Block::Paragraph { text, tone } => {
                let class = match tone {
                    Tone::Normal => "",
                    Tone::Muted => " class=\"muted\"",
                    Tone::Strong => " class=\"strong\"",
                };
                out.push_str(&format!("<p{class}>{}</p>\n", lines(text)));
            }
            Block::Figure { label, value, rows } => figure(&mut out, label, value, rows),
            Block::Table { columns, rows } => {
                out.push_str("<div class=\"scroll\" tabindex=\"0\">\n<table>\n<thead><tr>");
                for column in columns {
                    out.push_str(&format!(
                        "<th{}>{}</th>",
                        align(column.align),
                        line(&column.text)
                    ));
                }
                out.push_str("</tr></thead>\n<tbody>\n");
                for row in rows {
                    out.push_str("<tr>");
                    for (cell, column) in row.iter().zip(columns) {
                        out.push_str(&format!("<td{}>{}</td>", align(column.align), lines(cell)));
                    }
                    out.push_str("</tr>\n");
                }
                out.push_str("</tbody>\n</table>\n</div>\n");
            }
            Block::Gantt {
                days,
                day_labels,
                rows,
            } => {
                out.push_str("<figure class=\"gantt\">\n");
                out.push_str(&gantt_svg(*days, day_labels, rows));
                out.push_str("</figure>\n");
            }
            Block::Rule => out.push_str("<hr>\n"),
            Block::PageBreak => {}
            Block::Image {
                size: ImageSize::Half,
                ..
            } => {
                // A run of half images, two to a row.
                let start = index;
                while index + 1 < blocks.len()
                    && matches!(
                        blocks[index + 1],
                        Block::Image {
                            size: ImageSize::Half,
                            ..
                        }
                    )
                {
                    index += 1;
                }
                out.push_str("<div class=\"pair\">\n");
                for block in &blocks[start..=index] {
                    if let Block::Image { hash, caption, .. } = block {
                        photo(&mut out, images, hash, caption, document.language)?;
                    }
                }
                out.push_str("</div>\n");
            }
            Block::Image { hash, caption, .. } => {
                photo(&mut out, images, hash, caption, document.language)?;
            }
        }
        index += 1;
    }
    out.push_str("</main>\n</body>\n</html>\n");
    Ok(out)
}

fn align(align: Align) -> &'static str {
    match align {
        Align::Left => "",
        Align::Right => " class=\"r\"",
    }
}

/// A figure: its line opens onto its rows; with no rows, the line alone.
fn figure(out: &mut String, label: &str, value: &str, rows: &[String]) {
    let head = format!(
        "<span class=\"label\">{}</span> — <span class=\"value\">{}</span>",
        line(label),
        line(value)
    );
    if rows.is_empty() {
        out.push_str(&format!("<div class=\"figure\">{head}</div>\n"));
        return;
    }
    out.push_str(&format!("<details>\n<summary>{head}</summary>\n<ul>\n"));
    for row in rows {
        out.push_str(&format!("<li>{}</li>\n", lines(row)));
    }
    out.push_str("</ul>\n</details>\n");
}

/// One photo, with its caption.
fn photo(
    out: &mut String,
    images: &Images,
    hash: &str,
    caption: &str,
    language: Language,
) -> Result<()> {
    let image = images.get(hash).ok_or_else(|| {
        Error::InvalidInput(
            "The snapshot was not written: a photo it names was not prepared. This is a bug in Ridgebeam, not in the work."
                .into(),
        )
    })?;
    let alt = if caption.trim().is_empty() {
        match language {
            Language::En => "Photo".to_string(),
            Language::PtBr => "Foto".to_string(),
        }
    } else {
        line(caption)
    };
    out.push_str("<figure>\n<img src=\"");
    out.push_str(DATA_JPEG);
    out.push_str(&base64::engine::general_purpose::STANDARD.encode(&image.jpeg));
    out.push_str(&format!(
        "\" alt=\"{alt}\" width=\"{}\" height=\"{}\">\n",
        image.width, image.height
    ));
    if !caption.trim().is_empty() {
        out.push_str(&format!("<figcaption>{}</figcaption>\n", lines(caption)));
    }
    out.push_str("</figure>\n");
    Ok(())
}

/// The day header's height, in pixels, when there are labels.
const GANTT_HEADER: f64 = 22.0;
/// One activity, in pixels: its label, then its bar.
const GANTT_ROW: f64 = 40.0;
/// How wide a milestone's mark is, in pixels — a mark, not nothing.
const GANTT_MARK: &str = "3";
/// The narrowest drawing the day labels are thinned for, in pixels: a phone.
const GANTT_NARROWEST: f64 = 320.0;
/// The most characters of a label drawn as text; the whole label is in the
/// bar's `<title>`.
const GANTT_LABEL_CHARS: usize = 72;
/// The most characters of a day label on the axis.
const GANTT_DAY_CHARS: usize = 12;

/// A number for an SVG attribute: at most two decimals, no trailing zeros.
fn number(value: f64) -> String {
    let text = format!("{value:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() || text == "-" {
        "0".into()
    } else {
        text.into()
    }
}

/// A share of the drawing's width, as an SVG percentage.
fn percent(part: i64, days: i64) -> String {
    format!("{}%", number(part as f64 * 100.0 / days as f64))
}

/// A schedule as an inline SVG, as wide as the column and drawn at the
/// reader's own size — positions along the days are percentages, the text is
/// in pixels, so a phone reads it as a desktop does. Day labels along the top
/// (thinned so that none touches the next on a phone), a faint line per day
/// when there are few enough to see, and per activity its label as text and
/// its bar — filled on the critical path, outlined otherwise, a milestone a
/// narrow mark — with the latest baseline as a thin line under it. Each bar
/// carries a `<title>`: the activity, and its first and last day by their
/// labels. The SVG is well-formed XML; it carries no namespace address, which
/// a page's own SVG does not need.
pub fn gantt_svg(days: i64, day_labels: &[String], rows: &[GanttRow]) -> String {
    let days = days.max(1);
    let header = if day_labels.is_empty() {
        0.0
    } else {
        GANTT_HEADER
    };
    let height = header + GANTT_ROW * rows.len() as f64 + 4.0;
    let mut svg = format!("<svg width=\"100%\" height=\"{}\">\n", number(height));

    if days <= 62 {
        for day in 0..=days {
            let x = percent(day, days);
            svg.push_str(&format!(
                "<line class=\"grid\" x1=\"{x}\" y1=\"0\" x2=\"{x}\" y2=\"{}\" />\n",
                number(height)
            ));
        }
    }
    if !day_labels.is_empty() {
        // A label every `step` days, so that none touches the next on the
        // narrowest drawing: about 6.5 px a character at 11 px, and a gap.
        let longest = day_labels
            .iter()
            .map(|label| label.trim().chars().count().min(GANTT_DAY_CHARS))
            .max()
            .unwrap_or(0) as f64;
        let cell = GANTT_NARROWEST / days as f64;
        let step = ((longest * 6.5 + 8.0) / cell).ceil().max(1.0) as usize;
        for (day, label) in day_labels.iter().enumerate() {
            if day % step != 0 || label.trim().is_empty() {
                continue;
            }
            svg.push_str(&format!(
                "<text class=\"day\" x=\"{}\" y=\"15\">{}</text>\n",
                percent(day as i64, days),
                line(&clip(label.trim(), GANTT_DAY_CHARS))
            ));
        }
    }

    for (n, row) in rows.iter().enumerate() {
        let top = header + GANTT_ROW * n as f64;
        svg.push_str("<g>\n");
        svg.push_str(&format!(
            "<text class=\"lbl\" x=\"2\" y=\"{}\">{}</text>\n",
            number(top + 15.0),
            line(&clip(&row.label, GANTT_LABEL_CHARS))
        ));
        let width = if row.length == 0 {
            GANTT_MARK.to_string()
        } else {
            percent(row.length, days)
        };
        let class = if row.critical { "bar" } else { "bar open" };
        svg.push_str(&format!(
            "<rect class=\"{class}\" x=\"{}\" y=\"{}\" width=\"{width}\" height=\"12\" rx=\"2\"><title>{}</title></rect>\n",
            percent(row.start, days),
            number(top + 21.0),
            line(&bar_title(row, day_labels))
        ));
        if let (Some(start), Some(length)) = (row.baseline_start, row.baseline_length) {
            let from = start.clamp(0, days);
            let to = start.saturating_add(length).clamp(0, days);
            if to > from || (length == 0 && (0..=days).contains(&start)) {
                let width = if to > from {
                    percent(to - from, days)
                } else {
                    GANTT_MARK.to_string()
                };
                svg.push_str(&format!(
                    "<rect class=\"base\" x=\"{}\" y=\"{}\" width=\"{width}\" height=\"3\" />\n",
                    percent(from, days),
                    number(top + 35.0),
                ));
            }
        }
        svg.push_str("</g>\n");
    }
    svg.push_str("</svg>\n");
    svg
}

/// At most `most` characters, an ellipsis when cut.
fn clip(text: &str, most: usize) -> String {
    if text.chars().count() <= most {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(most.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

/// What a bar's `<title>` says: the activity and, when the days are labelled,
/// its first and last day.
fn bar_title(row: &GanttRow, day_labels: &[String]) -> String {
    let day = |index: i64| {
        usize::try_from(index)
            .ok()
            .and_then(|index| day_labels.get(index))
            .map(|label| label.trim())
            .filter(|label| !label.is_empty())
    };
    let first = day(row.start);
    let last = day(row.start + row.length - 1);
    match (first, last) {
        (Some(first), Some(last)) if row.length > 1 && first != last => {
            format!("{} · {first} – {last}", row.label)
        }
        (Some(first), _) => format!("{} · {first}", row.label),
        _ => row.label.clone(),
    }
}

/// The sentence for a page the verifier refuses: the renderer's bug.
fn bug(what: &str) -> Error {
    Error::InvalidInput(format!(
        "The snapshot was not written: the page Ridgebeam made holds {what}, which a snapshot never carries. This is a bug in Ridgebeam, not in the work."
    ))
}

/// What the page may never hold, anywhere, in any case (after the CSP and the
/// embedded photos are set aside).
const FORBIDDEN: &[(&str, &str)] = &[
    ("<script", "a script"),
    ("javascript:", "a javascript: address"),
    ("vbscript:", "a vbscript: address"),
    ("http:", "an http: address"),
    ("https:", "an https: address"),
    ("//", "an address on the network (//)"),
    ("<iframe", "an iframe"),
    ("<object", "an object"),
    ("<embed", "an embed"),
    ("<link", "a link to another file"),
    ("<base", "a base address"),
    ("<form", "a form"),
    ("@import", "a CSS import"),
    ("url(", "a CSS url()"),
    ("expression(", "a CSS expression()"),
    ("data:", "a data: address that is not a JPEG photo"),
    ("<!--", "a comment"),
];

/// The elements the page is made of; any other is refused.
const ELEMENTS: &[&str] = &[
    "html",
    "head",
    "meta",
    "title",
    "style",
    "body",
    "main",
    "header",
    "h1",
    "h2",
    "h3",
    "p",
    "br",
    "span",
    "details",
    "summary",
    "ul",
    "li",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
    "figure",
    "figcaption",
    "img",
    "svg",
    "g",
    "line",
    "rect",
    "text",
];

/// The attributes the page's elements carry; any other — an event handler,
/// `style`, `href`, `srcset`, `http-equiv` past the CSP's — is refused.
const ATTRIBUTES: &[&str] = &[
    "lang", "charset", "name", "content", "class", "tabindex", "src", "alt", "width", "height",
    "x", "y", "x1", "y1", "x2", "y2", "rx",
];

/// Verify the page before it is written, on its own bytes — defence in depth
/// behind [`escape`]:
///
/// 1. it carries the exact [`CSP`] meta, once, before its `<style>` and its
///    `<body>`;
/// 2. the CSP, and every `src` that is `data:image/jpeg;base64,` and
///    base64, are set aside — any other `src` is refused in 4;
/// 3. what remains holds none of [`FORBIDDEN`], in any case, and no `on…=`
///    attribute;
/// 4. it is made only of [`ELEMENTS`] carrying [`ATTRIBUTES`], each value in
///    double quotes, after `<!DOCTYPE html>`, no `>` outside a tag, no `<` in
///    its style.
///
/// # Errors
///
/// [`Error::InvalidInput`] naming what was found: a bug, said as such.
pub fn verify(page: &str) -> Result<()> {
    // 1. The policy, before what it governs.
    if page.matches(CSP_META).count() != 1 {
        return Err(bug("no Content-Security-Policy, or more than one"));
    }
    let policy = page.find(CSP_META).unwrap_or(usize::MAX);
    let before = |needle: &str| page.find(needle).is_none_or(|at| policy < at);
    if !before("<style") || !before("<body") || !before("<img") || !before("<svg") {
        return Err(bug("a Content-Security-Policy after what it governs"));
    }
    let mut rest = page.replacen(CSP_META, "", 1);

    // 2. The photos: a JPEG data address in base64, set aside — its value
    //    emptied, so that a `src` with anything left in it is found below.
    let mut cleaned = String::with_capacity(rest.len());
    let mut tail = rest.as_str();
    while let Some(at) = tail.find("src=\"") {
        let (head, from) = tail.split_at(at + "src=\"".len());
        cleaned.push_str(head);
        tail = from;
        let Some(data) = from.strip_prefix(DATA_JPEG) else {
            continue;
        };
        let end = data
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='))
            .unwrap_or(data.len());
        if end > 0 && data[end..].starts_with('"') {
            tail = &data[end..];
        }
    }
    cleaned.push_str(tail);
    rest = cleaned;

    // 3. Nothing that loads or runs, in any case.
    let lower = rest.to_ascii_lowercase();
    for (needle, what) in FORBIDDEN {
        if lower.contains(needle) {
            return Err(bug(what));
        }
    }
    if let Some(handler) = event_handler(&lower) {
        return Err(bug(&format!("an event handler ({handler}=)")));
    }

    // 4. Only the page's own elements and attributes.
    structure(&lower)
}

/// The first `on…=` attribute — `on` after anything but a letter or a digit,
/// letters, optional spaces, `=`.
fn event_handler(lower: &str) -> Option<String> {
    let bytes = lower.as_bytes();
    let mut from = 0;
    while let Some(found) = lower[from..].find("on") {
        let at = from + found;
        from = at + 2;
        if at > 0 && bytes[at - 1].is_ascii_alphanumeric() {
            continue;
        }
        let mut end = at + 2;
        while end < bytes.len() && bytes[end].is_ascii_alphabetic() {
            end += 1;
        }
        if end == at + 2 {
            continue;
        }
        let mut after = end;
        while after < bytes.len() && bytes[after].is_ascii_whitespace() {
            after += 1;
        }
        if bytes.get(after) == Some(&b'=') {
            return Some(lower[at..end].to_string());
        }
    }
    None
}

/// Walk the page's tags: the doctype first, then only allowed elements with
/// allowed, double-quoted attributes; `<style>`'s text is read to its end tag.
fn structure(lower: &str) -> Result<()> {
    let Some(mut rest) = lower.strip_prefix("<!doctype html>") else {
        return Err(bug("no <!DOCTYPE html> at its start"));
    };
    while let Some(at) = rest.find(['<', '>']) {
        if rest.as_bytes()[at] == b'>' {
            return Err(bug("a > outside a tag"));
        }
        rest = &rest[at + 1..];
        let closing = rest.starts_with('/');
        if closing {
            rest = &rest[1..];
        }
        let name_end = rest
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(rest.len());
        let name = &rest[..name_end];
        if !ELEMENTS.contains(&name) {
            return Err(bug(&format!(
                "an element <{}> it is not made of",
                clip(name, 20)
            )));
        }
        rest = &rest[name_end..];
        loop {
            let trimmed = rest.trim_start();
            let spaced = trimmed.len() != rest.len();
            rest = trimmed;
            if let Some(after) = rest.strip_prefix('>') {
                rest = after;
                break;
            }
            if let Some(after) = rest.strip_prefix("/>") {
                rest = after;
                break;
            }
            if closing || !spaced {
                return Err(bug(&format!("a malformed <{name}> tag")));
            }
            let attribute_end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '.'))
                .unwrap_or(rest.len());
            let attribute = &rest[..attribute_end];
            if !ATTRIBUTES.contains(&attribute) {
                return Err(bug(&format!(
                    "an attribute {} it does not use",
                    clip(attribute, 20)
                )));
            }
            rest = &rest[attribute_end..];
            let Some(value) = rest.strip_prefix("=\"") else {
                return Err(bug(&format!(
                    "an attribute {attribute} without a quoted value"
                )));
            };
            let Some(end) = value.find(['"', '<', '>']) else {
                return Err(bug(&format!("a malformed <{name}> tag")));
            };
            if value.as_bytes()[end] != b'"' {
                return Err(bug(&format!("a malformed <{name}> tag")));
            }
            if attribute == "src" && end != 0 {
                return Err(bug("an image that is not a JPEG written into the page"));
            }
            rest = &value[end + 1..];
        }
        if name == "style" && !closing {
            let Some(end) = rest.find("</style>") else {
                return Err(bug("a style that does not end"));
            };
            if rest[..end].contains('<') {
                return Err(bug("markup inside its style"));
            }
            rest = &rest[end..];
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "html_tests.rs"]
mod tests;
