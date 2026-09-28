//! A document laid out: blocks in, positioned marks per page out. Pure — no
//! PDF, no file, no clock — so the whole of pagination is tested here without a
//! writer (`report::pdf` only serialises what this decides).
//!
//! The page is A4, portrait or landscape, with 20 mm margins. Text is set in
//! Helvetica and Helvetica-Bold and wrapped by the faces' real widths
//! (`report::winansi`). A table that runs past a page breaks there and repeats
//! its header; a row too tall for a whole page is split between pages. A
//! printed schedule draws bars on a day grid, breaks the same way repeating its
//! day header, and is scaled to the page's width however many days it runs
//! over, its day labels thinned to every Nth. Every page carries a footer —
//! "Ridgebeam · {title} · page N of M" in the document's language — in the
//! bottom margin.
//!
//! Coordinates are PDF points from the bottom-left corner of the page; a text
//! mark's `y` is its baseline.

use crate::report::model::{Align, Block, Column, GanttRow, Language, PageSize, Tone};
use crate::report::winansi::{encode, encode_line, width, Face};

/// Points in a millimetre.
pub const PT_PER_MM: f32 = 72.0 / 25.4;

/// The margin on every side: 20 mm.
pub const MARGIN: f32 = 20.0 * PT_PER_MM;

/// A4's short side, in points.
const A4_SHORT: f32 = 210.0 * PT_PER_MM;

/// A4's long side, in points.
const A4_LONG: f32 = 297.0 * PT_PER_MM;

const TITLE_SIZE: f32 = 18.0;
const SUBTITLE_SIZE: f32 = 11.0;
const BODY_SIZE: f32 = 10.0;
const SMALL_SIZE: f32 = 9.0;
const GANTT_LABEL_SIZE: f32 = 8.0;
const DAY_LABEL_SIZE: f32 = 6.5;
const FOOTER_SIZE: f32 = 8.0;
const LEADING: f32 = 1.3;
const CELL_PAD_X: f32 = 3.0;
const CELL_PAD_Y: f32 = 2.5;
const GANTT_ROW: f32 = 14.0;
const GANTT_HEADER: f32 = 12.0;
/// The widest a day column is drawn: a short plan does not fill the page with
/// three enormous days.
const MAX_DAY_WIDTH: f32 = 24.0;

const BLACK: f32 = 0.0;
const MUTED: f32 = 0.4;
const HAIRLINE: f32 = 0.75;

/// Something drawn on a page.
#[derive(Debug, Clone, PartialEq)]
pub enum Mark {
    /// A run of text on one line.
    Text {
        /// Left edge.
        x: f32,
        /// Baseline.
        y: f32,
        /// Font size, in points.
        size: f32,
        /// Which face.
        face: Face,
        /// Grey level, 0 black to 1 white.
        gray: f32,
        /// WinAnsi bytes; never a line break.
        bytes: Vec<u8>,
    },
    /// A straight line.
    Line {
        /// Start.
        x1: f32,
        /// Start.
        y1: f32,
        /// End.
        x2: f32,
        /// End.
        y2: f32,
        /// Stroke width.
        width: f32,
        /// Grey level.
        gray: f32,
    },
    /// A rectangle, filled, outlined, or both.
    Rect {
        /// Left edge.
        x: f32,
        /// Bottom edge.
        y: f32,
        /// Width.
        width: f32,
        /// Height.
        height: f32,
        /// The fill's grey level, or none.
        fill: Option<f32>,
        /// The outline's grey level, or none.
        stroke: Option<f32>,
    },
}

/// One page, laid out.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    /// Width, in points.
    pub width: f32,
    /// Height, in points.
    pub height: f32,
    /// What is drawn on it, in order.
    pub marks: Vec<Mark>,
}

impl Page {
    /// The text on the page, one line per text mark, read back to Unicode.
    pub fn lines(&self) -> Vec<String> {
        self.marks
            .iter()
            .filter_map(|mark| match mark {
                Mark::Text { bytes, .. } => Some(crate::report::winansi::decode(bytes)),
                _ => None,
            })
            .collect()
    }
}

/// The paper's width and height, in points.
pub fn paper(size: PageSize) -> (f32, f32) {
    match size {
        PageSize::A4 => (A4_SHORT, A4_LONG),
        PageSize::A4Landscape => (A4_LONG, A4_SHORT),
    }
}

/// The footer of page `n` of `m`, in the document's language:
/// "Ridgebeam · {title} · page N of M".
pub fn footer(language: Language, title: &str, n: usize, m: usize) -> String {
    let (before, after) = footer_around(language, n, m);
    format!("{before}{title}{after}")
}

/// The footer's words before and after the title.
fn footer_around(language: Language, n: usize, m: usize) -> (&'static str, String) {
    match language {
        Language::En => ("Ridgebeam · ", format!(" · page {n} of {m}")),
        Language::PtBr => ("Ridgebeam · ", format!(" · página {n} de {m}")),
    }
}

/// Break `bytes` into lines no wider than `max` points: at spaces where it
/// can, inside a word only when the word alone is wider than the line; at
/// every line break. An empty text is one empty line.
pub fn wrap(bytes: &[u8], face: Face, size: f32, max: f32) -> Vec<Vec<u8>> {
    let mut lines = Vec::new();
    for paragraph in bytes.split(|&b| b == b'\n') {
        let mut line: Vec<u8> = Vec::new();
        for word in paragraph.split(|&b| b == b' ').filter(|w| !w.is_empty()) {
            let candidate_width = if line.is_empty() {
                width(word, face, size)
            } else {
                width(&line, face, size) + width(b" ", face, size) + width(word, face, size)
            };
            if candidate_width <= max {
                if !line.is_empty() {
                    line.push(b' ');
                }
                line.extend_from_slice(word);
                continue;
            }
            if !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            // A word wider than the line is broken where it must be.
            for &byte in word {
                if !line.is_empty() && width(&line, face, size) + width(&[byte], face, size) > max {
                    lines.push(std::mem::take(&mut line));
                }
                line.push(byte);
            }
        }
        lines.push(line);
    }
    lines
}

/// `bytes` cut to fit `max` points, ending in an ellipsis when cut.
fn fit(bytes: &[u8], face: Face, size: f32, max: f32) -> Vec<u8> {
    if width(bytes, face, size) <= max {
        return bytes.to_vec();
    }
    const ELLIPSIS: u8 = 0x85;
    let room = max - width(&[ELLIPSIS], face, size);
    let mut cut = Vec::new();
    for &byte in bytes {
        if width(&cut, face, size) + width(&[byte], face, size) > room {
            break;
        }
        cut.push(byte);
    }
    while cut.last() == Some(&b' ') {
        cut.pop();
    }
    cut.push(ELLIPSIS);
    cut
}

/// The layout under way: the pages so far and where the next line goes.
struct Writer {
    width: f32,
    height: f32,
    pages: Vec<Page>,
    /// The top of the next line box.
    y: f32,
}

impl Writer {
    fn new(size: PageSize) -> Self {
        let (width, height) = paper(size);
        let mut writer = Writer {
            width,
            height,
            pages: Vec::new(),
            y: 0.0,
        };
        writer.new_page();
        writer
    }

    fn left(&self) -> f32 {
        MARGIN
    }

    fn right(&self) -> f32 {
        self.width - MARGIN
    }

    fn content_width(&self) -> f32 {
        self.right() - self.left()
    }

    fn top(&self) -> f32 {
        self.height - MARGIN
    }

    fn bottom(&self) -> f32 {
        MARGIN
    }

    /// The height of a whole page's content area.
    fn capacity(&self) -> f32 {
        self.top() - self.bottom()
    }

    fn new_page(&mut self) {
        self.pages.push(Page {
            width: self.width,
            height: self.height,
            marks: Vec::new(),
        });
        self.y = self.top();
    }

    fn at_top(&self) -> bool {
        self.y >= self.top() - 0.001
    }

    fn room(&self) -> f32 {
        self.y - self.bottom()
    }

    /// Start a page unless `height` fits on this one — or this one is empty,
    /// where nothing would be gained.
    fn need(&mut self, height: f32) {
        if self.room() < height - 0.001 && !self.at_top() {
            self.new_page();
        }
    }

    fn mark(&mut self, mark: Mark) {
        self.pages
            .last_mut()
            .expect("a writer always has a page")
            .marks
            .push(mark);
    }

    fn text(&mut self, x: f32, y: f32, size: f32, face: Face, gray: f32, bytes: Vec<u8>) {
        if bytes.is_empty() {
            return;
        }
        self.mark(Mark::Text {
            x,
            y,
            size,
            face,
            gray,
            bytes,
        });
    }

    fn hline(&mut self, y: f32, width: f32, gray: f32) {
        let (x1, x2) = (self.left(), self.right());
        self.mark(Mark::Line {
            x1,
            y1: y,
            x2,
            y2: y,
            width,
            gray,
        });
    }

    /// Wrapped text at `indent` from the left, one line at a time, breaking
    /// pages between lines. `first` prefixes the first line (a bullet) and the
    /// rest hang under the text.
    fn lines(
        &mut self,
        bytes: &[u8],
        face: Face,
        size: f32,
        gray: f32,
        indent: f32,
        first: Option<&[u8]>,
    ) {
        let leading = size * LEADING;
        let hang = first.map_or(0.0, |prefix| width(prefix, face, size));
        let max = self.content_width() - indent - hang;
        for (index, line) in wrap(bytes, face, size, max).into_iter().enumerate() {
            self.need(leading);
            let baseline = self.y - size;
            let x = self.left() + indent;
            match (index, first) {
                (0, Some(prefix)) => {
                    let mut with_prefix = prefix.to_vec();
                    with_prefix.extend_from_slice(&line);
                    self.text(x, baseline, size, face, gray, with_prefix);
                }
                _ => self.text(x + hang, baseline, size, face, gray, line),
            }
            self.y -= leading;
        }
    }

    fn title(&mut self, title: &str, subtitle: &str) {
        self.lines(&encode(title), Face::Bold, TITLE_SIZE, BLACK, 0.0, None);
        if !subtitle.trim().is_empty() {
            self.y -= 2.0;
            self.lines(
                &encode(subtitle),
                Face::Regular,
                SUBTITLE_SIZE,
                MUTED,
                0.0,
                None,
            );
        }
        self.y -= 10.0;
    }

    fn heading(&mut self, level: u8, text: &str) {
        let (size, before, after) = if level == 1 {
            (14.0, 12.0, 4.0)
        } else {
            (12.0, 8.0, 3.0)
        };
        // Kept with what follows: a heading alone at the foot of a page is not
        // left there.
        self.need(before + size * LEADING + 2.0 * BODY_SIZE * LEADING);
        if !self.at_top() {
            self.y -= before;
        }
        self.lines(&encode(text), Face::Bold, size, BLACK, 0.0, None);
        self.y -= after;
    }

    fn paragraph(&mut self, text: &str, tone: Tone) {
        let (face, gray) = match tone {
            Tone::Normal => (Face::Regular, BLACK),
            Tone::Muted => (Face::Regular, MUTED),
            Tone::Strong => (Face::Bold, BLACK),
        };
        self.lines(&encode(text), face, BODY_SIZE, gray, 0.0, None);
        self.y -= 6.0;
    }

    fn figure(&mut self, label: &str, value: &str, rows: &[String]) {
        let leading = BODY_SIZE * LEADING;
        // The value on the right, the label on the left; a value longer than
        // most of the line wraps too, and never runs past the margin.
        let values = wrap(
            &encode_line(value),
            Face::Bold,
            BODY_SIZE,
            self.content_width() * 0.6,
        );
        let value_width = values
            .iter()
            .map(|line| width(line, Face::Bold, BODY_SIZE))
            .fold(0.0f32, f32::max);
        let label_max = self.content_width() - value_width - 12.0;
        let labels = wrap(&encode(label), Face::Regular, BODY_SIZE, label_max);
        let count = labels.len().max(values.len());
        self.need(leading * (count as f32 + rows.len().min(1) as f32));
        for index in 0..count {
            self.need(leading);
            let baseline = self.y - BODY_SIZE;
            if let Some(line) = labels.get(index) {
                self.text(
                    self.left(),
                    baseline,
                    BODY_SIZE,
                    Face::Regular,
                    BLACK,
                    line.clone(),
                );
            }
            if let Some(line) = values.get(index) {
                let x = self.right() - width(line, Face::Bold, BODY_SIZE);
                self.text(x, baseline, BODY_SIZE, Face::Bold, BLACK, line.clone());
            }
            self.y -= leading;
        }
        const BULLET: &[u8] = &[0x95, b' '];
        for row in rows {
            self.lines(
                &encode(row),
                Face::Regular,
                SMALL_SIZE,
                BLACK,
                12.0,
                Some(BULLET),
            );
        }
        self.y -= 8.0;
    }

    fn rule(&mut self) {
        self.need(12.0);
        if !self.at_top() {
            self.y -= 6.0;
            let y = self.y;
            self.hline(y, 0.5, 0.6);
            self.y -= 6.0;
        }
    }

    fn table(&mut self, columns: &[Column], rows: &[Vec<String>]) {
        let total: f64 = columns.iter().map(|c| c.width).sum();
        let full = self.content_width();
        let mut edges = Vec::with_capacity(columns.len() + 1);
        let mut x = self.left();
        edges.push(x);
        for column in columns {
            x += (column.width / total) as f32 * full;
            edges.push(x);
        }
        let leading = SMALL_SIZE * LEADING;
        let cell_lines = |cells: &[&str], face: Face| -> Vec<Vec<Vec<u8>>> {
            cells
                .iter()
                .enumerate()
                .map(|(c, cell)| {
                    let max = (edges[c + 1] - edges[c] - 2.0 * CELL_PAD_X).max(1.0);
                    wrap(&encode(cell), face, SMALL_SIZE, max)
                })
                .collect()
        };
        let header_texts: Vec<&str> = columns.iter().map(|c| c.text.as_str()).collect();
        // A header is at most a third of a page, so every page it repeats on
        // has room for rows: a heading longer than that is cut.
        let most = ((self.capacity() / 3.0 - 2.0 * CELL_PAD_Y) / leading)
            .floor()
            .max(1.0) as usize;
        let header: Vec<Vec<Vec<u8>>> = cell_lines(&header_texts, Face::Bold)
            .into_iter()
            .map(|lines| lines.into_iter().take(most).collect())
            .collect();
        let header_height = height_of(&header, leading);
        let aligns: Vec<Align> = columns.iter().map(|c| c.align).collect();

        let draw_header = |writer: &mut Writer| {
            writer.draw_cells(&edges, &aligns, &header, 0, usize::MAX, Face::Bold, leading);
            let y = writer.y;
            writer.hline(y, 0.8, BLACK);
        };

        let first_row = rows
            .first()
            .map(|row| {
                let cells: Vec<&str> = row.iter().map(String::as_str).collect();
                height_of(&cell_lines(&cells, Face::Regular), leading)
            })
            .unwrap_or(0.0);
        self.need(header_height + first_row.min(self.capacity() - header_height));
        draw_header(self);

        for row in rows {
            let cells: Vec<&str> = row.iter().map(String::as_str).collect();
            let lines = cell_lines(&cells, Face::Regular);
            let count = lines.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let mut from = 0;
            loop {
                let left = count - from;
                let height = left as f32 * leading + 2.0 * CELL_PAD_Y;
                if self.room() >= height - 0.001 {
                    self.draw_cells(&edges, &aligns, &lines, from, left, Face::Regular, leading);
                    let y = self.y;
                    self.hline(y, 0.3, HAIRLINE);
                    break;
                }
                let fits_whole_page = height <= self.capacity() - header_height;
                let fitting = ((self.room() - 2.0 * CELL_PAD_Y) / leading).floor();
                if (from == 0 && fits_whole_page) || fitting < 1.0 {
                    self.new_page();
                    draw_header(self);
                    continue;
                }
                let fitting = fitting as usize;
                self.draw_cells(
                    &edges,
                    &aligns,
                    &lines,
                    from,
                    fitting,
                    Face::Regular,
                    leading,
                );
                from += fitting;
                self.new_page();
                draw_header(self);
            }
        }
        self.y -= 8.0;
    }

    /// Lines `from..from + count` of every cell, as one row band; moves the
    /// cursor under it.
    #[allow(clippy::too_many_arguments)]
    fn draw_cells(
        &mut self,
        edges: &[f32],
        aligns: &[Align],
        cells: &[Vec<Vec<u8>>],
        from: usize,
        count: usize,
        face: Face,
        leading: f32,
    ) {
        let shown = cells
            .iter()
            .map(|lines| lines.len().saturating_sub(from).min(count))
            .max()
            .unwrap_or(0)
            .max(1);
        let top = self.y - CELL_PAD_Y;
        for (c, lines) in cells.iter().enumerate() {
            for (i, line) in lines.iter().skip(from).take(count).enumerate() {
                let baseline = top - i as f32 * leading - SMALL_SIZE;
                let x = match aligns[c] {
                    Align::Left => edges[c] + CELL_PAD_X,
                    Align::Right => edges[c + 1] - CELL_PAD_X - width(line, face, SMALL_SIZE),
                };
                self.text(x, baseline, SMALL_SIZE, face, BLACK, line.clone());
            }
        }
        self.y -= shown as f32 * leading + 2.0 * CELL_PAD_Y;
    }

    fn gantt(&mut self, days: i64, day_labels: &[String], rows: &[GanttRow]) {
        let label_width = (self.content_width() * 0.28).min(220.0);
        let grid_left = self.left() + label_width + 6.0;
        let day_width = ((self.right() - grid_left) / days as f32).min(MAX_DAY_WIDTH);
        let grid_right = grid_left + day_width * days as f32;
        let labels: Vec<Vec<u8>> = day_labels.iter().map(|l| encode_line(l)).collect();
        let widest = labels
            .iter()
            .map(|l| width(l, Face::Regular, DAY_LABEL_SIZE))
            .fold(0.0f32, f32::max);
        let every = every_nth(widest, day_width);

        let draw_header = |writer: &mut Writer| {
            let top = writer.y;
            let baseline = top - 8.5;
            for (index, label) in labels.iter().enumerate() {
                if index % every != 0 {
                    continue;
                }
                let x = grid_left + index as f32 * day_width;
                // A label that would run past the page is left out, as a
                // thinned one is.
                if x + 1.0 + width(label, Face::Regular, DAY_LABEL_SIZE) > writer.right() {
                    continue;
                }
                writer.mark(Mark::Line {
                    x1: x,
                    y1: top,
                    x2: x,
                    y2: top - GANTT_HEADER,
                    width: 0.3,
                    gray: HAIRLINE,
                });
                writer.text(
                    x + 1.0,
                    baseline,
                    DAY_LABEL_SIZE,
                    Face::Regular,
                    MUTED,
                    label.clone(),
                );
            }
            writer.y -= GANTT_HEADER;
            let y = writer.y;
            writer.hline(y, 0.8, BLACK);
        };

        self.need(GANTT_HEADER + GANTT_ROW);
        draw_header(self);
        for row in rows {
            if self.room() < GANTT_ROW - 0.001 {
                self.new_page();
                draw_header(self);
            }
            let top = self.y;
            let label = fit(
                &encode_line(&row.label),
                Face::Regular,
                GANTT_LABEL_SIZE,
                label_width,
            );
            self.text(
                self.left(),
                top - 9.5,
                GANTT_LABEL_SIZE,
                Face::Regular,
                BLACK,
                label,
            );
            // A bar too short to see is drawn 1.5 pt wide, and kept on the page.
            let bar_width = (row.length as f32 * day_width).max(1.5);
            let x = (grid_left + row.start as f32 * day_width).min(grid_right - bar_width);
            let (fill, stroke) = if row.critical {
                (Some(0.15), None)
            } else {
                (None, Some(0.15))
            };
            self.mark(Mark::Rect {
                x,
                y: top - 9.0,
                width: bar_width,
                height: 6.0,
                fill,
                stroke,
            });
            if let (Some(start), Some(length)) = (row.baseline_start, row.baseline_length) {
                let from = start.clamp(0, days);
                let to = (start + length).clamp(0, days);
                if to > from || (length == 0 && (0..=days).contains(&start)) {
                    let line_width = ((to - from) as f32 * day_width).max(1.5);
                    self.mark(Mark::Rect {
                        x: (grid_left + from as f32 * day_width).min(grid_right - line_width),
                        y: top - 12.5,
                        width: line_width,
                        height: 1.6,
                        fill: Some(0.55),
                        stroke: None,
                    });
                }
            }
            self.y -= GANTT_ROW;
            let y = self.y;
            self.hline(y, 0.3, HAIRLINE);
        }
        self.y -= 8.0;
    }

    fn page_break(&mut self) {
        if !self.at_top() {
            self.new_page();
        }
    }

    /// Every page's footer, now that their number is known.
    fn footers(&mut self, language: Language, title: &str) {
        let count = self.pages.len();
        let max = self.content_width();
        let title_line = encode_line(title);
        for (index, page) in self.pages.iter_mut().enumerate() {
            let (before, after) = footer_around(language, index + 1, count);
            let (before, after) = (encode_line(before), encode_line(&after));
            // A long title is cut, never the page number.
            let room = max
                - width(&before, Face::Regular, FOOTER_SIZE)
                - width(&after, Face::Regular, FOOTER_SIZE);
            let mut bytes = before;
            bytes.extend(fit(&title_line, Face::Regular, FOOTER_SIZE, room));
            bytes.extend(after);
            page.marks.push(Mark::Text {
                x: MARGIN,
                y: MARGIN / 2.0,
                size: FOOTER_SIZE,
                face: Face::Regular,
                gray: MUTED,
                bytes,
            });
        }
    }
}

/// The height of a band of cells.
fn height_of(cells: &[Vec<Vec<u8>>], leading: f32) -> f32 {
    let count = cells.iter().map(Vec::len).max().unwrap_or(1).max(1);
    count as f32 * leading + 2.0 * CELL_PAD_Y
}

/// Label every Nth day column so that no two labels touch: the smallest N
/// whose span is wider than the widest label and a little air.
pub fn every_nth(widest_label: f32, day_width: f32) -> usize {
    if widest_label <= 0.0 {
        return 1;
    }
    let every = ((widest_label + 2.0) / day_width).ceil();
    if every.is_finite() && every >= 1.0 {
        every as usize
    } else {
        1
    }
}

/// Lay a document out: its title and subtitle, then `blocks` in order, then
/// every page's footer. `blocks` is the document's own, or those with the
/// host's verification block in front (the diary).
pub fn lay_out(
    title: &str,
    subtitle: &str,
    size: PageSize,
    language: Language,
    blocks: &[Block],
) -> Vec<Page> {
    let mut writer = Writer::new(size);
    writer.title(title, subtitle);
    for block in blocks {
        match block {
            Block::Heading { level, text } => writer.heading(*level, text),
            Block::Paragraph { text, tone } => writer.paragraph(text, *tone),
            Block::Figure { label, value, rows } => writer.figure(label, value, rows),
            Block::Table { columns, rows } => writer.table(columns, rows),
            Block::Gantt {
                days,
                day_labels,
                rows,
            } => writer.gantt(*days, day_labels, rows),
            Block::Rule => writer.rule(),
            Block::PageBreak => writer.page_break(),
        }
    }
    writer.footers(language, title);
    writer.pages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::tests::every_block;
    use crate::report::model::ReportDocument;

    fn laid(document: &ReportDocument) -> Vec<Page> {
        lay_out(
            &document.title,
            &document.subtitle,
            document.page_size,
            document.language,
            &document.blocks,
        )
    }

    fn texts(page: &Page) -> Vec<&Mark> {
        page.marks
            .iter()
            .filter(|m| matches!(m, Mark::Text { .. }))
            .collect()
    }

    /// Every mark lies on the paper, and every text mark inside the margins
    /// but the footer's.
    fn inside_the_margins(pages: &[Page]) {
        for (p, page) in pages.iter().enumerate() {
            for mark in &page.marks {
                if let Mark::Text {
                    x,
                    y,
                    size,
                    face,
                    bytes,
                    ..
                } = mark
                {
                    let right = x + width(bytes, *face, *size);
                    assert!(
                        *x >= MARGIN - 0.01 && right <= page.width - MARGIN + 0.01,
                        "page {}: {:?} runs from {x} to {right}",
                        p + 1,
                        crate::report::winansi::decode(bytes)
                    );
                    let footer = (*y - MARGIN / 2.0).abs() < 0.01;
                    assert!(
                        footer || (*y >= MARGIN - 0.01 && *y <= page.height - MARGIN),
                        "page {}: {:?} at y {y}",
                        p + 1,
                        crate::report::winansi::decode(bytes)
                    );
                }
            }
        }
    }

    #[test]
    fn a_line_wraps_at_spaces_by_the_real_widths_and_a_long_word_is_broken() {
        let text = encode("the quick brown fox jumps over the lazy dog");
        let max = width(b"the quick brown fox", Face::Regular, 10.0);
        let lines = wrap(&text, Face::Regular, 10.0, max);
        assert_eq!(
            lines,
            vec![
                b"the quick brown fox".to_vec(),
                b"jumps over the lazy".to_vec(),
                b"dog".to_vec()
            ]
        );
        for line in &lines {
            assert!(width(line, Face::Regular, 10.0) <= max);
        }
        let bold = wrap(&text, Face::Bold, 10.0, max);
        assert!(
            bold[0].len() < lines[0].len(),
            "bold is wider, so the same line holds fewer words"
        );
        for line in &bold {
            assert!(width(line, Face::Bold, 10.0) <= max);
        }

        let word = wrap(b"iiiiiiiiiiWWWWWWWWWW", Face::Regular, 10.0, 30.0);
        assert!(word.len() > 1);
        assert_eq!(word.concat(), b"iiiiiiiiiiWWWWWWWWWW".to_vec());
        for line in &word {
            assert!(width(line, Face::Regular, 10.0) <= 30.0);
        }
        assert_eq!(
            wrap(b"one\ntwo", Face::Regular, 10.0, 500.0),
            vec![b"one".to_vec(), b"two".to_vec()]
        );
        assert_eq!(
            wrap(b"", Face::Regular, 10.0, 500.0),
            vec![Vec::<u8>::new()]
        );
    }

    #[test]
    fn every_block_is_laid_out_in_order_with_its_words() {
        let document = every_block();
        let pages = laid(&document);
        assert_eq!(pages.len(), 2, "the page break starts a second page");
        let first = pages[0].lines();
        let order = [
            "Weekly report — Synthetic bathroom",
            "Week of 5 October 2026",
            "This week on site",
            "Two entries were written this week.",
            "Nothing was written on Friday.",
            "Photos are not in this report.",
            "Readiness",
            "3 of 5",
            "• Tiles chosen",
            "• Plumber named",
            "Activity",
            "Days",
            "Tiling",
            "4",
            "Grout",
            "Mon",
            "Ridgebeam · Weekly report — Synthetic bathroom · page 1 of 2",
        ];
        let mut at = 0;
        for words in order {
            let found = first[at..]
                .iter()
                .position(|line| line == words)
                .unwrap_or_else(|| panic!("{words:?} after line {at} of {first:#?}"));
            at += found;
        }
        assert_eq!(
            pages[1].lines(),
            vec![
                "After the break.",
                "Ridgebeam · Weekly report — Synthetic bathroom · page 2 of 2"
            ]
        );
        inside_the_margins(&pages);

        let strong = texts(&pages[0])
            .into_iter()
            .find(|m| matches!(m, Mark::Text { bytes, .. } if bytes == b"Two entries were written this week."))
            .unwrap();
        assert!(matches!(
            strong,
            Mark::Text {
                face: Face::Bold,
                ..
            }
        ));
        let muted = texts(&pages[0])
            .into_iter()
            .find(|m| matches!(m, Mark::Text { bytes, .. } if bytes == b"Photos are not in this report."))
            .unwrap();
        assert!(matches!(muted, Mark::Text { face: Face::Regular, gray, .. } if *gray > 0.0));
    }

    #[test]
    fn both_page_sizes_are_a4_and_landscape_is_wider_than_tall() {
        let (w, h) = paper(PageSize::A4);
        assert!((w - 595.28).abs() < 0.01 && (h - 841.89).abs() < 0.01);
        let landscape = laid(&ReportDocument {
            page_size: PageSize::A4Landscape,
            ..every_block()
        });
        assert!(landscape[0].width > landscape[0].height);
        assert!((landscape[0].width - 841.89).abs() < 0.01);
        inside_the_margins(&landscape);
    }

    fn long_table(rows: usize) -> ReportDocument {
        serde_json::from_value(serde_json::json!({
            "kind": "schedule", "title": "Schedule", "subtitle": "", "pageSize": "a4",
            "language": "en",
            "blocks": [{ "type": "table",
                "columns": [
                    { "text": "#", "align": "right", "width": 0.1 },
                    { "text": "Activity", "align": "left", "width": 0.9 }
                ],
                "rows": (1..=rows).map(|n| vec![n.to_string(), format!("Activity number {n}")]).collect::<Vec<_>>()
            }]
        }))
        .unwrap()
    }

    #[test]
    fn a_long_table_breaks_across_pages_and_repeats_its_header_on_every_one() {
        let pages = laid(&long_table(200));
        assert!(pages.len() >= 4, "{} pages", pages.len());
        let mut seen = Vec::new();
        for (p, page) in pages.iter().enumerate() {
            let lines = page.lines();
            let header_at = lines.iter().position(|l| l == "Activity").unwrap();
            assert_eq!(
                lines[header_at - 1],
                "#",
                "page {}: the header, both cells",
                p + 1
            );
            if p > 0 {
                assert_eq!(header_at, 1, "page {}: the header comes first", p + 1);
            }
            seen.extend(
                lines
                    .iter()
                    .filter_map(|l| l.strip_prefix("Activity number "))
                    .map(|n| n.parse::<usize>().unwrap()),
            );
            assert_eq!(
                lines.last().unwrap(),
                &format!("Ridgebeam · Schedule · page {} of {}", p + 1, pages.len())
            );
        }
        assert_eq!(
            seen,
            (1..=200).collect::<Vec<_>>(),
            "every row once, in order"
        );
        inside_the_margins(&pages);
    }

    #[test]
    fn a_row_taller_than_a_page_is_split_between_pages_and_loses_no_line() {
        let long = (1..=400)
            .map(|n| format!("w{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        let document: ReportDocument = serde_json::from_value(serde_json::json!({
            "kind": "weekly", "title": "Tall", "subtitle": "", "pageSize": "a4", "language": "en",
            "blocks": [{ "type": "table",
                "columns": [
                    { "text": "Day", "align": "left", "width": 0.9 },
                    { "text": "Note", "align": "left", "width": 0.1 }
                ],
                "rows": [["Monday", long]] }]
        }))
        .unwrap();
        let pages = laid(&document);
        assert!(pages.len() >= 2);
        let words: Vec<String> = pages
            .iter()
            .flat_map(|p| p.lines())
            .filter(|l| l.starts_with('w'))
            .flat_map(|l| l.split(' ').map(str::to_string).collect::<Vec<_>>())
            .collect();
        assert_eq!(words.len(), 400);
        assert_eq!(words.first().unwrap(), "w1");
        assert_eq!(words.last().unwrap(), "w400");
        for page in &pages[1..] {
            assert!(
                page.lines().contains(&"Note".to_string()),
                "header repeated"
            );
        }
        inside_the_margins(&pages);
    }

    fn schedule(days: i64, bars: usize) -> ReportDocument {
        serde_json::from_value(serde_json::json!({
            "kind": "schedule", "title": "Schedule", "subtitle": "", "pageSize": "a4-landscape",
            "language": "pt-BR",
            "blocks": [{ "type": "gantt", "days": days,
                "dayLabels": (0..days).map(|d| format!("{:02}/10", d % 31 + 1)).collect::<Vec<_>>(),
                "rows": (0..bars).map(|n| serde_json::json!({
                    "label": format!("Atividade {n}"), "start": (n as i64) % days, "length": 1,
                    "critical": n % 2 == 0, "baselineStart": if n % 3 == 0 { serde_json::json!(-2) } else { serde_json::Value::Null },
                    "baselineLength": if n % 3 == 0 { serde_json::json!(4) } else { serde_json::Value::Null }
                })).collect::<Vec<_>>() }]
        }))
        .unwrap()
    }

    #[test]
    fn a_long_schedule_breaks_across_pages_repeating_its_day_header() {
        let pages = laid(&schedule(30, 120));
        assert!(pages.len() >= 3, "{} pages", pages.len());
        let mut bars = 0;
        for (p, page) in pages.iter().enumerate() {
            let lines = page.lines();
            let first = usize::from(p == 0);
            assert_eq!(
                lines[first],
                "01/10",
                "page {}: the day header first (after the title on page 1)",
                p + 1
            );
            bars += page
                .marks
                .iter()
                .filter(|m| matches!(m, Mark::Rect { height, .. } if (*height - 6.0).abs() < 0.01))
                .count();
            assert_eq!(
                lines.last().unwrap(),
                &format!("Ridgebeam · Schedule · página {} de {}", p + 1, pages.len())
            );
        }
        assert_eq!(bars, 120, "every bar once");
        let critical = pages[0]
            .marks
            .iter()
            .find(|m| matches!(m, Mark::Rect { height, .. } if (*height - 6.0).abs() < 0.01))
            .unwrap();
        assert!(
            matches!(
                critical,
                Mark::Rect {
                    fill: Some(_),
                    stroke: None,
                    ..
                }
            ),
            "bar 0 is critical: filled"
        );
        let baseline = pages[0]
            .marks
            .iter()
            .find(|m| matches!(m, Mark::Rect { height, .. } if (*height - 1.6).abs() < 0.01))
            .unwrap();
        let Mark::Rect { x, width: w, .. } = baseline else {
            unreachable!()
        };
        let grid_left =
            MARGIN + ((paper(PageSize::A4Landscape).0 - 2.0 * MARGIN) * 0.28).min(220.0) + 6.0;
        assert!(
            (x - grid_left).abs() < 0.01,
            "a baseline from day -2 is clipped at day 0"
        );
        assert!(*w > 0.0);
        inside_the_margins(&pages);
    }

    #[test]
    fn a_plan_longer_than_the_page_is_scaled_to_its_width_and_its_labels_thinned() {
        let label_positions = |pages: &[Page]| -> Vec<f32> {
            pages[0]
                .marks
                .iter()
                .filter_map(|m| match m {
                    Mark::Text { x, bytes, .. } if bytes.ends_with(b"/10") => Some(*x),
                    _ => None,
                })
                .collect()
        };
        let widest = width(b"01/10", Face::Regular, DAY_LABEL_SIZE);
        let few = laid(&schedule(20, 3));
        assert_eq!(
            label_positions(&few).len(),
            20,
            "20 days: every day labelled"
        );

        for days in [120, 400, 3000] {
            let pages = laid(&schedule(days, 3));
            let positions = label_positions(&pages);
            assert!(
                positions.len() < days as usize,
                "{days} days: labels thinned to {}",
                positions.len()
            );
            for pair in positions.windows(2) {
                assert!(
                    pair[1] - pair[0] >= widest,
                    "{days} days: labels do not touch"
                );
            }
            for mark in &pages[0].marks {
                if let Mark::Rect { x, width: w, .. } = mark {
                    assert!(
                        x + w <= pages[0].width - MARGIN + 0.01,
                        "{days} days: every bar inside the page"
                    );
                }
            }
            inside_the_margins(&pages);
        }
        assert_eq!(every_nth(10.0, 20.0), 1);
        assert_eq!(every_nth(10.0, 2.0), 6);
        assert_eq!(every_nth(0.0, 2.0), 1);
    }

    #[test]
    fn the_footer_names_the_page_of_the_whole_in_the_documents_language_and_cuts_a_long_title() {
        assert_eq!(
            footer(Language::En, "Diary", 2, 5),
            "Ridgebeam · Diary · page 2 of 5"
        );
        assert_eq!(
            footer(Language::PtBr, "Diário", 2, 5),
            "Ridgebeam · Diário · página 2 de 5"
        );
        let title = "A very long title ".repeat(30);
        let pages = lay_out(title.trim(), "", PageSize::A4, Language::En, &[]);
        assert_eq!(
            pages.len(),
            1,
            "an empty document is one page with its title"
        );
        let last = pages[0].lines().pop().unwrap();
        assert!(last.starts_with("Ridgebeam · A very long title"), "{last}");
        assert!(last.ends_with("… · page 1 of 1"), "{last}");
        inside_the_margins(&pages);
    }

    /// The worst a document inside the limits can ask for still ends: sixteen
    /// headings of 2 000 characters over columns a hair wide, and cells as long.
    #[test]
    fn a_header_taller_than_a_page_is_cut_and_the_table_still_ends() {
        let long = "word ".repeat(400);
        let columns: Vec<serde_json::Value> = (0..16)
            .map(|_| serde_json::json!({ "text": long, "align": "left", "width": 0.0001 }))
            .collect();
        let document: ReportDocument = serde_json::from_value(serde_json::json!({
            "kind": "weekly", "title": "Worst", "subtitle": "", "pageSize": "a4", "language": "en",
            "blocks": [{ "type": "table", "columns": columns,
                "rows": vec![vec![long.clone(); 16]; 3] }]
        }))
        .unwrap();
        crate::report::model::check(&document).expect("inside every limit");
        let pages = laid(&document);
        assert!(pages.len() > 1);
        for page in &pages {
            for mark in &page.marks {
                if let Mark::Text { y, .. } = mark {
                    assert!(*y >= MARGIN / 2.0 - 0.01, "nothing below the footer");
                }
            }
        }
    }

    /// Every block at its longest — one word of 2 000 characters where a line
    /// would break, and words of it where it would not — stays inside the
    /// margins.
    #[test]
    fn every_block_at_its_longest_stays_inside_the_margins() {
        let word = "W".repeat(2000);
        let words = "Wide ".repeat(400);
        for text in [&word, &words] {
            let document: ReportDocument = serde_json::from_value(serde_json::json!({
                "kind": "weekly", "title": text, "subtitle": text, "pageSize": "a4",
                "language": "pt-BR",
                "blocks": [
                    { "type": "heading", "level": 1, "text": text },
                    { "type": "paragraph", "text": text, "tone": "strong" },
                    { "type": "figure", "label": text, "value": text, "rows": [text] },
                    { "type": "table", "columns": [
                        { "text": text, "align": "left", "width": 0.5 },
                        { "text": text, "align": "right", "width": 0.5 }
                    ], "rows": [[text, text]] },
                    { "type": "gantt", "days": 3, "dayLabels": [text, text, text],
                      "rows": [{ "label": text, "start": 0, "length": 3, "critical": false,
                                 "baselineStart": null, "baselineLength": null }] }
                ]
            }))
            .unwrap();
            crate::report::model::check(&document).expect("inside every limit");
            inside_the_margins(&laid(&document));
        }
    }

    #[test]
    fn the_largest_table_the_limits_allow_is_laid_out() {
        let pages = laid(&long_table(crate::report::model::MAX_ROWS));
        assert!(pages.len() > 300, "{} pages", pages.len());
        assert!(pages
            .last()
            .unwrap()
            .lines()
            .contains(&"Activity number 20000".to_string()));
    }

    #[test]
    fn a_heading_is_not_left_alone_at_the_foot_of_a_page() {
        let mut blocks: Vec<Block> = Vec::new();
        // Fill the first page almost to its foot.
        let mut filler = Vec::new();
        while {
            let pages = lay_out("T", "", PageSize::A4, Language::En, &filler);
            pages.len() == 1
        } {
            filler.push(Block::Paragraph {
                text: "filler".into(),
                tone: Tone::Normal,
            });
        }
        filler.pop();
        blocks.extend(filler);
        blocks.push(Block::Heading {
            level: 1,
            text: "Heading".into(),
        });
        blocks.push(Block::Paragraph {
            text: "Its paragraph.".into(),
            tone: Tone::Normal,
        });
        let pages = lay_out("T", "", PageSize::A4, Language::En, &blocks);
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[1].lines()[0], "Heading");
        assert_eq!(pages[1].lines()[1], "Its paragraph.");
    }
}
