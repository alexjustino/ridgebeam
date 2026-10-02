//! Pages laid out, written as a PDF with `pdf-writer`.
//!
//! This module decides nothing about where anything goes — `report::layout`
//! did — it serialises marks. The two faces are the standard Helvetica and
//! Helvetica-Bold with `/WinAnsiEncoding`, not embedded (ADR-031). Every text
//! mark is its own text object (`BT … ET`): a reader sees one line per mark,
//! and a phrase that fits on one line is one string in the page's stream —
//! ASCII as a literal string, a run of other WinAnsi bytes as a hex string
//! beside it in a `TJ` array. Page streams are deflated (`/FlateDecode`).
//!
//! The metadata says the title (the document's, as passed in), the producer
//! (`Ridgebeam {version}`) and the creation date (passed in, so a test can pin
//! it). There is no author and no e-mail: the file says nothing about who
//! printed it. The catalogue carries the document's language.
//!
//! A photo (D3) is an image XObject with `/DCTDecode` — the JPEG stream
//! `report::images` prepared, written once however many times it is drawn,
//! named `/Im1`, `/Im2` … in the order the pages first draw them, and listed in
//! the resources of each page that draws it. Each draw scales the unit square
//! to the mark's rectangle.
//!
//! Pure: pages in, bytes out. Nothing here opens a file.

use std::io::Write;

use chrono::{DateTime, Datelike, FixedOffset, Timelike};
use pdf_writer::{Content, Date, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};

use crate::error::{Error, Result};
use crate::report::images::{Colour, Images};
use crate::report::layout::{Mark, Page};
use crate::report::model::Language;
use crate::report::winansi::Face;

const REGULAR: Name<'static> = Name(b"F1");
const BOLD: Name<'static> = Name(b"F2");

/// A PDF written: its bytes and how many pages it has.
#[derive(Debug, Clone, PartialEq)]
pub struct Rendered {
    /// The file.
    pub bytes: Vec<u8>,
    /// How many pages.
    pub pages: usize,
}

/// What a PDF says about itself.
#[derive(Debug, Clone, Copy)]
pub struct Metadata<'a> {
    /// The document's title.
    pub title: &'a str,
    /// The language of its words.
    pub language: Language,
    /// When it was made, as the interface passed it.
    pub created_at: DateTime<FixedOffset>,
}

/// The PDF's date: every field, and the offset the moment was given in.
fn pdf_date(moment: &DateTime<FixedOffset>) -> Date {
    let offset = moment.offset().local_minus_utc() / 60;
    Date::new(moment.year().clamp(0, 9999) as u16)
        .month(moment.month() as u8)
        .day(moment.day() as u8)
        .hour(moment.hour() as u8)
        .minute(moment.minute() as u8)
        .second(moment.second().min(59) as u8)
        .utc_offset_hour((offset / 60) as i8)
        .utc_offset_minute((offset % 60).unsigned_abs() as u8)
}

/// The name a photo is drawn by: `Im1`, `Im2` …
fn image_name(number: usize) -> Vec<u8> {
    format!("Im{number}").into_bytes()
}

/// Write `pages` as a PDF, with the photos their marks draw.
///
/// # Errors
///
/// [`Error::Io`] when a page's stream cannot be compressed — this host's own
/// bytes, in memory; [`Error::InvalidInput`] when a mark draws a photo that
/// `images` does not hold.
pub fn write(pages: &[Page], metadata: &Metadata<'_>, images: &Images) -> Result<Rendered> {
    let catalogue = Ref::new(1);
    let tree = Ref::new(2);
    let regular = Ref::new(3);
    let bold = Ref::new(4);
    let about = Ref::new(5);
    let page_ids: Vec<(Ref, Ref)> = (0..pages.len() as i32)
        .map(|index| (Ref::new(6 + 2 * index), Ref::new(7 + 2 * index)))
        .collect();
    // Every photo drawn, once, in the order the pages first draw it.
    let mut drawn: Vec<&str> = Vec::new();
    for page in pages {
        for mark in &page.marks {
            if let Mark::Image { hash, .. } = mark {
                if !drawn.contains(&hash.as_str()) {
                    if !images.contains_key(hash) {
                        return Err(Error::InvalidInput(
                            "A report draws a photo it was not given.".into(),
                        ));
                    }
                    drawn.push(hash);
                }
            }
        }
    }
    let first_image = 6 + 2 * pages.len() as i32;
    let image_ref = |hash: &str| -> (Ref, usize) {
        let index = drawn.iter().position(|h| *h == hash).unwrap_or(0);
        (Ref::new(first_image + index as i32), index + 1)
    };

    let mut pdf = Pdf::new();
    pdf.catalog(catalogue)
        .pages(tree)
        .lang(TextStr(metadata.language.tag()));
    pdf.pages(tree)
        .kids(page_ids.iter().map(|(page, _)| *page))
        .count(pages.len() as i32);
    for (id, face) in [(regular, Face::Regular), (bold, Face::Bold)] {
        pdf.type1_font(id)
            .base_font(Name(face.base_font().as_bytes()))
            .encoding_predefined(Name(b"WinAnsiEncoding"));
    }

    for (page, (page_id, content_id)) in pages.iter().zip(&page_ids) {
        {
            let mut written = pdf.page(*page_id);
            written.parent(tree);
            written.media_box(Rect::new(0.0, 0.0, page.width, page.height));
            written.contents(*content_id);
            let mut resources = written.resources();
            resources.fonts().pair(REGULAR, regular).pair(BOLD, bold);
            let mut here: Vec<(Ref, usize)> = Vec::new();
            for mark in &page.marks {
                if let Mark::Image { hash, .. } = mark {
                    let found = image_ref(hash);
                    if !here.contains(&found) {
                        here.push(found);
                    }
                }
            }
            if !here.is_empty() {
                let mut objects = resources.x_objects();
                for (id, number) in &here {
                    objects.pair(Name(&image_name(*number)), *id);
                }
                objects.finish();
            }
            resources.finish();
            written.finish();
        }
        let stream = deflate(&draw(page, &|hash| image_ref(hash).1))?;
        pdf.stream(*content_id, &stream).filter(Filter::FlateDecode);
    }

    for (index, hash) in drawn.iter().enumerate() {
        let image = &images[*hash];
        let mut object = pdf.image_xobject(Ref::new(first_image + index as i32), &image.jpeg);
        object.filter(Filter::DctDecode);
        object.width(image.width as i32);
        object.height(image.height as i32);
        match image.colour {
            Colour::Gray => object.color_space().device_gray(),
            Colour::Rgb => object.color_space().device_rgb(),
        };
        object.bits_per_component(8);
        object.finish();
    }

    let version = format!("Ridgebeam {}", env!("CARGO_PKG_VERSION"));
    pdf.document_info(about)
        .title(TextStr(metadata.title))
        .producer(TextStr(&version))
        .creation_date(pdf_date(&metadata.created_at));

    Ok(Rendered {
        bytes: pdf.finish(),
        pages: pages.len(),
    })
}

/// A page's marks as a content stream; `number` names the photo a hash is
/// drawn by.
fn draw(page: &Page, number: &dyn Fn(&str) -> usize) -> Vec<u8> {
    let mut content = Content::new();
    for mark in &page.marks {
        match mark {
            Mark::Text {
                x,
                y,
                size,
                face,
                gray,
                bytes,
            } => {
                content.begin_text();
                content.set_font(
                    match face {
                        Face::Regular => REGULAR,
                        Face::Bold => BOLD,
                    },
                    *size,
                );
                content.set_fill_gray(*gray);
                content.next_line(*x, *y);
                if bytes.is_ascii() {
                    content.show(Str(bytes));
                } else {
                    let mut shown = content.show_positioned();
                    let mut items = shown.items();
                    for run in runs(bytes) {
                        items.show(Str(run));
                    }
                }
                content.end_text();
            }
            Mark::Line {
                x1,
                y1,
                x2,
                y2,
                width,
                gray,
            } => {
                content.set_stroke_gray(*gray);
                content.set_line_width(*width);
                content.move_to(*x1, *y1);
                content.line_to(*x2, *y2);
                content.stroke();
            }
            Mark::Rect {
                x,
                y,
                width,
                height,
                fill,
                stroke,
            } => {
                if let Some(gray) = fill {
                    content.set_fill_gray(*gray);
                }
                if let Some(gray) = stroke {
                    content.set_stroke_gray(*gray);
                    content.set_line_width(0.8);
                }
                content.rect(*x, *y, *width, *height);
                match (fill, stroke) {
                    (Some(_), Some(_)) => content.fill_nonzero_and_stroke(),
                    (Some(_), None) => content.fill_nonzero(),
                    _ => content.stroke(),
                };
            }
            Mark::Image {
                x,
                y,
                width,
                height,
                hash,
            } => {
                content.save_state();
                content.transform([*width, 0.0, 0.0, *height, *x, *y]);
                content.x_object(Name(&image_name(number(hash))));
                content.restore_state();
            }
        }
    }
    content.finish().to_vec()
}

/// `bytes` cut into runs that are all ASCII or all not, in order: the ASCII
/// ones are written as literal strings a person can read in the stream.
fn runs(bytes: &[u8]) -> Vec<&[u8]> {
    let mut runs = Vec::new();
    let mut start = 0;
    for index in 1..=bytes.len() {
        if index == bytes.len() || bytes[index].is_ascii() != bytes[start].is_ascii() {
            runs.push(&bytes[start..index]);
            start = index;
        }
    }
    runs
}

/// Deflate a page's stream, as `/FlateDecode` means it.
fn deflate(stream: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(stream)?;
    encoder.finish().map_err(Error::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_cut_into_ascii_and_other_runs_in_order() {
        let bytes = crate::report::winansi::encode("Relatório — semanal");
        let cut = runs(&bytes);
        assert_eq!(cut.concat(), bytes);
        assert_eq!(cut[0], b"Relat");
        assert_eq!(cut[1], &[0xF3]);
        assert_eq!(cut[2], b"rio ");
        assert_eq!(cut[3], &[0x97]);
        assert_eq!(cut[4], b" semanal");
        assert!(runs(b"").is_empty());
    }

    #[test]
    fn the_date_keeps_its_offset() {
        let moment = DateTime::parse_from_rfc3339("2026-10-09T14:05:30-03:00").unwrap();
        let mut pdf = Pdf::new();
        pdf.document_info(Ref::new(1))
            .creation_date(pdf_date(&moment));
        let bytes = pdf.finish();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("(D:20261009140530-03'00)"), "{text}");
    }
}
