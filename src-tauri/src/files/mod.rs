//! The work folder's files: what the host copies in, and what it hands back.
//!
//! Every path this module touches is inside the work folder or one a person
//! chose (SECURITY.md, "Minimum capabilities"). Nothing here is reachable from
//! the webview except through a command, and no command hands the webview a
//! path.
//!
//! # Changelog of this module
//!
//! - F4: `photos` — the diary's photos, copied in under caps.
//! - F7: `photos` becomes `intake`, the general pipeline: images and PDFs by
//!   their bytes, everything else refused; `hostile`, the corpus it is held
//!   to, generated in `cargo test` against a committed manifest.
//! - F9: `templates` — a template file read as text and written whole, under
//!   a cap, `.json` only, never parsed by the host.
//! - F10: `save` — the one path every file the host saves to a place a person
//!   chose takes (a template, a report, an export): whole or not at all, by
//!   extension, under a cap, replaced only when the save dialog chose it.

#[cfg(test)]
pub mod hostile;
pub mod intake;
pub mod save;
pub mod templates;
