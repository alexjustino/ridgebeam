//! A photo from an iPhone: HEIC, read by Windows' own decoder and kept as the
//! JPEG it becomes.
//!
//! The product compiles no HEIF or HEVC decoder. A HEVC decoder carries patent
//! licensing and size this product will not bundle; Windows already has the
//! one the person's Photos app uses — the Windows Imaging Component (WIC),
//! through the "HEIF Image Extensions" and "HEVC Video Extensions" from the
//! Microsoft Store. Where they are installed, [`to_jpeg`] hands WIC the bytes
//! and gets a JPEG back; where they are not, it says so, and the intake turns
//! that into a sentence that says how to get them. On a system that is not
//! Windows there is no such decoder, and a HEIC is refused as it always was.
//!
//! What happens to one file, in order (the intake has already read it under
//! its 25 MiB cap and found `ftyp` and a HEIF brand in its first bytes):
//!
//! 1. **On a thread of its own.** The decode runs on a new thread that
//!    initialises COM (multithreaded) and uninitialises it when it is done,
//!    joined before [`to_jpeg`] returns: no COM state touches the threads of
//!    the window or of the command.
//! 2. **From memory, never from a path.** The bytes reach WIC through a stream
//!    over the memory the intake already holds; no temporary file is written.
//! 3. **The HEIF decoder, by name.** WIC is asked for its HEIF decoder
//!    (`GUID_ContainerFormatHeif`), not for whichever decoder recognises the
//!    bytes. So whether the extensions are installed is known from the system,
//!    not guessed from a file — the hostile corpus's fake HEIC, garbage after
//!    `ftypheic`, is "could not read it" on a computer with the extensions and
//!    "install them" on one without — and no other codec ever sniffs the
//!    bytes. Failing to create that decoder is [`HeicRefusal::NoDecoder`]; so
//!    is a decode that fails with "component not found" or Media Foundation's
//!    "codec not found" (what a computer with the HEIF extension and without
//!    the HEVC one is expected to answer — not reproducible here, where both
//!    are installed). Any other failure is [`HeicRefusal::Unreadable`].
//! 4. **Measured before any pixel.** Frame 0 only (a Live Photo's video and a
//!    burst's other frames are not read). Its size is read, and refused over
//!    `MAX_PHOTO_SIDE` (12 000) on either side or over [`MAX_PIXELS`] in all —
//!    four bytes a pixel within `MAX_DECODE_ALLOC` (256 MiB), so a 48-MP
//!    iPhone photo (8064 × 6048) passes — before the buffer is allocated and
//!    before `CopyPixels` decodes anything.
//! 5. **Turned the way the camera held it** — see _Orientation_ below.
//! 6. **Copied out as 24-bit RGB** by WIC's format converter, straight into
//!    the buffer that becomes the image (24-bit rather than 32: one buffer of
//!    three bytes a pixel, not a 32-bit one and then a copy — for a 48-MP
//!    photo that is 146 MB at the peak instead of 341).
//! 7. **Encoded as JPEG at quality [`JPEG_QUALITY`]** by the `image` crate,
//!    with nothing but pixels: **no metadata is carried over**, so the copy
//!    has no location, no camera, no date. That is a privacy effect of the
//!    decision, not its reason (the reason is that the product keeps what it
//!    can show and thumbnail, and only the pixels are needed for that).
//!
//! The JPEG is deterministic: the same HEIC gives the same bytes every time,
//! so the same photo added twice is one copy (the intake names copies by
//! their hash). The tests hold it.
//!
//! # Orientation
//!
//! A HEIF image says how to turn it for display with two properties of the
//! image item, `irot` (a rotation by quarter turns, anticlockwise) and `imir`
//! (a mirror), and an iPhone also writes an EXIF orientation into the file's
//! Exif item. HEIF says `irot` and `imir` are what count. Applying both would
//! turn the photo twice.
//!
//! Found by experiment on this product's development machine (Windows 11,
//! HEIF Image Extensions 1.2.48, HEVC Video Extensions 2.5.33), by encoding
//! a 64 × 48 image with a red corner through WIC's own HEIF encoder and
//! decoding it again:
//!
//! - Setting `System.Photo.Orientation` (or `/heifProps/Orientation`) to 6
//!   on the encoder writes an `irot` box of 3 (three quarter turns
//!   anticlockwise — a quarter turn clockwise), and no Exif item; 3 writes
//!   `irot` 2; 2 writes `imir` with the vertical axis. The encoder never
//!   turns the pixels themselves.
//! - **The decoder applies `irot` and `imir` itself.** Decoding the `irot` 3
//!   file gives 48 × 64, the red corner top right — where a quarter turn
//!   clockwise puts it; `irot` 2 puts it bottom right; `imir` top right, the
//!   size unchanged.
//! - **And it then reports the orientation as 1.** `System.Photo.Orientation`
//!   and `/heifProps/Orientation` both read 1 on every one of those files: the
//!   value describes the pixels as decoded, which are already upright.
//! - **An EXIF orientation in the Exif item is ignored.** A file with an Exif
//!   item whose first IFD says 6 (`/ifd/{ushort=274}`, written by the encoder
//!   and checked in the bytes) and no `irot` decodes unturned, and reports 1;
//!   with `irot` 3 as well, it is turned once, not twice.
//!
//! So this module reads `System.Photo.Orientation` from the decoded frame and
//! applies it with WIC's flip-rotator — which, with the decoder above, is
//! always 1 and turns nothing. It is kept because the value's meaning is "how
//! to turn these pixels", and a decoder that reported a transform without
//! applying it would still give an upright photo; the EXIF tag is never read.
//! The tests hold the end result — the corner of an `irot` or `imir` file is
//! where the camera said, turned once — and, separately and without the
//! extensions, that each of the eight orientation values turns the pixels as
//! the `image` crate's own `apply_orientation` does.
//!
//! # Changelog of this module
//!
//! - G5: born. [`to_jpeg`], [`Kind`], [`Converted`], [`HeicRefusal`].

/// The quality the converted JPEG is encoded at.
pub const JPEG_QUALITY: u8 = 90;

/// The most pixels a HEIC may have to be converted: four bytes each within
/// the decode allocation cap (256 MiB) — 67 108 864.
pub const MAX_PIXELS: u64 = crate::files::intake::MAX_DECODE_ALLOC / 4;

/// What a HEIF file's brand says it is, in the words the person sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `heic`, `heix`, `hevc`, `hevx`: HEVC-coded, what an iPhone writes.
    Heic,
    /// `mif1`, `msf1`, `heim`, `heis`: the general HEIF brands, which may hold
    /// another codec than HEVC (AVIF in a `mif1` file, for one).
    Heif,
}

impl Kind {
    /// The kind of a file the intake sniffed as HEIF, by the major brand at
    /// bytes 8 to 12. Anything that is not an HEVC brand is [`Kind::Heif`].
    pub fn of(bytes: &[u8]) -> Kind {
        match bytes.get(8..12) {
            Some(b"heic" | b"heix" | b"hevc" | b"hevx") => Kind::Heic,
            _ => Kind::Heif,
        }
    }

    /// `HEIC` or `HEIF` — what `convertedFrom` says, and the sentences.
    pub fn label(self) -> &'static str {
        match self {
            Kind::Heic => "HEIC",
            Kind::Heif => "HEIF",
        }
    }
}

/// A HEIC, converted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Converted {
    /// The JPEG, with no metadata.
    pub jpeg: Vec<u8>,
    /// Its width, upright.
    pub width: u32,
    /// Its height, upright.
    pub height: u32,
    /// The orientation the decoded frame reported (1 to 8; 1 when it reported
    /// none) — 1 with the Windows decoder, which turns the pixels itself.
    pub orientation: u16,
}

/// Why a HEIC was not converted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeicRefusal {
    /// Windows on this computer has no decoder for it: the extensions are not
    /// installed.
    NoDecoder,
    /// The decoder is there and could not read these bytes.
    Unreadable,
    /// Wider or taller than 12 000 pixels.
    TooLarge,
    /// More than [`MAX_PIXELS`] pixels.
    TooManyPixels,
    /// Not Windows: there is no decoder to ask.
    NotOnThisSystem,
}

impl HeicRefusal {
    /// The sentence for the person, naming the file.
    pub fn sentence(self, file_name: &str, kind: Kind) -> String {
        let label = kind.label();
        match (self, kind) {
            (HeicRefusal::NoDecoder, Kind::Heic) => format!(
                "“{file_name}” is an iPhone photo (HEIC), and Windows on this computer cannot read HEIC yet: install “HEIF Image Extensions” and “HEVC Video Extensions” from the Microsoft Store, then add it again — or set the iPhone's Camera → Formats to Most Compatible."
            ),
            (HeicRefusal::NoDecoder, Kind::Heif) => format!(
                "“{file_name}” is a HEIF image, and Windows on this computer cannot read HEIF yet: install “HEIF Image Extensions” and “HEVC Video Extensions” from the Microsoft Store, then add it again."
            ),
            (HeicRefusal::Unreadable, _) => {
                format!("“{file_name}” looks like a {label} photo, but Windows could not read it.")
            }
            (HeicRefusal::TooLarge, _) => {
                format!("“{file_name}” was not added: it is larger than 12 000 × 12 000 pixels.")
            }
            (HeicRefusal::TooManyPixels, _) => format!(
                "“{file_name}” was not added: it has more than 67 million pixels, more than Ridgebeam converts."
            ),
            (HeicRefusal::NotOnThisSystem, _) => format!(
                "“{file_name}” was not added: it is a {label} photo, which this version cannot read — save it as JPEG first."
            ),
        }
    }
}

/// Convert a HEIC (or HEIF) to a JPEG through Windows' own decoder.
///
/// # Errors
///
/// A [`HeicRefusal`] saying why not; the intake makes it a sentence.
#[cfg(windows)]
pub fn to_jpeg(bytes: &[u8]) -> Result<Converted, HeicRefusal> {
    wic::convert(bytes, wic::Limits::PRODUCT, wic::heif_decoder)
}

/// On a system that is not Windows there is no decoder to ask.
///
/// # Errors
///
/// Always [`HeicRefusal::NotOnThisSystem`].
#[cfg(not(windows))]
pub fn to_jpeg(_bytes: &[u8]) -> Result<Converted, HeicRefusal> {
    Err(HeicRefusal::NotOnThisSystem)
}

/// The Windows half: WIC, on a COM thread of its own.
#[cfg(windows)]
pub(crate) mod wic {
    use windows::core::{Interface, HRESULT, PCWSTR};
    use windows::Win32::Foundation::{
        REGDB_E_CLASSNOTREG, WINCODEC_ERR_COMPONENTINITIALIZEFAILURE,
        WINCODEC_ERR_COMPONENTNOTFOUND,
    };
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_ContainerFormatHeif, GUID_WICPixelFormat24bppRGB,
        IWICBitmapDecoder, IWICBitmapFrameDecode, IWICBitmapSource, IWICImagingFactory,
        WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom, WICBitmapTransformFlipHorizontal,
        WICBitmapTransformFlipVertical, WICBitmapTransformOptions, WICBitmapTransformRotate180,
        WICBitmapTransformRotate270, WICBitmapTransformRotate90, WICDecodeMetadataCacheOnDemand,
    };
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Variant::VT_UI2;

    use super::{Converted, HeicRefusal, JPEG_QUALITY};
    use crate::files::intake::{MAX_DECODE_ALLOC, MAX_PHOTO_SIDE};

    /// Media Foundation's "no codec": what a HEVC decode is expected to answer
    /// when the HEVC extension is missing and the HEIF one is not.
    const MF_E_TOPO_CODEC_NOT_FOUND: HRESULT = HRESULT(0xC00D_5212_u32 as i32);

    /// The sizes checked before any pixel.
    #[derive(Debug, Clone, Copy)]
    pub struct Limits {
        /// The widest and tallest, in pixels.
        pub max_side: u32,
        /// The most bytes four bytes a pixel may come to.
        pub max_alloc: u64,
    }

    impl Limits {
        /// The product's: `MAX_PHOTO_SIDE` and `MAX_DECODE_ALLOC`.
        pub const PRODUCT: Limits = Limits {
            max_side: MAX_PHOTO_SIDE,
            max_alloc: MAX_DECODE_ALLOC,
        };
    }

    /// How the HEIF decoder is made. The product's is [`heif_decoder`]; a
    /// test hands one that fails as a computer without the extensions does.
    pub type OpenDecoder = fn(&IWICImagingFactory) -> windows::core::Result<IWICBitmapDecoder>;

    /// WIC's HEIF decoder, by its container format — never chosen by the bytes.
    pub fn heif_decoder(factory: &IWICImagingFactory) -> windows::core::Result<IWICBitmapDecoder> {
        // SAFETY: a GUID that lives for the call, and no vendor (null).
        unsafe { factory.CreateDecoder(&GUID_ContainerFormatHeif, std::ptr::null()) }
    }

    /// COM on this thread, multithreaded, until dropped.
    struct Com;

    impl Com {
        fn init() -> Option<Com> {
            // SAFETY: called once, on a thread this module created.
            let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            result.is_ok().then_some(Com)
        }
    }

    impl Drop for Com {
        fn drop(&mut self) {
            // SAFETY: paired with the successful `CoInitializeEx` above, on the
            // same thread, after every COM object of it was dropped.
            unsafe { CoUninitialize() }
        }
    }

    /// Run `work` on a new thread with COM initialised, and wait for it.
    /// `None` when COM could not be initialised or the thread did not finish.
    pub fn on_com_thread<T: Send>(work: impl FnOnce() -> T + Send) -> Option<T> {
        std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    let com = Com::init()?;
                    let result = work();
                    drop(com);
                    Some(result)
                })
                .join()
                .ok()
                .flatten()
        })
    }

    /// The WIC factory, on a thread where COM is initialised.
    pub fn factory() -> windows::core::Result<IWICImagingFactory> {
        // SAFETY: called only from `on_com_thread`'s work.
        unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }
    }

    /// `to_jpeg`, with its limits and its decoder handed in.
    pub fn convert(
        bytes: &[u8],
        limits: Limits,
        open: OpenDecoder,
    ) -> Result<Converted, HeicRefusal> {
        let (pixels, width, height, orientation) = on_com_thread(|| decode(bytes, limits, open))
            .unwrap_or(Err(HeicRefusal::Unreadable))?;
        // COM is done with; the encode is the `image` crate's.
        let image =
            image::RgbImage::from_raw(width, height, pixels).ok_or(HeicRefusal::Unreadable)?;
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
            .encode_image(&image)
            .map_err(|_| HeicRefusal::Unreadable)?;
        Ok(Converted {
            jpeg,
            width,
            height,
            orientation,
        })
    }

    /// What a failure inside the decode means: the codec is missing, or the
    /// bytes could not be read.
    pub fn classify(code: HRESULT) -> HeicRefusal {
        if [
            WINCODEC_ERR_COMPONENTNOTFOUND,
            WINCODEC_ERR_COMPONENTINITIALIZEFAILURE,
            REGDB_E_CLASSNOTREG,
            MF_E_TOPO_CODEC_NOT_FOUND,
        ]
        .contains(&code)
        {
            HeicRefusal::NoDecoder
        } else {
            HeicRefusal::Unreadable
        }
    }

    /// Whether `width` × `height` is within `limits`.
    ///
    /// # Errors
    ///
    /// The refusal for a size that is not.
    pub fn check_size(width: u32, height: u32, limits: Limits) -> Result<(), HeicRefusal> {
        if width == 0 || height == 0 {
            return Err(HeicRefusal::Unreadable);
        }
        if width > limits.max_side || height > limits.max_side {
            return Err(HeicRefusal::TooLarge);
        }
        if u64::from(width) * u64::from(height) * 4 > limits.max_alloc {
            return Err(HeicRefusal::TooManyPixels);
        }
        Ok(())
    }

    /// The transform that turns pixels of EXIF orientation `value` upright —
    /// WIC flips first, then rotates clockwise (so a transpose, 5, is a flip
    /// and three quarter turns — the test against the `image` crate found the
    /// order). `None` for 1 and for anything that is not 1 to 8.
    pub fn transform_for(value: u16) -> Option<WICBitmapTransformOptions> {
        let flip = WICBitmapTransformFlipHorizontal.0;
        Some(match value {
            2 => WICBitmapTransformFlipHorizontal,
            3 => WICBitmapTransformRotate180,
            4 => WICBitmapTransformFlipVertical,
            5 => WICBitmapTransformOptions(WICBitmapTransformRotate270.0 | flip),
            6 => WICBitmapTransformRotate90,
            7 => WICBitmapTransformOptions(WICBitmapTransformRotate90.0 | flip),
            8 => WICBitmapTransformRotate270,
            _ => return None,
        })
    }

    /// The orientation the frame reports, 1 when it reports none.
    fn orientation_of(frame: &IWICBitmapFrameDecode) -> u16 {
        let name: Vec<u16> = "System.Photo.Orientation"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // SAFETY: `name` is NUL-terminated and outlives the call; the variant
        // is read only as the type it says it holds, then cleared.
        unsafe {
            let Ok(reader) = frame.GetMetadataQueryReader() else {
                return 1;
            };
            let mut value = PROPVARIANT::default();
            if reader
                .GetMetadataByName(PCWSTR(name.as_ptr()), &mut value)
                .is_err()
            {
                return 1;
            }
            let found = if value.Anonymous.Anonymous.vt == VT_UI2 {
                value.Anonymous.Anonymous.Anonymous.uiVal
            } else {
                1
            };
            let _ = PropVariantClear(&mut value);
            if (1..=8).contains(&found) {
                found
            } else {
                1
            }
        }
    }

    /// Frame 0 of `bytes`, measured, turned and copied out as RGB — on a COM
    /// thread. Every COM object is dropped before it returns.
    fn decode(
        bytes: &[u8],
        limits: Limits,
        open: OpenDecoder,
    ) -> Result<(Vec<u8>, u32, u32, u16), HeicRefusal> {
        let failed = |error: windows::core::Error| classify(error.code());
        // WIC itself is part of Windows; if it cannot be made, Windows could
        // not read the photo.
        let factory = factory().map_err(|_| HeicRefusal::Unreadable)?;
        let decoder = open(&factory).map_err(|_| HeicRefusal::NoDecoder)?;
        // SAFETY: the stream reads `bytes`, which outlive every object made
        // here — all of them are dropped before this function returns.
        unsafe {
            let stream = factory.CreateStream().map_err(failed)?;
            stream.InitializeFromMemory(bytes).map_err(failed)?;
            decoder
                .Initialize(&stream, WICDecodeMetadataCacheOnDemand)
                .map_err(failed)?;
            let frame = decoder.GetFrame(0).map_err(failed)?;
            let (mut width, mut height) = (0u32, 0u32);
            frame.GetSize(&mut width, &mut height).map_err(failed)?;
            // Before any pixel. A turn swaps the sides, and the limits are
            // the same both ways.
            check_size(width, height, limits)?;

            let orientation = orientation_of(&frame);
            let upright: IWICBitmapSource = match transform_for(orientation) {
                None => frame.cast().map_err(failed)?,
                Some(transform) => {
                    let rotator = factory.CreateBitmapFlipRotator().map_err(failed)?;
                    rotator.Initialize(&frame, transform).map_err(failed)?;
                    rotator.cast().map_err(failed)?
                }
            };
            upright.GetSize(&mut width, &mut height).map_err(failed)?;
            check_size(width, height, limits)?;

            let converter = factory.CreateFormatConverter().map_err(failed)?;
            converter
                .Initialize(
                    &upright,
                    &GUID_WICPixelFormat24bppRGB,
                    WICBitmapDitherTypeNone,
                    None,
                    0.0,
                    WICBitmapPaletteTypeCustom,
                )
                .map_err(failed)?;
            let stride = width * 3;
            let size = stride as usize * height as usize;
            let mut pixels = Vec::new();
            pixels
                .try_reserve_exact(size)
                .map_err(|_| HeicRefusal::TooManyPixels)?;
            pixels.resize(size, 0);
            converter
                .CopyPixels(std::ptr::null(), stride, &mut pixels)
                .map_err(failed)?;
            Ok((pixels, width, height, orientation))
        }
    }
}

/// Real HEIC files, made on the fly by WIC's own HEIF encoder — synthetic
/// pixels, no metadata but an orientation when asked. Every helper answers
/// `None` where the encoder is not installed, and the tests that need one
/// skip, saying why.
#[cfg(all(test, windows))]
pub mod testing {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::Graphics::Imaging::{
        GUID_ContainerFormatHeif, GUID_WICPixelFormat24bppRGB, IWICImagingFactory,
        WICBitmapEncoderNoCache,
    };
    use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, PROPVARIANT};
    use windows::Win32::System::Com::{IStream, STREAM_SEEK_END, STREAM_SEEK_SET};
    use windows::Win32::System::Variant::VT_UI2;

    use super::wic;

    /// Encode `image` as HEIC, with `orientation` written as the camera would
    /// (`irot`/`imir`) when given. `None` when the encoder is not installed.
    pub fn encode(image: &image::RgbImage, orientation: Option<u16>) -> Option<Vec<u8>> {
        wic::on_com_thread(|| {
            let factory = wic::factory().ok()?;
            // SAFETY: every buffer handed to WIC outlives the call it is
            // handed to; the stream is read back before it is dropped.
            unsafe { encode_with(&factory, image, orientation) }
        })
        .flatten()
    }

    unsafe fn encode_with(
        factory: &IWICImagingFactory,
        image: &image::RgbImage,
        orientation: Option<u16>,
    ) -> Option<Vec<u8>> {
        // SAFETY: as `encode` says.
        unsafe {
            let encoder = factory
                .CreateEncoder(&GUID_ContainerFormatHeif, std::ptr::null())
                .ok()?;
            let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true).ok()?;
            encoder.Initialize(&stream, WICBitmapEncoderNoCache).ok()?;
            let mut frame = None;
            let mut options = None;
            encoder.CreateNewFrame(&mut frame, &mut options).ok()?;
            let frame = frame?;
            frame.Initialize(options.as_ref()).ok()?;
            frame.SetSize(image.width(), image.height()).ok()?;
            let mut format = GUID_WICPixelFormat24bppRGB;
            frame.SetPixelFormat(&mut format).ok()?;
            if let Some(value) = orientation {
                let writer = frame.GetMetadataQueryWriter().ok()?;
                let mut variant = PROPVARIANT::default();
                (*variant.Anonymous.Anonymous).vt = VT_UI2;
                (*variant.Anonymous.Anonymous).Anonymous.uiVal = value;
                let name: Vec<u16> = "System.Photo.Orientation"
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                writer
                    .SetMetadataByName(PCWSTR(name.as_ptr()), &variant)
                    .ok()?;
            }
            // Whatever format the encoder asked for, hand it RGB through a
            // bitmap and let it convert.
            let bitmap = factory
                .CreateBitmapFromMemory(
                    image.width(),
                    image.height(),
                    &GUID_WICPixelFormat24bppRGB,
                    image.width() * 3,
                    image.as_raw(),
                )
                .ok()?;
            frame.WriteSource(&bitmap, std::ptr::null()).ok()?;
            frame.Commit().ok()?;
            encoder.Commit().ok()?;
            read_all(&stream)
        }
    }

    unsafe fn read_all(stream: &IStream) -> Option<Vec<u8>> {
        // SAFETY: `out` holds `end` bytes, as the read is told.
        unsafe {
            let mut end = 0u64;
            stream.Seek(0, STREAM_SEEK_END, Some(&mut end)).ok()?;
            stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
            let length = u32::try_from(end).ok()?;
            let mut out = vec![0u8; length as usize];
            let mut read = 0u32;
            stream
                .Read(out.as_mut_ptr().cast(), length, Some(&mut read))
                .ok()
                .ok()?;
            out.truncate(read as usize);
            Some(out)
        }
    }

    /// Whether this computer can decode HEIC: the HEIF decoder can be made.
    pub fn decoder_present() -> bool {
        wic::on_com_thread(|| {
            wic::factory()
                .and_then(|factory| wic::heif_decoder(&factory))
                .is_ok()
        })
        .unwrap_or(false)
    }

    /// A synthetic photo: a gradient, a red block in the top-left corner.
    pub fn gradient(width: u32, height: u32) -> image::RgbImage {
        image::RgbImage::from_fn(width, height, |x, y| {
            if x < width / 4 && y < height / 4 {
                image::Rgb([230, 20, 20])
            } else {
                image::Rgb([
                    40,
                    (x * 200 / width.max(1)) as u8 + 20,
                    (y * 200 / height.max(1)) as u8 + 20,
                ])
            }
        })
    }

    /// A HEIC of [`gradient`], or `None` — the reason printed — when this
    /// computer cannot both encode and decode one: the test then skips.
    pub fn heic_or_skip(
        test: &str,
        width: u32,
        height: u32,
        orientation: Option<u16>,
    ) -> Option<Vec<u8>> {
        if !decoder_present() {
            eprintln!(
                "{test}: skipped — Windows on this computer has no HEIF decoder (the HEIF and HEVC extensions are not installed)"
            );
            return None;
        }
        let made = encode(&gradient(width, height), orientation);
        if made.is_none() {
            eprintln!(
                "{test}: skipped — Windows on this computer has no HEIF encoder to make a test photo with"
            );
        }
        made
    }

    /// Whether a pixel is the red of the corner block, within JPEG tolerance.
    pub fn is_red(pixel: &image::Rgb<u8>) -> bool {
        pixel[0] > 180 && pixel[1] < 90 && pixel[2] < 90
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brand_decides_the_word_and_only_hevc_brands_are_heic() {
        let with = |brand: &[u8; 4]| {
            let mut bytes = vec![0, 0, 0, 24];
            bytes.extend_from_slice(b"ftyp");
            bytes.extend_from_slice(brand);
            bytes
        };
        for brand in [b"heic", b"heix", b"hevc", b"hevx"] {
            assert_eq!(Kind::of(&with(brand)), Kind::Heic);
        }
        for brand in [b"mif1", b"msf1", b"heim", b"heis"] {
            assert_eq!(Kind::of(&with(brand)), Kind::Heif);
        }
        assert_eq!(Kind::Heic.label(), "HEIC");
        assert_eq!(Kind::Heif.label(), "HEIF");
    }

    #[test]
    fn every_refusal_is_a_sentence_that_names_the_file() {
        for refusal in [
            HeicRefusal::NoDecoder,
            HeicRefusal::Unreadable,
            HeicRefusal::TooLarge,
            HeicRefusal::TooManyPixels,
            HeicRefusal::NotOnThisSystem,
        ] {
            for kind in [Kind::Heic, Kind::Heif] {
                let sentence = refusal.sentence("IMG_0001.HEIC", kind);
                assert!(sentence.starts_with("“IMG_0001.HEIC”"), "{sentence}");
                assert!(sentence.contains(kind.label()) || sentence.contains("pixels"));
                assert!(sentence.ends_with('.'), "{sentence}");
            }
        }
        assert_eq!(
            HeicRefusal::NoDecoder.sentence("IMG_0001.HEIC", Kind::Heic),
            "“IMG_0001.HEIC” is an iPhone photo (HEIC), and Windows on this computer cannot read HEIC yet: install “HEIF Image Extensions” and “HEVC Video Extensions” from the Microsoft Store, then add it again — or set the iPhone's Camera → Formats to Most Compatible."
        );
        assert_eq!(
            HeicRefusal::Unreadable.sentence("IMG_0001.heic", Kind::Heic),
            "“IMG_0001.heic” looks like a HEIC photo, but Windows could not read it."
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn elsewhere_than_windows_a_heic_is_refused_as_before() {
        assert_eq!(to_jpeg(b"anything"), Err(HeicRefusal::NotOnThisSystem));
    }

    #[cfg(windows)]
    mod on_windows {
        use windows::Win32::Foundation::{E_FAIL, WINCODEC_ERR_COMPONENTNOTFOUND};
        use windows::Win32::Graphics::Imaging::{
            GUID_WICPixelFormat24bppRGB, IWICBitmapDecoder, IWICBitmapSource, IWICImagingFactory,
        };

        use super::super::testing::{self, gradient, heic_or_skip, is_red};
        use super::super::wic::{self, Limits};
        use super::super::*;

        fn no_extensions(_: &IWICImagingFactory) -> windows::core::Result<IWICBitmapDecoder> {
            Err(WINCODEC_ERR_COMPONENTNOTFOUND.into())
        }

        #[test]
        fn without_the_extensions_it_says_so_before_reading_a_byte() {
            // The seam fails as `CreateDecoder` does on a computer without the
            // HEIF extension; the bytes are never looked at.
            let refused = wic::convert(b"\0\0\0\x18ftypheic", Limits::PRODUCT, no_extensions);
            assert_eq!(refused, Err(HeicRefusal::NoDecoder));
        }

        #[test]
        fn a_missing_codec_is_told_apart_from_a_damaged_file() {
            assert_eq!(
                wic::classify(WINCODEC_ERR_COMPONENTNOTFOUND),
                HeicRefusal::NoDecoder
            );
            assert_eq!(
                wic::classify(windows::core::HRESULT(0xC00D_5212_u32 as i32)),
                HeicRefusal::NoDecoder
            );
            assert_eq!(wic::classify(E_FAIL), HeicRefusal::Unreadable);
        }

        #[test]
        fn the_size_is_refused_before_any_pixel() {
            let limits = Limits::PRODUCT;
            assert_eq!(wic::check_size(8064, 6048, limits), Ok(()), "48 MP passes");
            assert_eq!(
                wic::check_size(12_001, 10, limits),
                Err(HeicRefusal::TooLarge)
            );
            assert_eq!(
                wic::check_size(10, 12_001, limits),
                Err(HeicRefusal::TooLarge)
            );
            assert_eq!(
                wic::check_size(12_000, 12_000, limits),
                Err(HeicRefusal::TooManyPixels),
                "within the sides, past 256 MiB at four bytes a pixel"
            );
            assert_eq!(wic::check_size(0, 10, limits), Err(HeicRefusal::Unreadable));
        }

        #[test]
        fn a_real_heic_over_the_limits_is_refused_before_copy_pixels() {
            let Some(heic) = heic_or_skip("limits", 64, 48, None) else {
                return;
            };
            let narrow = Limits {
                max_side: 63,
                max_alloc: u64::MAX,
            };
            assert_eq!(
                wic::convert(&heic, narrow, wic::heif_decoder),
                Err(HeicRefusal::TooLarge)
            );
            let few = Limits {
                max_side: 12_000,
                max_alloc: 64 * 48 * 4 - 1,
            };
            assert_eq!(
                wic::convert(&heic, few, wic::heif_decoder),
                Err(HeicRefusal::TooManyPixels)
            );
        }

        /// The eight EXIF orientations, through WIC's flip-rotator on a
        /// bitmap in memory (WIC itself, no extension needed), against the
        /// `image` crate's own `apply_orientation`: two implementations, one
        /// answer.
        #[test]
        fn each_orientation_turns_the_pixels_as_the_image_crate_does() {
            let source = image::RgbImage::from_fn(5, 3, |x, y| {
                image::Rgb([(x * 50) as u8, (y * 80) as u8, (x + y * 5) as u8])
            });
            for value in 1..=8u16 {
                let by_wic = wic::on_com_thread(|| {
                    // SAFETY: the pixels outlive the bitmap made over them.
                    unsafe {
                        let factory = wic::factory().unwrap();
                        let bitmap = factory
                            .CreateBitmapFromMemory(
                                5,
                                3,
                                &GUID_WICPixelFormat24bppRGB,
                                15,
                                source.as_raw(),
                            )
                            .unwrap();
                        let upright: IWICBitmapSource = match wic::transform_for(value) {
                            None => windows::core::Interface::cast(&bitmap).unwrap(),
                            Some(transform) => {
                                let rotator = factory.CreateBitmapFlipRotator().unwrap();
                                rotator.Initialize(&bitmap, transform).unwrap();
                                windows::core::Interface::cast(&rotator).unwrap()
                            }
                        };
                        let (mut w, mut h) = (0, 0);
                        upright.GetSize(&mut w, &mut h).unwrap();
                        let mut out = vec![0u8; (w * h * 3) as usize];
                        upright
                            .CopyPixels(std::ptr::null(), w * 3, &mut out)
                            .unwrap();
                        image::RgbImage::from_raw(w, h, out).unwrap()
                    }
                })
                .expect("COM on a thread of its own");
                let mut by_crate = image::DynamicImage::ImageRgb8(source.clone());
                by_crate.apply_orientation(
                    image::metadata::Orientation::from_exif(value as u8).unwrap(),
                );
                assert_eq!(by_wic, by_crate.to_rgb8(), "orientation {value}");
            }
        }

        #[test]
        fn a_heic_becomes_a_jpeg_of_the_same_size_with_the_corner_where_it_was() {
            let Some(heic) = heic_or_skip("convert", 64, 48, None) else {
                return;
            };
            let converted = to_jpeg(&heic).unwrap();
            assert_eq!((converted.width, converted.height), (64, 48));
            assert_eq!(converted.orientation, 1);
            assert!(converted.jpeg.starts_with(&[0xFF, 0xD8, 0xFF]));
            let back = image::load_from_memory(&converted.jpeg).unwrap().to_rgb8();
            assert_eq!(back.dimensions(), (64, 48));
            assert!(is_red(back.get_pixel(4, 4)), "{:?}", back.get_pixel(4, 4));
            assert!(!is_red(back.get_pixel(59, 4)));
            assert!(!is_red(back.get_pixel(4, 43)));
        }

        #[test]
        fn the_same_heic_twice_is_the_same_jpeg_to_the_byte() {
            let Some(heic) = heic_or_skip("determinism", 64, 48, Some(6)) else {
                return;
            };
            assert_eq!(to_jpeg(&heic).unwrap().jpeg, to_jpeg(&heic).unwrap().jpeg);
        }

        /// What the camera said — `irot`/`imir`, written by the encoder — is
        /// where the corner lands: turned once, and reported as 1.
        #[test]
        fn a_turned_heic_is_upright_and_turned_once() {
            // (orientation, size after, a point of the corner that is red after)
            type Case = (u16, (u32, u32), (u32, u32));
            let cases: [Case; 4] = [
                (6, (48, 64), (43, 4)),
                (3, (64, 48), (59, 43)),
                (8, (48, 64), (4, 59)),
                (2, (64, 48), (59, 4)),
            ];
            for (value, size, corner) in cases {
                let Some(heic) = heic_or_skip("orientation", 64, 48, Some(value)) else {
                    return;
                };
                let converted = to_jpeg(&heic).unwrap();
                assert_eq!(converted.orientation, 1, "{value}: the decoder turned it");
                let back = image::load_from_memory(&converted.jpeg).unwrap().to_rgb8();
                assert_eq!(back.dimensions(), size, "{value}");
                assert!(
                    is_red(back.get_pixel(corner.0, corner.1)),
                    "{value}: {:?} at {corner:?}",
                    back.get_pixel(corner.0, corner.1)
                );
                let opposite = (size.0 - 1 - corner.0, size.1 - 1 - corner.1);
                assert!(!is_red(back.get_pixel(opposite.0, opposite.1)), "{value}");
            }
        }

        #[test]
        fn a_mif1_heif_is_read_too() {
            let Some(mut heif) = heic_or_skip("mif1", 64, 48, None) else {
                return;
            };
            // The same file with `mif1` as its major brand — the general HEIF
            // brand, which the encoder already lists as compatible.
            heif[8..12].copy_from_slice(b"mif1");
            assert_eq!(Kind::of(&heif), Kind::Heif);
            let converted = to_jpeg(&heif).unwrap();
            assert_eq!((converted.width, converted.height), (64, 48));
        }

        #[test]
        fn garbage_after_a_heic_brand_is_unreadable_where_the_decoder_is_installed() {
            if !testing::decoder_present() {
                eprintln!("garbage: skipped — no HEIF decoder on this computer");
                return;
            }
            let mut bytes = vec![0, 0, 0, 24];
            bytes.extend_from_slice(b"ftypheic");
            bytes.extend_from_slice(&[0; 32]);
            assert_eq!(to_jpeg(&bytes), Err(HeicRefusal::Unreadable));
        }

        /// How long a 12-MP conversion takes on this computer. Not part of
        /// `cargo test`: run it by name.
        #[test]
        #[ignore]
        fn measure_a_12_mp_conversion() {
            let started = std::time::Instant::now();
            let Some(heic) = heic_or_skip("measure", 4032, 3024, Some(6)) else {
                return;
            };
            println!("12 MP: encoded for the test in {:?}", started.elapsed());
            for _ in 0..3 {
                let started = std::time::Instant::now();
                let converted = to_jpeg(&heic).unwrap();
                println!(
                    "12 MP: {} bytes of HEIC → {} bytes of JPEG, {} × {}, in {:?}",
                    heic.len(),
                    converted.jpeg.len(),
                    converted.width,
                    converted.height,
                    started.elapsed()
                );
            }
        }

        /// Write `e2e/fixtures/synthetic-photo.heic`: 256 × 192, a gradient,
        /// a red corner and a disc, encoded by WIC here — synthetic by
        /// construction, no text, no metadata. Not part of `cargo test`: run
        /// it by name, once, on a computer with the encoder.
        #[test]
        #[ignore]
        fn write_e2e_heic_fixture() {
            let base = gradient(256, 192);
            let image = image::RgbImage::from_fn(256, 192, |x, y| {
                let (dx, dy) = (x as i32 - 176, y as i32 - 104);
                if dx * dx + dy * dy < 48 * 48 {
                    image::Rgb([240, 180, 40])
                } else {
                    *base.get_pixel(x, y)
                }
            });
            let heic = testing::encode(&image, None).expect("this computer has the HEIF encoder");
            assert!(!heic.windows(4).any(|w| w == b"Exif"), "no Exif item");
            assert_eq!(Kind::of(&heic), Kind::Heic);
            let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("the repository root")
                .join("e2e")
                .join("fixtures")
                .join("synthetic-photo.heic");
            std::fs::create_dir_all(path.parent().expect("a parent")).expect("the folder");
            std::fs::write(&path, &heic).expect("the fixture is written");
            println!("wrote {} ({} bytes)", path.display(), heic.len());
        }
    }
}
