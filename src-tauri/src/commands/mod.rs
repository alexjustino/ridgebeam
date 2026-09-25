//! The typed boundary between the host and the interface.
//!
//! A command is thin: it checks, delegates and returns. What a plan means —
//! readiness, the schedule, what is missing — lives in `src/domain/`
//! (TypeScript, pure); storage lives in `db`; the work folder lives in
//! `folder`; the operating system lives in `os`.
//!
//! Every command is `#[tauri::command(rename_all = "snake_case")]`: its
//! arguments are named in snake_case on the wire (`stage_id`), while the shapes
//! inside them are camelCase (`contract`). Every command that changes the plan
//! returns the fresh `WorkSnapshot`, so the interface replaces its copy instead
//! of patching it. No command writes progress.
//!
//! Each command is a one-line wrapper over a `*_with` function that takes the
//! state as plain references, which is what the tests call: the behaviour is
//! tested without a window.

pub mod decisions;
pub mod plan;
pub mod rooms;
pub mod schedule;
pub mod settings;
pub mod system;
pub mod work;
