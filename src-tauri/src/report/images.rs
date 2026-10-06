//! The photos a report prints (D3): found by hash in the open work, read as the
//! hostile files they are, and made ready to embed as JPEG.
//!
//! An image block names a file by the SHA-256 of its bytes — never by a path
//! (`model::check` refuses anything but 64 lowercase hex digits). The host
//! resolves it here, and only here:
//!
//! 1. **Named by a document of the open work.** The hash must be a row of
//!    `document`; a hash the work does not hold is refused, not skipped (the
//!    interface never sends one). A PDF among the documents is listed by its
//!    name in the book's words, never embedded: an image block naming one is
//!    refused.
//! 2. **Inside the work's own `documents/`.** The original is
//!    `<work>/documents/<hash>.<ext>` (`files::intake::original`) — no other
//!    folder, no path from the interface.
//! 3. **Read under the F7 caps.** At most 25 MiB, measured before it is read
//!    and again while it is; its SHA-256 must be the hash that named it (a file
//!    changed outside Ridgebeam is refused, as `documents_verify` would list
//!    it); typed by its magic bytes; its header no larger than 12 000 × 12 000.
//! 4. **Decoded under `image::Limits`** — the side cap and 256 MiB of
//!    allocation, as the thumbnail is — turned the way the camera said,
//!    transparency laid on white, shrunk to at most [`MAX_SIDE`] pixels on its
//!    long edge, and encoded as JPEG at [`QUALITY`].
//!
//! **The passthrough rule.** A JPEG that is already what the page needs is
//! not decoded and encoded again (`/DCTDecode` reads JPEG): one whose frame is
//! baseline, extended or progressive Huffman, 8 bits, with 1 component (grey)
//! or 3 (colour); whose long edge is at most [`MAX_SIDE`]; that the camera did
//! not ask to be turned; that is at most [`PASSTHROUGH_MAX_BYTES`]; and that
//! decodes under the limits like any other. Its compressed picture goes in
//! byte for byte — but **not its metadata**: a handover book is handed to other
//! people, and a photo's EXIF may hold where it was taken, the camera's serial
//! and the moment. [`strip_metadata`] rewrites the marker stream dropping
//! every APP1 (EXIF, XMP), APP2–APP13 and APP15 (an ICC profile among them)
//! and every COM, keeping APP0 (JFIF), APP14 (Adobe, which colour decoding
//! needs), the tables, the frame, the scans and their entropy-coded data byte
//! for byte; what follows the end of the image is not kept. A JPEG with none
//! of those segments goes in identical to the original. A marker stream that
//! cannot be walked, or whose rewrite does not decode, is re-encoded instead —
//! and a re-encoded image carries no metadata at all.
//!
//! **The caps per document**: at most `model::MAX_IMAGES` image blocks
//! (checked by `model::check`) and at most [`MAX_IMAGE_BYTES`] of image data —
//! the JPEG streams embedded, each distinct photo once — refused with a
//! sentence as soon as it is passed.
//!
//! **Two settings** (D4). A report printed as a PDF takes [`PRINTED`]: 1 600
//! px, quality 82, the passthrough rule above. The owner's snapshot — a page
//! meant to be sent from a phone — takes `report::html::SENT`: 1 024 px,
//! quality 78, its own cap on the data, and **always re-encoded**, so not even
//! a stripped original's bytes reach a file that leaves the machine. The
//! resolution — the document row, the folder, the caps, the re-hash, the
//! limits — is the same code for both ([`resolve_with`]).
//!
//! **A third's long edge** (G6). A photo the document places only as a
//! `third` is printed at a third of the line, and is prepared smaller: at most
//! [`THIRD_SIDE`] pixels for the PDF, `report::html::THIRD_SIDE` for the
//! snapshot — five eighths of the setting's long edge, still more than a third
//! of the line needs at 150 dpi, or on a phone's screen two to a row. A photo
//! also placed `full` or `half` anywhere in the document is prepared for the
//! widest place, once: a photo is embedded once, whatever its placements.
//!
//! Nothing here writes a file or reaches the network.
//!
//! # Changelog of this module
//!
//! - D3: the module.
//! - D4: [`Setting`]: the encode and the cap on the data are a setting;
//!   [`PRINTED`] is D3's, unchanged.
//! - G6: [`Setting::third_side`]: a photo placed only as a third is prepared
//!   at a smaller long edge ([`THIRD_SIDE`]); `full` and `half` unchanged.

use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::Path;

use image::{DynamicImage, ImageDecoder, ImageReader, Limits, Rgba, RgbaImage};
use rusqlite::{Connection, OptionalExtension};

use crate::error::{Error, Result};
use crate::files::intake::{
    self, Format, Sniffed, MAX_DECODE_ALLOC, MAX_PHOTO_BYTES, MAX_PHOTO_SIDE,
};
use crate::report::model::{Block, ImageSize};

/// The longest edge of an embedded image, in pixels.
pub const MAX_SIDE: u32 = 1600;

/// The longest edge of an image the PDF places only as a third (G6), in
/// pixels: a third of an A4 page's line is about 153 points, 318 pixels at
/// 150 dpi — a photo in a third's column, upright or lying, keeps more than
/// that.
pub const THIRD_SIDE: u32 = 1000;

/// The JPEG quality an image is re-encoded at.
pub const QUALITY: u8 = 82;

/// The largest JPEG passed through without re-encoding: 4 MiB.
pub const PASSTHROUGH_MAX_BYTES: usize = 4 * 1024 * 1024;

/// The most image data one report embeds: 150 MiB.
pub const MAX_IMAGE_BYTES: usize = 150 * 1024 * 1024;

/// The sentence for a report whose images come to more than [`MAX_IMAGE_BYTES`].
pub const TOO_MUCH_IMAGE_DATA: &str =
    "The photos of this report come to more than 150 MiB; a report holds at most 150 MiB of photos.";

/// How the photos of one kind of file are prepared, and how much of them it
/// holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Setting {
    /// The longest edge, in pixels.
    pub max_side: u32,
    /// The longest edge of a photo the document places only as a third
    /// (G6), in pixels.
    pub third_side: u32,
    /// The JPEG quality a photo is re-encoded at.
    pub quality: u8,
    /// Whether a JPEG that already fits may go in as it is, without its
    /// metadata (the passthrough rule); `false` re-encodes every photo.
    pub pass_through: bool,
    /// The most image data the file embeds, each distinct photo once.
    pub max_bytes: usize,
    /// The sentence when that is passed.
    pub too_much: &'static str,
}

/// A report printed as a PDF (D3).
pub const PRINTED: Setting = Setting {
    max_side: MAX_SIDE,
    third_side: THIRD_SIDE,
    quality: QUALITY,
    pass_through: true,
    max_bytes: MAX_IMAGE_BYTES,
    too_much: TOO_MUCH_IMAGE_DATA,
};

/// The colour space of an embedded image.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Colour {
    /// One component: `/DeviceGray`.
    Gray,
    /// Three components: `/DeviceRGB`.
    Rgb,
}

/// An image ready to embed: a JPEG stream and what the PDF says about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Embedded {
    /// Width, in pixels.
    pub width: u32,
    /// Height, in pixels.
    pub height: u32,
    /// Grey or colour.
    pub colour: Colour,
    /// The JPEG bytes — `/DCTDecode`.
    pub jpeg: Vec<u8>,
    /// Whether these are the original's bytes, untouched.
    pub passed_through: bool,
}

/// Every image a report prints, by hash.
pub type Images = BTreeMap<String, Embedded>;

/// The pixel sizes of the images, by hash, for the layout.
pub fn sizes(images: &Images) -> BTreeMap<String, (u32, u32)> {
    images
        .iter()
        .map(|(hash, image)| (hash.clone(), (image.width, image.height)))
        .collect()
}

/// Whether a document has any image block.
pub fn any(blocks: &[Block]) -> bool {
    blocks
        .iter()
        .any(|block| matches!(block, Block::Image { .. }))
}

/// Find, read and prepare every image `blocks` name, in the open work at
/// `folder`, under the caps. Each distinct hash once.
///
/// # Errors
///
/// [`Error::InvalidInput`], naming the block, for a hash the work does not
/// hold, a PDF, a file that is gone, changed, over a cap or unreadable; or
/// for more than [`MAX_IMAGE_BYTES`] of image data.
pub fn resolve(conn: &Connection, folder: &Path, blocks: &[Block]) -> Result<Images> {
    resolve_with(conn, folder, blocks, &PRINTED)
}

/// [`resolve`] under a cap on the image data other than [`MAX_IMAGE_BYTES`] —
/// so a test can reach the cap without writing 150 MiB of photos. The
/// sentence names the product's cap: only a test passes another.
#[cfg(test)]
pub(crate) fn resolve_within(
    conn: &Connection,
    folder: &Path,
    blocks: &[Block],
    max_bytes: usize,
) -> Result<Images> {
    resolve_with(
        conn,
        folder,
        blocks,
        &Setting {
            max_bytes,
            ..PRINTED
        },
    )
}

/// [`resolve`], each photo prepared by `setting` and the data capped by it —
/// at `setting.third_side` when every place the document gives it is a third.
///
/// # Errors
///
/// As [`resolve`]; past `setting.max_bytes`, its own sentence.
pub fn resolve_with(
    conn: &Connection,
    folder: &Path,
    blocks: &[Block],
    setting: &Setting,
) -> Result<Images> {
    // Each photo is prepared once, for the widest place it is given.
    let mut only_thirds: BTreeMap<&str, bool> = BTreeMap::new();
    for block in blocks {
        if let Block::Image { hash, size, .. } = block {
            let third = *size == ImageSize::Third;
            only_thirds
                .entry(hash.as_str())
                .and_modify(|only| *only &= third)
                .or_insert(third);
        }
    }
    let mut images = Images::new();
    let mut total = 0usize;
    for (index, block) in blocks.iter().enumerate() {
        let Block::Image { hash, .. } = block else {
            continue;
        };
        if images.contains_key(hash) {
            continue;
        }
        let number = index + 1;
        let refuse = |why: &str| Error::InvalidInput(format!("Block {number} {why}"));
        if !intake::is_hash(hash) {
            return Err(refuse("is an image that is not named by a hash."));
        }
        let media_type: Option<Option<String>> = conn
            .query_row(
                "SELECT media_type FROM document WHERE file_hash = ?1",
                [hash],
                |row| row.get(0),
            )
            .optional()?;
        let Some(media_type) = media_type else {
            return Err(refuse("is a photo that is not in this work."));
        };
        if media_type.as_deref() == Some(Format::Pdf.media_type()) {
            return Err(refuse(
                "names a PDF: a report lists a PDF by its name and never prints it as an image.",
            ));
        }
        let path = intake::original(folder, hash)
            .ok_or_else(|| refuse("is a photo whose file is not in the work folder."))?;
        let bytes = read_capped(&path).map_err(|why| refuse(&format!("is a photo that {why}.")))?;
        if intake::sha256_hex(&bytes) != *hash {
            return Err(refuse(
                "is a photo whose file is not the one recorded: it was changed outside Ridgebeam.",
            ));
        }
        let side = if only_thirds.get(hash.as_str()) == Some(&true) {
            setting.third_side.min(setting.max_side)
        } else {
            setting.max_side
        };
        let embedded = prepare_with(
            &bytes,
            &Setting {
                max_side: side,
                ..*setting
            },
        )
        .map_err(|why| refuse(&format!("is a photo that {why}.")))?;
        total += embedded.jpeg.len();
        if total > setting.max_bytes {
            return Err(Error::InvalidInput(setting.too_much.into()));
        }
        images.insert(hash.clone(), embedded);
    }
    Ok(images)
}

/// A file read under the F7 cap: measured first, and stopped one byte past it.
fn read_capped(path: &Path) -> std::result::Result<Vec<u8>, &'static str> {
    let metadata = std::fs::metadata(path).map_err(|_| "could not be found")?;
    if !metadata.is_file() {
        return Err("is not a file");
    }
    if metadata.len() > MAX_PHOTO_BYTES {
        return Err("is larger than 25 MiB");
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_PHOTO_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| "could not be read")?;
    if bytes.len() as u64 > MAX_PHOTO_BYTES {
        return Err("is larger than 25 MiB");
    }
    if bytes.is_empty() {
        return Err("is empty");
    }
    Ok(bytes)
}

/// What a JPEG's frame header says: its kind, precision, size and components.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame {
    /// The SOF marker's second byte: `0xC0` baseline, `0xC1` extended, `0xC2`
    /// progressive, others not passed through.
    pub marker: u8,
    /// Bits per sample.
    pub precision: u8,
    /// Height, in pixels (0: given later, by a DNL marker).
    pub height: u16,
    /// Width, in pixels.
    pub width: u16,
    /// How many components.
    pub components: u8,
}

/// The frame header of a JPEG, walking its segments from the start; `None`
/// when the bytes do not reach one before the scan.
pub fn jpeg_frame(bytes: &[u8]) -> Option<Frame> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut at = 2usize;
    loop {
        if *bytes.get(at)? != 0xFF {
            return None;
        }
        while *bytes.get(at)? == 0xFF {
            at += 1;
        }
        let marker = *bytes.get(at)?;
        at += 1;
        match marker {
            // Markers with no length.
            0x01 | 0xD0..=0xD8 => continue,
            // The scan, or the end, before any frame.
            0xD9 | 0xDA => return None,
            _ => {}
        }
        let length = usize::from(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]));
        if length < 2 {
            return None;
        }
        if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
            let header = bytes.get(at + 2..at + 8)?;
            return Some(Frame {
                marker,
                precision: header[0],
                height: u16::from_be_bytes([header[1], header[2]]),
                width: u16::from_be_bytes([header[3], header[4]]),
                components: header[5],
            });
        }
        at = at.checked_add(length)?;
    }
}

/// The limits every decode here runs under — the thumbnail's.
fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_PHOTO_SIDE);
    limits.max_image_height = Some(MAX_PHOTO_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    limits
}

/// An image's bytes made ready to embed: passed through when the rule allows,
/// re-encoded otherwise. The error is the end of a sentence: "… that {it}".
///
/// # Errors
///
/// A reason, for bytes that are not an image this product keeps, a header
/// over the side cap, or a file that cannot be decoded under the limits.
pub fn prepare(bytes: &[u8]) -> std::result::Result<Embedded, String> {
    prepare_with(bytes, &PRINTED)
}

/// [`prepare`] by `setting`: its long edge, its quality, and whether a JPEG
/// that fits may pass through.
///
/// # Errors
///
/// As [`prepare`].
pub fn prepare_with(bytes: &[u8], setting: &Setting) -> std::result::Result<Embedded, String> {
    let format = match intake::sniff(bytes) {
        Sniffed::Known(format) if format.is_image() => format,
        Sniffed::Known(_) => return Err("is a PDF, not an image".into()),
        _ => return Err("is not a JPEG, PNG, WebP, GIF or BMP image".into()),
    };
    let Some((_, Some((width, height)))) = intake::describe(bytes) else {
        return Err("has a header that could not be read".into());
    };
    if width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE {
        return Err("is larger than 12 000 × 12 000 pixels".into());
    }
    let image_format = match format {
        Format::Jpeg => image::ImageFormat::Jpeg,
        Format::Png => image::ImageFormat::Png,
        Format::Gif => image::ImageFormat::Gif,
        Format::WebP => image::ImageFormat::WebP,
        Format::Bmp => image::ImageFormat::Bmp,
        Format::Pdf => unreachable!("a PDF is refused above"),
    };

    let mut reader = ImageReader::with_format(Cursor::new(bytes), image_format);
    reader.limits(limits());
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "could not be decoded under the limits".to_string())?;
    let orientation = decoder
        .orientation()
        .map_err(|_| "could not be decoded under the limits".to_string())?;
    let mut decoded = DynamicImage::from_decoder(decoder)
        .map_err(|_| "could not be decoded under the limits".to_string())?;

    if setting.pass_through && format == Format::Jpeg && bytes.len() <= PASSTHROUGH_MAX_BYTES {
        if let Some(frame) = jpeg_frame(bytes) {
            let long = frame.width.max(frame.height);
            let fits = matches!(frame.marker, 0xC0..=0xC2)
                && frame.precision == 8
                && matches!(frame.components, 1 | 3)
                && frame.width > 0
                && frame.height > 0
                && u32::from(long) <= setting.max_side
                && orientation == image::metadata::Orientation::NoTransforms
                && u32::from(frame.width) == decoded.width()
                && u32::from(frame.height) == decoded.height();
            // The picture as it is, without what it says about where and when.
            let clean = fits
                .then(|| strip_metadata(bytes))
                .flatten()
                .filter(|clean| decodes(clean));
            if let Some(clean) = clean {
                return Ok(Embedded {
                    width: u32::from(frame.width),
                    height: u32::from(frame.height),
                    colour: if frame.components == 1 {
                        Colour::Gray
                    } else {
                        Colour::Rgb
                    },
                    jpeg: clean,
                    passed_through: true,
                });
            }
        }
    }

    decoded.apply_orientation(orientation);
    let grey = !decoded.color().has_color();
    let flat = on_white(decoded);
    let (w, h) = (flat.width(), flat.height());
    let long = w.max(h);
    let side = setting.max_side;
    let flat = if long > side {
        let scale = f64::from(side) / f64::from(long);
        let nw = ((f64::from(w) * scale).round() as u32).clamp(1, side);
        let nh = ((f64::from(h) * scale).round() as u32).clamp(1, side);
        flat.resize_exact(nw, nh, image::imageops::FilterType::CatmullRom)
    } else {
        flat
    };
    let mut jpeg = Vec::new();
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, setting.quality);
    let (width, height) = (flat.width(), flat.height());
    if grey {
        encoder
            .encode_image(&flat.to_luma8())
            .map_err(|_| "could not be encoded".to_string())?;
    } else {
        encoder
            .encode_image(&flat.to_rgb8())
            .map_err(|_| "could not be encoded".to_string())?;
    }
    Ok(Embedded {
        width,
        height,
        colour: if grey { Colour::Gray } else { Colour::Rgb },
        jpeg,
        passed_through: false,
    })
}

/// Whether JPEG bytes decode under the limits.
fn decodes(jpeg: &[u8]) -> bool {
    let mut reader = ImageReader::with_format(Cursor::new(jpeg), image::ImageFormat::Jpeg);
    reader.limits(limits());
    reader.decode().is_ok()
}

/// Whether a marker is metadata a passed-through JPEG does not carry: APP1
/// (EXIF, XMP), APP2–APP13 and APP15, and COM. APP0 (JFIF) and APP14 (Adobe)
/// are kept.
fn is_metadata(marker: u8) -> bool {
    matches!(marker, 0xE1..=0xED | 0xEF | 0xFE)
}

/// A JPEG's marker stream rewritten without its metadata segments
/// ([`is_metadata`]): every other segment, every scan header and all the
/// entropy-coded data copied byte for byte, up to and including the end of the
/// image. `None` for a stream that cannot be walked to its end.
pub fn strip_metadata(bytes: &[u8]) -> Option<Vec<u8>> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&[0xFF, 0xD8]);
    let mut at = 2usize;
    loop {
        if *bytes.get(at)? != 0xFF {
            return None;
        }
        // Fill bytes before a marker.
        while *bytes.get(at)? == 0xFF {
            at += 1;
        }
        let marker = *bytes.get(at)?;
        at += 1;
        match marker {
            0xD9 => {
                out.extend_from_slice(&[0xFF, 0xD9]);
                return Some(out);
            }
            0x01 | 0xD0..=0xD7 => {
                out.extend_from_slice(&[0xFF, marker]);
                continue;
            }
            0x00 | 0xD8 => return None,
            _ => {}
        }
        let length = usize::from(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]));
        if length < 2 {
            return None;
        }
        let end = at.checked_add(length)?;
        let segment = bytes.get(at..end)?;
        if !is_metadata(marker) {
            out.extend_from_slice(&[0xFF, marker]);
            out.extend_from_slice(segment);
        }
        at = end;
        if marker == 0xDA {
            // The entropy-coded data, to the next marker that is neither a
            // stuffed 0xFF nor a restart.
            let start = at;
            loop {
                if *bytes.get(at)? == 0xFF {
                    let next = *bytes.get(at + 1)?;
                    if next == 0x00 || (0xD0..=0xD7).contains(&next) {
                        at += 2;
                        continue;
                    }
                    break;
                }
                at += 1;
            }
            out.extend_from_slice(&bytes[start..at]);
        }
    }
}

/// An image with any transparency laid on white — paper is white.
fn on_white(image: DynamicImage) -> DynamicImage {
    if !image.color().has_alpha() {
        return image;
    }
    let rgba = image.to_rgba8();
    let mut flat = RgbaImage::from_pixel(rgba.width(), rgba.height(), Rgba([255, 255, 255, 255]));
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = u32::from(pixel[3]);
        let blend = |c: u8| ((u32::from(c) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        flat.put_pixel(
            x,
            y,
            Rgba([blend(pixel[0]), blend(pixel[1]), blend(pixel[2]), 255]),
        );
    }
    DynamicImage::ImageRgba8(flat)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::files::intake::tests::{jpeg, png};

    /// A grey JPEG of `width` × `height`.
    pub fn grey_jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = image::GrayImage::from_pixel(width, height, image::Luma([128]));
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 90)
            .encode_image(&image)
            .unwrap();
        bytes
    }

    /// A JPEG with an EXIF segment that asks for a quarter turn (orientation 6).
    pub fn turned_jpeg(width: u32, height: u32) -> Vec<u8> {
        let plain = jpeg(width, height);
        // APP1: "Exif\0\0", a little-endian TIFF header, one IFD entry —
        // Orientation (0x0112), SHORT, 1, value 6 — and no next IFD.
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II*\0");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&6u16.to_le_bytes());
        tiff.extend_from_slice(&[0, 0]);
        tiff.extend_from_slice(&0u32.to_le_bytes());
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend_from_slice(&tiff);
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
        out.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(&app1);
        out.extend_from_slice(&plain[2..]);
        out
    }

    /// The markers of a JPEG's header, up to its first scan.
    pub fn header_markers(jpeg: &[u8]) -> Vec<u8> {
        let mut markers = Vec::new();
        let mut at = 2;
        while at + 4 <= jpeg.len() && jpeg[at] == 0xFF {
            let marker = jpeg[at + 1];
            markers.push(marker);
            if marker == 0xDA {
                break;
            }
            at += 2 + usize::from(u16::from_be_bytes([jpeg[at + 2], jpeg[at + 3]]));
        }
        markers
    }

    /// A segment: its marker, then its length and `body`.
    fn segment(marker: u8, body: &[u8]) -> Vec<u8> {
        let mut out = vec![0xFF, marker];
        out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(body);
        out
    }

    /// An APP1 EXIF segment whose IFD0 points to a GPS IFD holding a
    /// latitude — "S", 23° 33′ — as a phone writes one.
    pub fn exif_with_gps() -> Vec<u8> {
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II*\0");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        // IFD0: one entry, GPSInfo (0x8825), LONG, 1, the GPS IFD at 26.
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x8825u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&26u32.to_le_bytes());
        tiff.extend_from_slice(&0u32.to_le_bytes());
        // GPS IFD at 26: GPSLatitudeRef (1), ASCII, 2, "S\0"; GPSLatitude
        // (2), RATIONAL, 3, at 56.
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&2u32.to_le_bytes());
        tiff.extend_from_slice(b"S\0\0\0");
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&5u16.to_le_bytes());
        tiff.extend_from_slice(&3u32.to_le_bytes());
        tiff.extend_from_slice(&56u32.to_le_bytes());
        tiff.extend_from_slice(&0u32.to_le_bytes());
        for (numerator, denominator) in [(23u32, 1u32), (33, 1), (0, 1)] {
            tiff.extend_from_slice(&numerator.to_le_bytes());
            tiff.extend_from_slice(&denominator.to_le_bytes());
        }
        let mut body = b"Exif\0\0".to_vec();
        body.extend_from_slice(&tiff);
        segment(0xE1, &body)
    }

    /// A JPEG carrying metadata a phone would: EXIF with GPS, XMP, an ICC
    /// profile's APP2, a comment — and APP14 (Adobe), which is kept. Returns
    /// it and the same JPEG without the metadata, as the rewrite must leave
    /// it.
    pub fn jpeg_with_metadata(width: u32, height: u32) -> (Vec<u8>, Vec<u8>) {
        let plain = jpeg(width, height);
        let adobe = segment(0xEE, b"Adobe\0\x64\0\0\0\0\x01");
        let mut with = vec![0xFF, 0xD8];
        with.extend(exif_with_gps());
        with.extend(segment(
            0xE1,
            b"http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS</x:xmpmeta>",
        ));
        with.extend(segment(0xE2, b"ICC_PROFILE\0\x01\x01synthetic"));
        with.extend(segment(0xFE, b"Synthetic camera, serial 0000"));
        with.extend(&adobe);
        with.extend_from_slice(&plain[2..]);
        let mut without = vec![0xFF, 0xD8];
        without.extend(&adobe);
        without.extend_from_slice(&plain[2..]);
        (with, without)
    }

    #[test]
    fn a_passed_through_jpeg_loses_its_metadata_and_keeps_its_picture_byte_for_byte() {
        let (with, without) = jpeg_with_metadata(400, 300);
        assert!(header_markers(&with).contains(&0xE1));

        let embedded = prepare(&with).unwrap();
        assert!(embedded.passed_through, "not re-encoded");
        assert_eq!(embedded.jpeg, without, "every other byte as it was");
        let markers = header_markers(&embedded.jpeg);
        for metadata in [0xE1, 0xE2, 0xFE] {
            assert!(
                !markers.contains(&metadata),
                "{metadata:#x} dropped: {markers:x?}"
            );
        }
        assert!(markers.contains(&0xEE), "APP14 kept");
        assert!(!embedded.jpeg.windows(4).any(|w| w == b"Exif"));
        assert!(!embedded.jpeg.windows(6).any(|w| w == b"serial"));
        assert_eq!(
            image::load_from_memory(&embedded.jpeg).unwrap().to_rgb8(),
            image::load_from_memory(&with).unwrap().to_rgb8(),
            "the same picture"
        );

        // Re-encoded — past 1 600 px — it carries no metadata either.
        let (big, _) = jpeg_with_metadata(2000, 1000);
        let embedded = prepare(&big).unwrap();
        assert!(!embedded.passed_through);
        let markers = header_markers(&embedded.jpeg);
        assert!(
            !markers.iter().any(|m| is_metadata(*m)),
            "no metadata segment: {markers:x?}"
        );
        assert!(!embedded.jpeg.windows(4).any(|w| w == b"Exif"));
    }

    #[test]
    fn a_marker_stream_that_cannot_be_walked_is_not_passed_through() {
        assert_eq!(strip_metadata(b"not a jpeg"), None);
        let plain = jpeg(64, 48);
        assert_eq!(
            strip_metadata(&plain).as_deref(),
            Some(&plain[..]),
            "nothing to drop"
        );
        let cut = &plain[..plain.len() - 2];
        assert_eq!(strip_metadata(cut), None, "no end of image");
        let mut bad_length = plain.clone();
        bad_length[4] = 0;
        bad_length[5] = 1;
        assert_eq!(strip_metadata(&bad_length), None);
        let mut trailing = plain.clone();
        trailing.extend_from_slice(b"appended by somebody");
        assert_eq!(strip_metadata(&trailing).as_deref(), Some(&plain[..]));
    }

    #[test]
    fn a_small_jpeg_is_passed_through_byte_for_byte() {
        let original = jpeg(800, 600);
        let embedded = prepare(&original).unwrap();
        assert!(embedded.passed_through);
        assert_eq!(embedded.jpeg, original, "byte-identical");
        assert_eq!(
            (embedded.width, embedded.height, embedded.colour),
            (800, 600, Colour::Rgb)
        );

        let grey = grey_jpeg(1600, 400);
        let embedded = prepare(&grey).unwrap();
        assert!(embedded.passed_through, "1 600 on the long edge is within");
        assert_eq!(embedded.colour, Colour::Gray);
        assert_eq!(embedded.jpeg, grey);
    }

    #[test]
    fn a_large_jpeg_a_turned_jpeg_and_every_other_format_are_re_encoded_within_1600() {
        for (case, bytes, expected) in [
            ("a JPEG past 1 600", jpeg(2400, 1800), (1600, 1200)),
            ("a tall PNG", png(900, 2000), (720, 1600)),
            ("a small PNG", png(64, 48), (64, 48)),
            (
                "a JPEG the camera turned",
                turned_jpeg(200, 100),
                (100, 200),
            ),
        ] {
            let embedded = prepare(&bytes).unwrap_or_else(|e| panic!("{case}: {e}"));
            assert!(!embedded.passed_through, "{case}");
            assert_eq!((embedded.width, embedded.height), expected, "{case}");
            assert!(
                embedded.jpeg.starts_with(&[0xFF, 0xD8, 0xFF]),
                "{case}: a JPEG"
            );
            let frame = jpeg_frame(&embedded.jpeg).unwrap();
            assert_eq!(
                (u32::from(frame.width), u32::from(frame.height)),
                expected,
                "{case}: the stream is the size it says"
            );
            assert_eq!(frame.marker, 0xC0, "{case}: baseline");
        }
    }

    #[test]
    fn transparency_is_laid_on_white() {
        let mut image = RgbaImage::from_pixel(10, 10, Rgba([0, 0, 0, 0]));
        image.put_pixel(0, 0, Rgba([0, 0, 0, 255]));
        let flat = on_white(DynamicImage::ImageRgba8(image)).to_rgb8();
        assert_eq!(flat.get_pixel(5, 5).0, [255, 255, 255]);
        assert_eq!(flat.get_pixel(0, 0).0, [0, 0, 0]);
    }

    #[test]
    fn what_is_not_an_image_or_does_not_decode_is_refused_with_a_reason() {
        let mut cut = jpeg(64, 48);
        cut.truncate(cut.len() / 2);
        for (bytes, words) in [
            (b"%PDF-1.7\n".to_vec(), "is a PDF"),
            (b"hello".to_vec(), "is not a JPEG"),
            (jpeg(64, 48)[..20].to_vec(), "header that could not be read"),
        ] {
            let reason = prepare(&bytes).unwrap_err();
            assert!(reason.contains(words), "{reason}");
        }
        // A JPEG cut in its scan: its header is whole; whatever the decoder
        // makes of the rest, nothing panics and the answer is an image or a
        // reason.
        let _ = prepare(&cut);
    }

    #[test]
    fn the_frame_walker_reads_a_frame_and_stops_at_nonsense() {
        let frame = jpeg_frame(&jpeg(320, 200)).unwrap();
        assert_eq!(
            (
                frame.marker,
                frame.precision,
                frame.width,
                frame.height,
                frame.components
            ),
            (0xC0, 8, 320, 200, 3)
        );
        assert_eq!(jpeg_frame(&grey_jpeg(8, 8)).unwrap().components, 1);
        for nonsense in [
            &b""[..],
            &[0xFF, 0xD8][..],
            &[0xFF, 0xD8, 0x00][..],
            &[0xFF, 0xD8, 0xFF, 0xE0, 0x00][..],
            &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01][..],
            &[0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x08][..],
            &[0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08, 0x08][..],
            &[0x89, b'P', b'N', b'G'][..],
        ] {
            assert_eq!(jpeg_frame(nonsense), None, "{nonsense:?}");
        }
    }
}
