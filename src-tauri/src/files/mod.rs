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

#[cfg(test)]
pub mod hostile;
pub mod intake;
