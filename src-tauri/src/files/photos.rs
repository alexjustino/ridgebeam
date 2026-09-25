//! Photos: hostile files, copied in by the host under caps, and shown small.
//!
//! Every photo arrived from somebody else — a phone, a messaging app, a
//! contractor's e-mail — and is treated as hostile (SECURITY.md, "Files are
//! hostile"). The webview never reads one: it hands the host a path the person
//! chose, and gets back a hash, a thumbnail as a `data:` URL, and the promise
//! that the original opens with the system's own handler on a click.
//!
//! What happens to one file, in order, each step refusing with a sentence that
//! names the file:
//!
//! 1. **Measured before it is read.** Empty, or larger than [`MAX_PHOTO_BYTES`]
//!    (25 MiB), is refused from the file's metadata; the read itself stops one
//!    byte past the cap, so a file that grows in between is refused too.
//! 2. **Identified by its bytes, never its name.** JPEG, PNG, GIF, WebP or BMP,
//!    by magic bytes. HEIC is named and refused — this version does not decode
//!    it. Anything else — a text file called `.jpg` — is refused.
//! 3. **Measured from its header, before any pixel is decoded.** Width and
//!    height over [`MAX_PHOTO_SIDE`] (12 000) are refused; so is a header that
//!    cannot be read.
//! 4. **Named by what it is.** The SHA-256 of the bytes names the copy:
//!    `<work>/documents/<hash>.<ext>`, the extension from the detected format.
//!    A photo already in the work is not copied again.
//! 5. **Drawn small under limits.** A 320-pixel JPEG thumbnail is rendered to
//!    `<work>/thumbnails/<hash>.jpg` by the `image` crate under
//!    [`image::Limits`] (the side cap, and 256 MiB of allocation), turned the
//!    way the camera said. A photo that cannot be drawn is kept, and says so
//!    (`thumbnail = false`) — it is the person's photo, not the thumbnail's.
//!
//! The folders `documents/` and `thumbnails/` are created by the first photo,
//! not before. A [`CopyIn`] is a transaction on the folder: dropped without
//! [`CopyIn::keep`], it removes every file it wrote and every folder it
//! created, so an entry refused for its third photo leaves no trace of the
//! first two.
//!
//! # Changelog of this module
//!
//! - F4: copy-in, thumbnails, the data URL, opening with the system's handler.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use base64::Engine as _;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// The largest photo copied in: 25 MiB.
pub const MAX_PHOTO_BYTES: u64 = 25 * 1024 * 1024;

/// The widest and tallest photo copied in, in pixels, read from its header.
pub const MAX_PHOTO_SIDE: u32 = 12_000;

/// The longest side of a thumbnail, in pixels.
pub const THUMBNAIL_SIDE: u32 = 320;

/// The most memory decoding one photo for its thumbnail may ask for.
pub const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;

/// The folder the copies live in, inside the work folder.
pub const DOCUMENTS: &str = "documents";

/// The folder the thumbnails live in, inside the work folder.
pub const THUMBNAILS: &str = "thumbnails";

/// The longest file name a diary row keeps.
const MAX_NAME_CHARS: usize = 255;

/// The formats a photo may arrive as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// JPEG.
    Jpeg,
    /// PNG.
    Png,
    /// GIF (the first frame is the thumbnail).
    Gif,
    /// WebP.
    WebP,
    /// BMP.
    Bmp,
}

impl Format {
    /// Every format, in the order a copy is looked for.
    pub const ALL: [Format; 5] = [
        Format::Jpeg,
        Format::Png,
        Format::WebP,
        Format::Gif,
        Format::Bmp,
    ];

    /// The extension the copy is named with — from the bytes, never the name.
    pub fn extension(self) -> &'static str {
        match self {
            Format::Jpeg => "jpg",
            Format::Png => "png",
            Format::Gif => "gif",
            Format::WebP => "webp",
            Format::Bmp => "bmp",
        }
    }

    fn image_format(self) -> ImageFormat {
        match self {
            Format::Jpeg => ImageFormat::Jpeg,
            Format::Png => ImageFormat::Png,
            Format::Gif => ImageFormat::Gif,
            Format::WebP => ImageFormat::WebP,
            Format::Bmp => ImageFormat::Bmp,
        }
    }
}

/// What the magic bytes say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sniffed {
    /// A format this product reads.
    Photo(Format),
    /// A HEIC or HEIF photo, which this version does not decode.
    Heic,
    /// Something else.
    Unknown,
}

/// Identify a file by its first bytes.
pub fn sniff(bytes: &[u8]) -> Sniffed {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Sniffed::Photo(Format::Jpeg)
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Sniffed::Photo(Format::Png)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Sniffed::Photo(Format::Gif)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Sniffed::Photo(Format::WebP)
    } else if bytes.starts_with(b"BM") && bytes.len() >= 26 {
        Sniffed::Photo(Format::Bmp)
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(
            &bytes[8..12],
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" | b"mif1" | b"msf1"
        )
    {
        Sniffed::Heic
    } else {
        Sniffed::Unknown
    }
}

/// Whether a string is a photo's name in this work: 64 lowercase hex digits.
/// Checked before a hash ever becomes part of a path.
pub fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The SHA-256 of some bytes, as 64 lowercase hex digits.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// One photo, copied in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Copied {
    /// SHA-256 of its bytes.
    pub hash: String,
    /// The name it had, as chosen — never used as a path.
    pub file_name: String,
    /// Its size.
    pub bytes: i64,
    /// Its width, from its header.
    pub width: i64,
    /// Its height, from its header.
    pub height: i64,
    /// Whether its thumbnail exists.
    pub thumbnail: bool,
}

/// A copy-in in progress: the files it wrote, and the folders it created.
///
/// Dropped without [`CopyIn::keep`], it removes them — so a refused photo, or
/// an entry the database refused, leaves the work folder as it was.
pub struct CopyIn {
    folder: PathBuf,
    written: Vec<PathBuf>,
    created: Vec<PathBuf>,
    kept: bool,
}

impl CopyIn {
    /// Start copying into a work folder.
    pub fn new(folder: &Path) -> Self {
        CopyIn {
            folder: folder.to_path_buf(),
            written: Vec::new(),
            created: Vec::new(),
            kept: false,
        }
    }

    /// The entry was written: keep every file.
    pub fn keep(mut self) {
        self.kept = true;
    }

    /// Copy one photo in, or refuse it with a sentence that names it.
    ///
    /// # Errors
    ///
    /// [`Error::PhotoRefused`] for a file that is not there, empty, over the
    /// caps, not a photo this product reads, or whose header cannot be read;
    /// [`Error::Io`] when the work folder cannot be written.
    pub fn copy(&mut self, source: &Path) -> Result<Copied> {
        let file_name = display_name(source);
        let refuse =
            |reason: &str| Error::PhotoRefused(format!("“{file_name}” was not added: {reason}."));

        let metadata = std::fs::metadata(source).map_err(|_| refuse("it could not be found"))?;
        if !metadata.is_file() {
            return Err(refuse("it is not a file"));
        }
        if metadata.len() == 0 {
            return Err(refuse("it is empty"));
        }
        if metadata.len() > MAX_PHOTO_BYTES {
            return Err(refuse("it is larger than 25 MiB"));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        std::fs::File::open(source)
            .and_then(|file| file.take(MAX_PHOTO_BYTES + 1).read_to_end(&mut bytes))
            .map_err(|_| refuse("it could not be read"))?;
        if bytes.is_empty() {
            return Err(refuse("it is empty"));
        }
        if bytes.len() as u64 > MAX_PHOTO_BYTES {
            return Err(refuse("it is larger than 25 MiB"));
        }

        let format =
            match sniff(&bytes) {
                Sniffed::Photo(format) => format,
                Sniffed::Heic => return Err(refuse(
                    "it is a HEIC photo, which this version cannot read — save it as JPEG first",
                )),
                Sniffed::Unknown => {
                    return Err(refuse("it is not a JPEG, PNG, WebP, GIF or BMP image"));
                }
            };

        // The header only: no pixel is allocated here, so the decoder's own
        // allocation limits are lifted for this read — they would refuse a
        // lying size with the wrong sentence — and the product's cap below is
        // what decides. Decoding, for the thumbnail, runs under limits.
        let mut header = ImageReader::with_format(Cursor::new(&bytes), format.image_format());
        header.no_limits();
        let (width, height) = header
            .into_dimensions()
            .map_err(|_| refuse("its header could not be read — the file may be damaged"))?;
        if width == 0 || height == 0 {
            return Err(refuse(
                "its header could not be read — the file may be damaged",
            ));
        }
        if width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE {
            return Err(refuse("it is larger than 12 000 × 12 000 pixels"));
        }

        let hash = sha256_hex(&bytes);
        let documents = self.folder_for(DOCUMENTS)?;
        let copy = documents.join(format!("{hash}.{}", format.extension()));
        if !copy.exists() {
            self.write(&copy, &bytes)?;
        }

        let thumbnails = self.folder_for(THUMBNAILS)?;
        let small = thumbnails.join(format!("{hash}.jpg"));
        let thumbnail = if small.exists() {
            true
        } else {
            match render_thumbnail(&bytes, format) {
                Ok(jpeg) => {
                    self.write(&small, &jpeg)?;
                    true
                }
                Err(reason) => {
                    log::warn!("a photo was kept without a thumbnail: {reason}");
                    false
                }
            }
        };

        Ok(Copied {
            hash,
            file_name,
            bytes: bytes.len() as i64,
            width: i64::from(width),
            height: i64::from(height),
            thumbnail,
        })
    }

    /// `<work>/<name>`, created — and remembered — if it is not there yet.
    fn folder_for(&mut self, name: &str) -> Result<PathBuf> {
        let folder = self.folder.join(name);
        if !folder.is_dir() {
            std::fs::create_dir(&folder)?;
            self.created.push(folder.clone());
        }
        Ok(folder)
    }

    /// Write a file whole or not at all: to a temporary name, then renamed.
    fn write(&mut self, path: &Path, bytes: &[u8]) -> Result<()> {
        let partial = path.with_extension("part");
        std::fs::write(&partial, bytes)?;
        if let Err(error) = std::fs::rename(&partial, path) {
            let _ = std::fs::remove_file(&partial);
            return Err(error.into());
        }
        self.written.push(path.to_path_buf());
        Ok(())
    }
}

impl Drop for CopyIn {
    fn drop(&mut self) {
        if self.kept {
            return;
        }
        for file in self.written.drain(..) {
            let _ = std::fs::remove_file(file);
        }
        // `remove_dir`, never `remove_dir_all`: it only removes a folder that
        // is empty, so it cannot take anything this copy-in did not put there.
        for folder in self.created.drain(..).rev() {
            let _ = std::fs::remove_dir(folder);
        }
    }
}

/// The name a person will recognise, safe to keep in a row: the file's own
/// name, control characters replaced, at most 255 characters.
fn display_name(source: &Path) -> String {
    let name: String = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "photo".to_string())
        .chars()
        .map(|c| if c.is_control() { '_' } else { c })
        .take(MAX_NAME_CHARS)
        .collect();
    if name.trim().is_empty() {
        "photo".to_string()
    } else {
        name
    }
}

/// Decode under limits, turn as the camera said, shrink to 320 pixels on the
/// longest side, encode as JPEG.
fn render_thumbnail(bytes: &[u8], format: Format) -> std::result::Result<Vec<u8>, String> {
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format.image_format());
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_PHOTO_SIDE);
    limits.max_image_height = Some(MAX_PHOTO_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    let small = image.thumbnail(THUMBNAIL_SIDE, THUMBNAIL_SIDE).to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80)
        .encode_image(&small)
        .map_err(|e| e.to_string())?;
    Ok(jpeg)
}

/// The original of a photo in this work, if it is there.
pub fn original(folder: &Path, hash: &str) -> Option<PathBuf> {
    if !is_hash(hash) {
        return None;
    }
    Format::ALL
        .iter()
        .map(|format| {
            folder
                .join(DOCUMENTS)
                .join(format!("{hash}.{}", format.extension()))
        })
        .find(|path| path.is_file())
}

/// A photo's thumbnail as `data:image/jpeg;base64,…`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a hash that is not one, or a photo with no
/// thumbnail.
pub fn thumbnail_data_url(folder: &Path, hash: &str) -> Result<String> {
    if !is_hash(hash) {
        return Err(Error::InvalidInput(NOT_A_PHOTO.into()));
    }
    let bytes = std::fs::read(folder.join(THUMBNAILS).join(format!("{hash}.jpg")))
        .map_err(|_| Error::InvalidInput(NO_THUMBNAIL.into()))?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Open a photo's original with the operating system's own handler. Called
/// only from `photo_open`, which only the person's click reaches.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a photo not in this work; [`Error::Io`] when the
/// system could not open it.
pub fn open(folder: &Path, hash: &str) -> Result<()> {
    let path = original(folder, hash).ok_or_else(|| Error::InvalidInput(NOT_A_PHOTO.into()))?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|error| {
        log::warn!("the system could not open a photo: {error}");
        Error::Io(std::io::Error::other("the photo could not be opened"))
    })
}

/// The sentence for a hash that names no photo of this work.
pub const NOT_A_PHOTO: &str = "That photo is not in this work.";

/// The sentence for a photo kept without a thumbnail.
pub const NO_THUMBNAIL: &str = "That photo has no thumbnail; open it to see it.";

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::db::testing::Scratch;

    /// A real PNG of `width` × `height`, encoded by the `image` crate.
    pub fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbImage::from_pixel(width, height, image::Rgb([200, 120, 40]));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    /// A real JPEG of `width` × `height`.
    pub fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbImage::from_pixel(width, height, image::Rgb([40, 120, 200]));
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 90)
            .encode_image(&image)
            .unwrap();
        bytes
    }

    /// The hostile corpus of F4, each file generated here and never committed:
    /// what it is called, its bytes, and the words its refusal must contain.
    pub fn hostile_corpus() -> Vec<(&'static str, Vec<u8>, &'static str)> {
        // A PNG whose header says 100 000 × 100 000: the signature, then an
        // IHDR chunk with the lie in it. Nothing after it — no pixel is ever
        // decoded, because the header is refused first.
        let mut lying_png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(b"IHDR");
        ihdr.extend_from_slice(&100_000u32.to_be_bytes());
        ihdr.extend_from_slice(&100_000u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        lying_png.extend_from_slice(&13u32.to_be_bytes());
        lying_png.extend_from_slice(&ihdr);
        lying_png.extend_from_slice(&crc32(&ihdr).to_be_bytes());
        // A few bytes of image data and the end: a well-formed file whose only
        // lie is its size.
        let idat = [
            b"IDAT".as_slice(),
            &[0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01],
        ]
        .concat();
        lying_png.extend_from_slice(&8u32.to_be_bytes());
        lying_png.extend_from_slice(&idat);
        lying_png.extend_from_slice(&crc32(&idat).to_be_bytes());
        lying_png.extend_from_slice(&0u32.to_be_bytes());
        lying_png.extend_from_slice(b"IEND");
        lying_png.extend_from_slice(&crc32(b"IEND").to_be_bytes());

        // A real JPEG, cut off inside its first segment: it starts like a
        // JPEG and has no frame header to read a size from.
        let truncated_jpeg = jpeg(64, 48)[..20].to_vec();

        // 26 MiB: past the 25 MiB cap, refused from the file's size alone.
        let too_large = vec![0u8; 26 * 1024 * 1024];

        vec![
            (
                "lie.jpg",
                b"This is a text file. It has a photo's name and nothing else.".to_vec(),
                "not a JPEG, PNG, WebP, GIF or BMP image",
            ),
            ("huge.png", lying_png, "larger than 12 000 × 12 000 pixels"),
            ("cut.jpg", truncated_jpeg, "header could not be read"),
            ("empty.jpg", Vec::new(), "it is empty"),
            ("big.jpg", too_large, "larger than 25 MiB"),
        ]
    }

    /// The CRC a PNG chunk carries, so the lying header is otherwise well made.
    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    fn files_under(folder: &Path) -> Vec<String> {
        let mut found = Vec::new();
        for entry in walk(folder) {
            found.push(
                entry
                    .strip_prefix(folder)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
        found.sort();
        found
    }

    fn walk(folder: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    out.push(path.clone());
                    out.extend(walk(&path));
                } else {
                    out.push(path);
                }
            }
        }
        out
    }

    #[test]
    fn every_file_of_the_hostile_corpus_is_refused_with_a_sentence_naming_it_and_nothing_written() {
        let source = Scratch::create();
        let work = Scratch::create();

        for (name, bytes, words) in hostile_corpus() {
            let path = source.path().join(name);
            std::fs::write(&path, &bytes).unwrap();

            let mut copy = CopyIn::new(work.path());
            let refused = copy.copy(&path).expect_err(name);
            drop(copy);

            assert_eq!(refused.kind(), "photo_refused", "{name}");
            let sentence = refused.to_string();
            assert!(
                sentence.contains(name),
                "the sentence names the file: {sentence}"
            );
            assert!(sentence.contains(words), "{name}: {sentence}");
            assert!(
                files_under(work.path()).is_empty(),
                "{name}: nothing was written"
            );
        }
    }

    #[test]
    fn a_heic_photo_is_named_and_refused() {
        let source = Scratch::create();
        let work = Scratch::create();
        let path = source.path().join("IMG_0001.HEIC");
        let mut heic = vec![0, 0, 0, 24];
        heic.extend_from_slice(b"ftypheic");
        heic.extend_from_slice(&[0; 32]);
        std::fs::write(&path, heic).unwrap();

        let refused = CopyIn::new(work.path()).copy(&path).unwrap_err();

        assert!(refused.to_string().contains("HEIC"), "{refused}");
    }

    #[test]
    fn a_photo_is_copied_by_its_hash_with_the_extension_of_its_bytes_and_a_thumbnail() {
        let source = Scratch::create();
        let work = Scratch::create();
        // A PNG with a JPEG's name: the name is a hint, the bytes are the fact.
        let path = source.path().join("site.jpg");
        let bytes = png(1200, 800);
        std::fs::write(&path, &bytes).unwrap();

        let mut copy = CopyIn::new(work.path());
        let copied = copy.copy(&path).unwrap();
        copy.keep();

        let hash = sha256_hex(&bytes);
        assert_eq!(copied.hash, hash);
        assert_eq!(copied.file_name, "site.jpg");
        assert_eq!((copied.width, copied.height), (1200, 800));
        assert_eq!(copied.bytes, bytes.len() as i64);
        assert!(copied.thumbnail);
        assert_eq!(
            files_under(work.path()),
            vec![
                "documents".to_string(),
                format!("documents/{hash}.png"),
                "thumbnails".to_string(),
                format!("thumbnails/{hash}.jpg"),
            ]
        );
        assert_eq!(
            std::fs::read(work.path().join(format!("documents/{hash}.png"))).unwrap(),
            bytes
        );

        let small = image::load_from_memory(
            &std::fs::read(work.path().join(format!("thumbnails/{hash}.jpg"))).unwrap(),
        )
        .unwrap();
        assert_eq!(
            (small.width(), small.height()),
            (320, 213),
            "320 on the long side"
        );

        let url = thumbnail_data_url(work.path(), &hash).unwrap();
        assert!(
            url.starts_with("data:image/jpeg;base64,/9j/"),
            "{}",
            &url[..40]
        );
        assert_eq!(
            original(work.path(), &hash),
            Some(work.path().join(format!("documents/{hash}.png")))
        );
    }

    #[test]
    fn the_same_photo_twice_is_one_copy() {
        let source = Scratch::create();
        let work = Scratch::create();
        let bytes = jpeg(100, 100);
        for name in ["a.jpg", "b.jpg"] {
            std::fs::write(source.path().join(name), &bytes).unwrap();
        }

        let mut copy = CopyIn::new(work.path());
        let first = copy.copy(&source.path().join("a.jpg")).unwrap();
        let second = copy.copy(&source.path().join("b.jpg")).unwrap();
        copy.keep();

        assert_eq!(first.hash, second.hash);
        assert_eq!(
            files_under(work.path()).len(),
            4,
            "two folders, one copy, one thumbnail"
        );
    }

    #[test]
    fn a_copy_in_that_is_not_kept_removes_what_it_wrote_and_the_folders_it_made() {
        let source = Scratch::create();
        let work = Scratch::create();
        std::fs::write(source.path().join("a.png"), png(40, 30)).unwrap();

        let mut copy = CopyIn::new(work.path());
        copy.copy(&source.path().join("a.png")).unwrap();
        assert_eq!(files_under(work.path()).len(), 4);
        drop(copy);

        assert!(files_under(work.path()).is_empty());
    }

    #[test]
    fn a_hash_is_checked_before_it_becomes_a_path() {
        let work = Scratch::create();
        for hostile in ["..", "../../work", &"A".repeat(64), &"a".repeat(63), ""] {
            assert!(!is_hash(hostile), "{hostile}");
            assert_eq!(
                thumbnail_data_url(work.path(), hostile)
                    .unwrap_err()
                    .to_string(),
                NOT_A_PHOTO
            );
            assert_eq!(original(work.path(), hostile), None);
        }
        assert!(is_hash(&"0af9".repeat(16)));
    }

    #[test]
    fn the_magic_bytes_decide_the_format_and_a_name_decides_nothing() {
        assert_eq!(sniff(&jpeg(8, 8)), Sniffed::Photo(Format::Jpeg));
        assert_eq!(sniff(&png(8, 8)), Sniffed::Photo(Format::Png));
        assert_eq!(
            sniff(b"GIF89a\x01\x00\x01\x00"),
            Sniffed::Photo(Format::Gif)
        );
        assert_eq!(
            sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            Sniffed::Photo(Format::WebP)
        );
        assert_eq!(sniff(b"hello"), Sniffed::Unknown);
        assert_eq!(sniff(b""), Sniffed::Unknown);
        assert_eq!(sniff(b"%PDF-1.7\n"), Sniffed::Unknown);
    }
}
