//! A ZIP archive, written and read by hand: store and deflate, and nothing
//! else.
//!
//! A backup (F11, ADR-033) is one ZIP file so that a person can look inside it
//! with Windows. This module writes that file and reads it back, and reads
//! nothing else: it is not a general ZIP library. The shape it writes is the
//! only shape it accepts, and every byte of a file it is asked to read is
//! treated as hostile.
//!
//! **What it writes.** Local file headers with their sizes and CRC in place (no
//! data descriptor), each entry stored or deflated, a central directory right
//! after the last entry, and the end record with no comment. No ZIP64, no
//! encryption, no extra fields, no directories, ASCII names. The limits of the
//! plain format — 4 GiB for the whole file, 65 535 entries — are the backup's
//! limits, and a work that would pass them is refused before a byte is kept.
//!
//! **What it reads**, each refused with its own reason:
//!
//! - a file that does not begin with a local header is not a ZIP;
//! - a file larger than 4 GiB is refused from its size;
//! - the end record must be the last 22 bytes, with no comment: a file cut
//!   short, or one with bytes appended, has none there;
//! - the central directory must end exactly where the end record begins, be at
//!   most 16 MiB, and hold as many records as the end record says;
//! - every record: stored or deflated only; no encryption and no data
//!   descriptor; no extra field and no comment; a name of 1 to 255 bytes;
//!   stored means the two sizes agree; no ZIP64 marker;
//! - every local header must repeat its record exactly — method, CRC, both
//!   sizes, the name — and the entries must lie one after another from the
//!   first byte to the central directory, with no gap and no overlap, so no
//!   two names can share bytes and nothing is hidden between them;
//! - an entry is read under a cap the caller gives, **while it inflates**:
//!   a size over the cap is refused before a byte is inflated, and inflating
//!   stops one byte past the size the record declares — a size that lies is
//!   found without ever holding what it hid. The CRC is checked at the end.
//!
//! What the names mean — which are allowed, which are hostile — is the
//! backup's to say (`files::backup`), not this module's.
//!
//! # Why by hand
//!
//! The `zip` crate (8.6, MIT, MSRV 1.88) with only `deflate-flate2` would add
//! two crates to the binary (`zip`, `typed-path`). It was measured and not
//! taken: its reader parses what this product must refuse anyway (ZIP64 and
//! AES extra fields, other methods' headers, data descriptors), its writer
//! refuses a duplicate name — so the hostile corpus would need a hand writer
//! regardless — and the one guarantee that matters, sizes enforced while
//! inflating, would be this module's code either way. Deflate and CRC-32 are
//! `flate2`, already in the tree (F4, F10). The second reader of what this
//! module writes is the `tar.exe` that ships with Windows (libarchive), in a
//! test.

use std::io::{self, Read, Seek, SeekFrom, Write};

use chrono::{Datelike, NaiveDateTime, Timelike};
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::{Compression, Crc};
use sha2::{Digest, Sha256};

/// The largest archive: what 32-bit offsets reach, one byte under 4 GiB.
pub const MAX_ARCHIVE_BYTES: u64 = u32::MAX as u64;

/// The most entries a plain ZIP holds.
pub const MAX_ENTRIES: usize = u16::MAX as usize;

/// The largest central directory read: far more than 65 535 short names need.
pub const MAX_DIRECTORY_BYTES: u64 = 16 * 1024 * 1024;

/// The longest name an entry may have, in bytes.
pub const MAX_NAME_BYTES: usize = 255;

const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const END_SIGNATURE: u32 = 0x0605_4b50;
const LOCAL_LEN: u64 = 30;
const CENTRAL_LEN: usize = 46;
const END_LEN: u64 = 22;
/// "Version needed to extract": 2.0, deflate.
const VERSION: u16 = 20;
/// Bit 11: the name is UTF-8. Names here are ASCII, which is both.
const UTF8_NAMES: u16 = 1 << 11;
const CHUNK: usize = 64 * 1024;

/// How an entry's bytes are kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// As they are — a JPEG or a PDF, already compressed.
    Store,
    /// Deflated — the database.
    Deflate,
}

impl Method {
    fn code(self) -> u16 {
        match self {
            Method::Store => 0,
            Method::Deflate => 8,
        }
    }
}

/// Why an archive could not be written.
#[derive(Debug)]
pub enum WriteError {
    /// It would pass the plain format's limits: 4 GiB, or 65 535 entries.
    TooLarge,
    /// The disk refused.
    Io(io::Error),
}

impl From<io::Error> for WriteError {
    fn from(error: io::Error) -> Self {
        WriteError::Io(error)
    }
}

/// Why an archive, or one of its entries, was refused.
#[derive(Debug)]
pub enum ReadError {
    /// It does not begin like a ZIP.
    NotZip,
    /// It has no end record where one must be: cut short, or added to.
    Incomplete,
    /// It is larger than 4 GiB.
    TooLarge,
    /// It is a ZIP, but not the shape this module writes; the words say how,
    /// for the log.
    Shape(&'static str),
    /// The entry of this name inflates to more, or less, than it declares.
    SizeLies(String),
    /// The entry of this name declares more than the caller's cap.
    OverCap(String),
    /// The entry of this name does not inflate, or fails its CRC.
    Damaged(String),
    /// The file could not be read.
    Io(io::Error),
}

impl From<io::Error> for ReadError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::UnexpectedEof => ReadError::Incomplete,
            _ => ReadError::Io(error),
        }
    }
}

/// One entry, as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Written {
    /// Its name.
    pub name: String,
    /// Its bytes before compression.
    pub bytes: u64,
    /// The SHA-256 of those bytes, as 64 lowercase hex digits.
    pub sha256: String,
    method: Method,
    crc: u32,
    compressed: u64,
    offset: u64,
}

/// A writer that counts what passes through it.
struct Counting<'a, W: Write> {
    inner: &'a mut W,
    count: u64,
}

impl<W: Write> Write for Counting<'_, W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.count += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// An archive being written, entry by entry, then finished.
pub struct Writer<W: Write + Seek> {
    out: W,
    offset: u64,
    entries: Vec<Written>,
    time: u16,
    date: u16,
}

/// The MS-DOS time and date a ZIP header carries, from a local time. A year
/// before 1980 — which the format cannot say — is written as 1980.
pub fn dos_time(when: NaiveDateTime) -> (u16, u16) {
    let year = when.year().clamp(1980, 2107) as u16;
    let date = ((year - 1980) << 9) | ((when.month() as u16) << 5) | when.day() as u16;
    let time =
        ((when.hour() as u16) << 11) | ((when.minute() as u16) << 5) | (when.second() as u16 / 2);
    (time, date)
}

impl<W: Write + Seek> Writer<W> {
    /// Start an archive at the beginning of `out`, every entry stamped with
    /// `when` (local time).
    pub fn new(out: W, when: NaiveDateTime) -> Self {
        let (time, date) = dos_time(when);
        Writer {
            out,
            offset: 0,
            entries: Vec::new(),
            time,
            date,
        }
    }

    /// Add one entry, its bytes read from `data` to the end.
    ///
    /// The local header is written first with its CRC and sizes blank, the
    /// bytes streamed after it, and the header completed in place — so a
    /// database of 2 GiB is never held in memory.
    ///
    /// # Errors
    ///
    /// [`WriteError::TooLarge`] past 65 535 entries or 4 GiB;
    /// [`WriteError::Io`] when `data` or the disk fails.
    pub fn add(
        &mut self,
        name: &str,
        method: Method,
        mut data: impl Read,
    ) -> Result<&Written, WriteError> {
        if self.entries.len() >= MAX_ENTRIES {
            return Err(WriteError::TooLarge);
        }
        debug_assert!(name.is_ascii() && !name.is_empty() && name.len() <= MAX_NAME_BYTES);
        let offset = self.offset;
        self.out.seek(SeekFrom::Start(offset))?;
        self.out.write_all(&local_header(
            name, method, UTF8_NAMES, self.time, self.date, 0, 0, 0,
        ))?;

        let mut crc = Crc::new();
        let mut sha = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = vec![0u8; CHUNK];
        let compressed = {
            let mut sink = Counting {
                inner: &mut self.out,
                count: 0,
            };
            match method {
                Method::Store => {
                    loop {
                        let n = read_some(&mut data, &mut buffer)?;
                        if n == 0 {
                            break;
                        }
                        crc.update(&buffer[..n]);
                        sha.update(&buffer[..n]);
                        bytes += n as u64;
                        sink.write_all(&buffer[..n])?;
                    }
                    sink.count
                }
                Method::Deflate => {
                    let mut encoder = DeflateEncoder::new(&mut sink, Compression::default());
                    loop {
                        let n = read_some(&mut data, &mut buffer)?;
                        if n == 0 {
                            break;
                        }
                        crc.update(&buffer[..n]);
                        sha.update(&buffer[..n]);
                        bytes += n as u64;
                        encoder.write_all(&buffer[..n])?;
                    }
                    encoder.finish()?;
                    sink.count
                }
            }
        };
        let header_len = LOCAL_LEN + name.len() as u64;
        let end = offset + header_len + compressed;
        if bytes > MAX_ARCHIVE_BYTES || compressed > MAX_ARCHIVE_BYTES || end > MAX_ARCHIVE_BYTES {
            return Err(WriteError::TooLarge);
        }

        // The CRC and the two sizes, in place: offsets 14 to 26 of the header.
        self.out.seek(SeekFrom::Start(offset + 14))?;
        self.out.write_all(&crc.sum().to_le_bytes())?;
        self.out.write_all(&(compressed as u32).to_le_bytes())?;
        self.out.write_all(&(bytes as u32).to_le_bytes())?;
        self.out.seek(SeekFrom::Start(end))?;
        self.offset = end;

        self.entries.push(Written {
            name: name.to_string(),
            bytes,
            sha256: hex::encode(sha.finalize()),
            method,
            crc: crc.sum(),
            compressed,
            offset,
        });
        Ok(self.entries.last().expect("just pushed"))
    }

    /// Write the central directory and the end record, and hand back the
    /// output with its total length.
    ///
    /// # Errors
    ///
    /// [`WriteError::TooLarge`] when the directory would pass 4 GiB;
    /// [`WriteError::Io`] when the disk fails.
    pub fn finish(mut self) -> Result<(W, u64), WriteError> {
        let start = self.offset;
        self.out.seek(SeekFrom::Start(start))?;
        let mut directory = Vec::new();
        for entry in &self.entries {
            directory.extend(central_record(
                &entry.name,
                entry.method,
                UTF8_NAMES,
                self.time,
                self.date,
                entry.crc,
                entry.compressed as u32,
                entry.bytes as u32,
                entry.offset as u32,
            ));
        }
        let total = start + directory.len() as u64 + END_LEN;
        if total > MAX_ARCHIVE_BYTES {
            return Err(WriteError::TooLarge);
        }
        self.out.write_all(&directory)?;
        self.out.write_all(&end_record(
            self.entries.len() as u16,
            directory.len() as u32,
            start as u32,
        ))?;
        self.out.flush()?;
        Ok((self.out, total))
    }
}

/// Read into `buffer` until it is full or the source ends, retrying an
/// interrupted read.
fn read_some(source: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match source.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

#[allow(clippy::too_many_arguments)]
fn local_header(
    name: &str,
    method: Method,
    flags: u16,
    time: u16,
    date: u16,
    crc: u32,
    compressed: u32,
    bytes: u32,
) -> Vec<u8> {
    let mut header = Vec::with_capacity(LOCAL_LEN as usize + name.len());
    header.extend_from_slice(&LOCAL_SIGNATURE.to_le_bytes());
    header.extend_from_slice(&VERSION.to_le_bytes());
    header.extend_from_slice(&flags.to_le_bytes());
    header.extend_from_slice(&method.code().to_le_bytes());
    header.extend_from_slice(&time.to_le_bytes());
    header.extend_from_slice(&date.to_le_bytes());
    header.extend_from_slice(&crc.to_le_bytes());
    header.extend_from_slice(&compressed.to_le_bytes());
    header.extend_from_slice(&bytes.to_le_bytes());
    header.extend_from_slice(&(name.len() as u16).to_le_bytes());
    header.extend_from_slice(&0u16.to_le_bytes());
    header.extend_from_slice(name.as_bytes());
    header
}

#[allow(clippy::too_many_arguments)]
fn central_record(
    name: &str,
    method: Method,
    flags: u16,
    time: u16,
    date: u16,
    crc: u32,
    compressed: u32,
    bytes: u32,
    offset: u32,
) -> Vec<u8> {
    let mut record = Vec::with_capacity(CENTRAL_LEN + name.len());
    record.extend_from_slice(&CENTRAL_SIGNATURE.to_le_bytes());
    record.extend_from_slice(&VERSION.to_le_bytes()); // made by: MS-DOS, 2.0
    record.extend_from_slice(&VERSION.to_le_bytes()); // needed
    record.extend_from_slice(&flags.to_le_bytes());
    record.extend_from_slice(&method.code().to_le_bytes());
    record.extend_from_slice(&time.to_le_bytes());
    record.extend_from_slice(&date.to_le_bytes());
    record.extend_from_slice(&crc.to_le_bytes());
    record.extend_from_slice(&compressed.to_le_bytes());
    record.extend_from_slice(&bytes.to_le_bytes());
    record.extend_from_slice(&(name.len() as u16).to_le_bytes());
    record.extend_from_slice(&0u16.to_le_bytes()); // extra
    record.extend_from_slice(&0u16.to_le_bytes()); // comment
    record.extend_from_slice(&0u16.to_le_bytes()); // disk
    record.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
    record.extend_from_slice(&0u32.to_le_bytes()); // external attributes
    record.extend_from_slice(&offset.to_le_bytes());
    record.extend_from_slice(name.as_bytes());
    record
}

fn end_record(entries: u16, directory_len: u32, directory_offset: u32) -> Vec<u8> {
    let mut end = Vec::with_capacity(END_LEN as usize);
    end.extend_from_slice(&END_SIGNATURE.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes()); // this disk
    end.extend_from_slice(&0u16.to_le_bytes()); // the directory's disk
    end.extend_from_slice(&entries.to_le_bytes());
    end.extend_from_slice(&entries.to_le_bytes());
    end.extend_from_slice(&directory_len.to_le_bytes());
    end.extend_from_slice(&directory_offset.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes()); // comment
    end
}

/// One entry, as the central directory declares it and its local header
/// repeats it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Its name, as the archive spells it — hostile until the caller has
    /// checked it.
    pub name: String,
    /// How it is kept.
    pub method: Method,
    /// Its size, as declared — never trusted while reading.
    pub size: u64,
    crc: u32,
    compressed: u64,
    data_offset: u64,
}

/// What reading one entry found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extracted {
    /// Bytes inflated and handed on.
    pub bytes: u64,
    /// Their SHA-256, as 64 lowercase hex digits.
    pub sha256: String,
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// An archive open for reading: its shape checked from end to start, its
/// entries listed, none of them read yet.
pub struct Reader<R: Read + Seek> {
    source: R,
    /// Every entry, in the order the archive holds them.
    pub entries: Vec<Entry>,
}

impl<R: Read + Seek> Reader<R> {
    /// Check the archive's shape and list its entries. Nothing is inflated.
    ///
    /// # Errors
    ///
    /// A [`ReadError`] naming the first thing that is not the shape this
    /// module writes.
    pub fn open(mut source: R, len: u64) -> Result<Self, ReadError> {
        if len > MAX_ARCHIVE_BYTES {
            return Err(ReadError::TooLarge);
        }
        let mut start = [0u8; 4];
        source.seek(SeekFrom::Start(0))?;
        if len < 4 || source.read_exact(&mut start).is_err() || u32_at(&start, 0) != LOCAL_SIGNATURE
        {
            return Err(ReadError::NotZip);
        }
        if len < LOCAL_LEN + END_LEN {
            return Err(ReadError::Incomplete);
        }

        let mut end = [0u8; END_LEN as usize];
        source.seek(SeekFrom::Start(len - END_LEN))?;
        source.read_exact(&mut end)?;
        if u32_at(&end, 0) != END_SIGNATURE {
            return Err(ReadError::Incomplete);
        }
        if u16_at(&end, 4) != 0 || u16_at(&end, 6) != 0 {
            return Err(ReadError::Shape("an archive in parts"));
        }
        let count = u16_at(&end, 8);
        if count != u16_at(&end, 10) {
            return Err(ReadError::Shape(
                "an entry count that disagrees with itself",
            ));
        }
        if count == u16::MAX {
            return Err(ReadError::Shape("a ZIP64 marker"));
        }
        let directory_len = u64::from(u32_at(&end, 12));
        let directory_offset = u64::from(u32_at(&end, 16));
        if u16_at(&end, 20) != 0 {
            return Err(ReadError::Shape("a comment"));
        }
        if directory_len > MAX_DIRECTORY_BYTES {
            return Err(ReadError::Shape("a central directory over 16 MiB"));
        }
        if directory_offset + directory_len != len - END_LEN {
            return Err(ReadError::Shape(
                "bytes between the central directory and its end record",
            ));
        }

        let mut directory = vec![0u8; directory_len as usize];
        source.seek(SeekFrom::Start(directory_offset))?;
        source.read_exact(&mut directory)?;

        let mut entries = Vec::with_capacity(usize::from(count));
        let mut at = 0usize;
        let mut expected_offset = 0u64;
        for _ in 0..count {
            if at + CENTRAL_LEN > directory.len() {
                return Err(ReadError::Shape(
                    "a central directory shorter than its count",
                ));
            }
            let record = &directory[at..at + CENTRAL_LEN];
            if u32_at(record, 0) != CENTRAL_SIGNATURE {
                return Err(ReadError::Shape("a central record without its signature"));
            }
            let flags = u16_at(record, 8);
            let method = match u16_at(record, 10) {
                0 => Method::Store,
                8 => Method::Deflate,
                _ => return Err(ReadError::Shape("a method other than store or deflate")),
            };
            if flags & !UTF8_NAMES != 0 {
                return Err(ReadError::Shape(
                    "encryption, a data descriptor or another flag",
                ));
            }
            if u16_at(record, 6) > VERSION {
                return Err(ReadError::Shape("a version this module does not write"));
            }
            let crc = u32_at(record, 16);
            let compressed = u32_at(record, 20);
            let size = u32_at(record, 24);
            let name_len = usize::from(u16_at(record, 28));
            let extra_len = u16_at(record, 30);
            let comment_len = u16_at(record, 32);
            let disk = u16_at(record, 34);
            let offset = u64::from(u32_at(record, 42));
            if compressed == u32::MAX || size == u32::MAX || offset == u64::from(u32::MAX) {
                return Err(ReadError::Shape("a ZIP64 marker"));
            }
            if extra_len != 0 || comment_len != 0 || disk != 0 {
                return Err(ReadError::Shape(
                    "an extra field, a comment or a disk number",
                ));
            }
            if name_len == 0 || name_len > MAX_NAME_BYTES {
                return Err(ReadError::Shape("a name that is empty or too long"));
            }
            if at + CENTRAL_LEN + name_len > directory.len() {
                return Err(ReadError::Shape("a name past the central directory"));
            }
            let name_bytes = &directory[at + CENTRAL_LEN..at + CENTRAL_LEN + name_len];
            let name = String::from_utf8_lossy(name_bytes).into_owned();
            if method == Method::Store && compressed != size {
                return Err(ReadError::Shape("a stored entry whose two sizes disagree"));
            }
            if offset != expected_offset {
                return Err(ReadError::Shape(
                    "entries that overlap, or a gap between them",
                ));
            }

            // The local header must say exactly what the record says.
            let mut local = vec![0u8; LOCAL_LEN as usize + name_len];
            if offset + local.len() as u64 > directory_offset {
                return Err(ReadError::Shape(
                    "a local header inside the central directory",
                ));
            }
            source.seek(SeekFrom::Start(offset))?;
            source.read_exact(&mut local)?;
            if u32_at(&local, 0) != LOCAL_SIGNATURE
                || u16_at(&local, 6) != flags
                || u16_at(&local, 8) != u16_at(record, 10)
                || u32_at(&local, 14) != crc
                || u32_at(&local, 18) != compressed
                || u32_at(&local, 22) != size
                || usize::from(u16_at(&local, 26)) != name_len
                || u16_at(&local, 28) != 0
                || &local[LOCAL_LEN as usize..] != name_bytes
            {
                return Err(ReadError::Shape(
                    "a local header that disagrees with its record",
                ));
            }
            let data_offset = offset + LOCAL_LEN + name_len as u64;
            let data_end = data_offset + u64::from(compressed);
            if data_end > directory_offset {
                return Err(ReadError::Shape(
                    "an entry that runs into the central directory",
                ));
            }
            expected_offset = data_end;
            entries.push(Entry {
                name,
                method,
                size: u64::from(size),
                crc,
                compressed: u64::from(compressed),
                data_offset,
            });
            at += CENTRAL_LEN + name_len;
        }
        if at != directory.len() {
            return Err(ReadError::Shape("more central records than its count"));
        }
        if expected_offset != directory_offset {
            return Err(ReadError::Shape(
                "bytes between the last entry and the directory",
            ));
        }
        Ok(Reader { source, entries })
    }

    /// Inflate entry `index` into `sink`, refusing it when its declared size
    /// is over `cap`, when it inflates to one byte more or less than it
    /// declares, or when its CRC fails. Nothing past its declared size plus
    /// one byte is ever inflated.
    ///
    /// # Errors
    ///
    /// [`ReadError::OverCap`], [`ReadError::SizeLies`], [`ReadError::Damaged`],
    /// or [`ReadError::Io`] when `sink` or the file fails.
    pub fn read(
        &mut self,
        index: usize,
        cap: u64,
        sink: &mut dyn Write,
    ) -> Result<Extracted, ReadError> {
        let entry = self.entries[index].clone();
        if entry.size > cap {
            return Err(ReadError::OverCap(entry.name));
        }
        self.source.seek(SeekFrom::Start(entry.data_offset))?;
        let raw = (&mut self.source).take(entry.compressed);
        let mut inflated: Box<dyn Read + '_> = match entry.method {
            Method::Store => Box::new(raw),
            Method::Deflate => Box::new(DeflateDecoder::new(raw)),
        };
        // Never trusting the header: one byte past what it declares is enough
        // to know it lied.
        let mut bounded = (&mut inflated).take(entry.size + 1);
        let mut crc = Crc::new();
        let mut sha = Sha256::new();
        let mut total = 0u64;
        let mut buffer = vec![0u8; CHUNK];
        loop {
            let n = match bounded.read(&mut buffer) {
                Ok(n) => n,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(ReadError::Damaged(entry.name)),
            };
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > entry.size {
                return Err(ReadError::SizeLies(entry.name));
            }
            crc.update(&buffer[..n]);
            sha.update(&buffer[..n]);
            sink.write_all(&buffer[..n]).map_err(ReadError::Io)?;
        }
        if total != entry.size {
            return Err(ReadError::SizeLies(entry.name));
        }
        if crc.sum() != entry.crc {
            return Err(ReadError::Damaged(entry.name));
        }
        Ok(Extracted {
            bytes: total,
            sha256: hex::encode(sha.finalize()),
        })
    }
}

#[cfg(test)]
pub mod raw {
    //! An archive built to order, for the hostile corpus: any name, any
    //! declared size, the same name twice — everything [`super::Writer`]
    //! would never write.

    use super::*;

    /// One entry of an archive built to order.
    #[derive(Clone)]
    pub struct RawEntry {
        /// Its name, written as given.
        pub name: String,
        /// How its data is kept.
        pub method: Method,
        /// Its data as written — already deflated for [`Method::Deflate`].
        pub data: Vec<u8>,
        /// The CRC both headers declare.
        pub crc: u32,
        /// The size both headers declare.
        pub size: u32,
    }

    impl RawEntry {
        /// An honest entry: its bytes, kept by `method`, declared as they are.
        pub fn honest(name: &str, method: Method, bytes: &[u8]) -> Self {
            let mut crc = Crc::new();
            crc.update(bytes);
            let data = match method {
                Method::Store => bytes.to_vec(),
                Method::Deflate => {
                    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
                    encoder.write_all(bytes).expect("deflate");
                    encoder.finish().expect("deflate")
                }
            };
            RawEntry {
                name: name.to_string(),
                method,
                data,
                crc: crc.sum(),
                size: bytes.len() as u32,
            }
        }
    }

    /// The archive's bytes: local headers and data one after another, the
    /// central directory, the end record — as [`super::Writer`] lays them out,
    /// with whatever the entries declare.
    pub fn build(entries: &[RawEntry]) -> Vec<u8> {
        let (time, date) = (0, 0x21);
        let mut out = Vec::new();
        let mut directory = Vec::new();
        for entry in entries {
            let offset = out.len() as u32;
            out.extend(local_header(
                &entry.name,
                entry.method,
                UTF8_NAMES,
                time,
                date,
                entry.crc,
                entry.data.len() as u32,
                entry.size,
            ));
            out.extend_from_slice(&entry.data);
            directory.extend(central_record(
                &entry.name,
                entry.method,
                UTF8_NAMES,
                time,
                date,
                entry.crc,
                entry.data.len() as u32,
                entry.size,
                offset,
            ));
        }
        let start = out.len() as u32;
        out.extend_from_slice(&directory);
        out.extend(end_record(
            entries.len() as u16,
            directory.len() as u32,
            start,
        ));
        out
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::raw::{build, RawEntry};
    use super::*;

    fn when() -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 10, 9)
            .unwrap()
            .and_hms_opt(14, 5, 30)
            .unwrap()
    }

    fn written(entries: &[(&str, Method, Vec<u8>)]) -> Vec<u8> {
        let mut writer = Writer::new(Cursor::new(Vec::new()), when());
        for (name, method, bytes) in entries {
            writer.add(name, *method, bytes.as_slice()).unwrap();
        }
        writer.finish().unwrap().0.into_inner()
    }

    fn open(bytes: &[u8]) -> Result<Reader<Cursor<&[u8]>>, ReadError> {
        Reader::open(Cursor::new(bytes), bytes.len() as u64)
    }

    fn read_all(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut reader = open(bytes).expect("open");
        (0..reader.entries.len())
            .map(|index| {
                let mut out = Vec::new();
                reader.read(index, u64::MAX, &mut out).expect("read");
                (reader.entries[index].name.clone(), out)
            })
            .collect()
    }

    #[test]
    fn what_is_written_reads_back_byte_for_byte_stored_and_deflated() {
        let text = b"a line that repeats\n".repeat(10_000);
        let binary: Vec<u8> = (0..200_000u32).map(|i| (i * 7919 % 251) as u8).collect();
        let bytes = written(&[
            ("manifest.json", Method::Store, b"{}".to_vec()),
            ("work.sqlite3", Method::Deflate, text.clone()),
            ("documents/a.pdf", Method::Store, binary.clone()),
            ("empty", Method::Deflate, Vec::new()),
        ]);

        assert_eq!(&bytes[..4], b"PK\x03\x04");
        assert!(
            bytes.len() < text.len() / 10 + binary.len() + 1024,
            "the text was deflated, the binary stored"
        );
        assert_eq!(
            read_all(&bytes),
            vec![
                ("manifest.json".to_string(), b"{}".to_vec()),
                ("work.sqlite3".to_string(), text),
                ("documents/a.pdf".to_string(), binary),
                ("empty".to_string(), Vec::new()),
            ]
        );
    }

    #[test]
    fn the_writer_reports_each_entry_s_size_and_hash() {
        let mut writer = Writer::new(Cursor::new(Vec::new()), when());
        let entry = writer
            .add("a", Method::Deflate, &b"abc"[..])
            .unwrap()
            .clone();
        assert_eq!(entry.bytes, 3);
        assert_eq!(
            entry.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn the_hand_built_archive_and_the_writer_agree_on_the_layout() {
        let honest = build(&[
            RawEntry::honest("a", Method::Store, b"one"),
            RawEntry::honest("b", Method::Deflate, b"two two two two"),
        ]);
        assert_eq!(
            read_all(&honest),
            vec![
                ("a".to_string(), b"one".to_vec()),
                ("b".to_string(), b"two two two two".to_vec())
            ]
        );
    }

    #[test]
    fn a_dos_time_is_the_local_time_to_two_seconds() {
        let (time, date) = dos_time(when());
        assert_eq!(date, ((2026 - 1980) << 9) | (10 << 5) | 9);
        assert_eq!(time, (14 << 11) | (5 << 5) | 15);
        let old = chrono::NaiveDate::from_ymd_opt(1970, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        assert_eq!(dos_time(old).1 >> 9, 0, "1980 at the earliest");
    }

    #[test]
    fn a_file_that_is_not_a_zip_or_is_cut_short_or_added_to_is_refused_by_its_shape() {
        assert!(matches!(open(b"%PDF-1.7\n"), Err(ReadError::NotZip)));
        assert!(matches!(open(b""), Err(ReadError::NotZip)));
        let whole = written(&[("a", Method::Store, b"hello".to_vec())]);
        for cut in [whole.len() - 1, whole.len() / 2, 34] {
            assert!(
                matches!(open(&whole[..cut]), Err(ReadError::Incomplete)),
                "cut at {cut}"
            );
        }
        let mut added = whole.clone();
        added.extend_from_slice(b"trailing");
        assert!(matches!(open(&added), Err(ReadError::Incomplete)));
        assert!(matches!(
            Reader::open(Cursor::new(&whole[..]), MAX_ARCHIVE_BYTES + 1),
            Err(ReadError::TooLarge)
        ));
    }

    #[test]
    fn a_declared_size_is_never_trusted_while_inflating() {
        // Declared 10 bytes; the data inflates to 1 MiB.
        let mut lying = RawEntry::honest("a", Method::Deflate, &vec![0u8; 1024 * 1024]);
        lying.size = 10;
        let bytes = build(&[lying]);
        let mut reader = open(&bytes).unwrap();
        let mut sink = Vec::new();
        assert!(matches!(
            reader.read(0, 1024, &mut sink),
            Err(ReadError::SizeLies(name)) if name == "a"
        ));
        assert!(
            sink.len() <= 10,
            "nothing past the declared size was handed on"
        );

        // Declared more than the cap: refused before a byte is inflated.
        let bytes = build(&[RawEntry::honest("b", Method::Deflate, &vec![0u8; 4096])]);
        let mut reader = open(&bytes).unwrap();
        let mut sink = Vec::new();
        assert!(matches!(
            reader.read(0, 4095, &mut sink),
            Err(ReadError::OverCap(name)) if name == "b"
        ));
        assert!(sink.is_empty());

        // Declared more than it holds.
        let mut short = RawEntry::honest("c", Method::Deflate, b"short");
        short.size = 100;
        let bytes = build(&[short]);
        assert!(matches!(
            open(&bytes).unwrap().read(0, 1000, &mut Vec::new()),
            Err(ReadError::SizeLies(_))
        ));

        // The right size, the wrong CRC.
        let mut flipped = RawEntry::honest("d", Method::Store, b"hello");
        flipped.crc ^= 1;
        let bytes = build(&[flipped]);
        assert!(matches!(
            open(&bytes).unwrap().read(0, 1000, &mut Vec::new()),
            Err(ReadError::Damaged(_))
        ));
    }

    #[test]
    fn a_zip_this_module_does_not_write_is_refused_by_its_shape() {
        let honest = build(&[
            RawEntry::honest("a", Method::Store, b"one"),
            RawEntry::honest("b", Method::Store, b"two"),
        ]);
        let directory_start = u32_at(&honest, honest.len() - 6) as usize;
        let patch = |at: usize, bytes: &[u8]| {
            let mut copy = honest.clone();
            copy[at..at + bytes.len()].copy_from_slice(bytes);
            copy
        };
        let cases: Vec<(&str, Vec<u8>)> = vec![
            (
                "method 12 (bzip2)",
                patch(directory_start + 10, &12u16.to_le_bytes()),
            ),
            ("encrypted", patch(directory_start + 8, &1u16.to_le_bytes())),
            (
                "data descriptor",
                patch(directory_start + 8, &8u16.to_le_bytes()),
            ),
            (
                "an extra field",
                patch(directory_start + 30, &4u16.to_le_bytes()),
            ),
            (
                "a comment on the archive",
                patch(honest.len() - 2, &1u16.to_le_bytes()),
            ),
            (
                "the local header's CRC differs",
                patch(14, &0xdead_beefu32.to_le_bytes()),
            ),
            (
                "a second entry pointing at the first",
                patch(directory_start + 46 + 1 + 42, &0u32.to_le_bytes()),
            ),
            (
                "a ZIP64 size",
                patch(directory_start + 24, &u32::MAX.to_le_bytes()),
            ),
        ];
        for (what, bytes) in cases {
            assert!(
                matches!(open(&bytes), Err(ReadError::Shape(_))),
                "{what}: {:?}",
                open(&bytes).err()
            );
        }
    }
}
