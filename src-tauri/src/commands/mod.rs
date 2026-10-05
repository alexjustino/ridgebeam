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

pub mod backup;
#[cfg(test)]
pub mod backup_tests;
pub mod care_notes;
pub mod change_orders;
#[cfg(test)]
mod change_orders_tests;
pub mod checks;
pub mod decisions;
pub mod diary;
pub mod documents;
pub mod funding;
#[cfg(test)]
mod handover_tests;
#[cfg(test)]
mod large_work_tests;
pub mod meetings;
#[cfg(test)]
mod meetings_tests;
pub mod milestones;
pub mod money;
pub mod plan;
pub mod purchases;
#[cfg(test)]
mod purchases_tests;
#[cfg(test)]
mod range_tests;
#[cfg(test)]
mod replanning_tests;
pub mod reports;
#[cfg(test)]
mod reports_tests;
pub mod rooms;
pub mod schedule;
pub mod settings;
pub mod snags;
#[cfg(test)]
mod snags_tests;
#[cfg(test)]
mod snapshot_tests;
pub mod system;
pub mod templates;
#[cfg(test)]
mod templates_tests;
pub mod work;
