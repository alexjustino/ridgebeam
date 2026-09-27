//! The operating-system surface: everything only the host can do.
//!
//! Windows-only paths are behind `cfg(windows)` and every one of them has a
//! declared fallback. A native capability that is unavailable must degrade
//! visibly — the interface is told, and the person sees a plain surface rather
//! than a mysteriously wrong colour.
//!
//! In F0 there is exactly one such capability: the accent colour. This product
//! starts no processes and makes no network request; the files it writes are
//! inside the work folder a person chose in a dialog, and in the application
//! data folder (`crate::folder`, `crate::db`).
//!
//! F4 adds two: the account's display name, which signs a diary entry
//! (`account`), and opening a photo with the system's own handler (in
//! `crate::files::photos`, on the person's click).

pub mod accent;
pub mod account;
