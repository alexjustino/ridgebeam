//! Ridgebeam — a works planner: the plan is intent, the diary is fact, and the
//! plan says what it does not yet know.
//!
//! # Layering
//!
//! This crate is deliberately thin. It owns four things and nothing else:
//! storage (two SQLite databases and their migrations), the work folder
//! (create, open, close — one file when closed), the operating system (the
//! accent colour), and the typed command boundary. What a plan means — the
//! schedule on a working calendar, readiness and the sentence that says what is
//! missing — is pure TypeScript in `src/domain/`, where it can be unit-tested
//! without a window (CONTRIBUTING.md, "The architectural boundary").
//!
//! # Changelog of this entry point
//!
//! - F0: the application database opened and migrated at start-up; a work is a
//!   folder with its own `work.sqlite3`, created, opened and closed by command,
//!   and closed cleanly on exit so the folder holds one file; a rotating file
//!   log that stays on this machine; the accent ramp. The commands are the
//!   F0 contract: system, settings, recent works, the work, its calendar,
//!   people, stages and activities, and diagnostics. There is no command that
//!   writes progress.
//! - F1: the plan. Work migration 002 adds rooms, the rooms an activity
//!   touches, and an activity's quantity and unit. Rooms are added, renamed,
//!   removed and moved; an activity's rooms are replaced whole; stages, rooms
//!   and activities move one step up or down, with positions kept 1..n; a
//!   person is renamed or removed, and their activities are left with nobody
//!   responsible. The lens is a setting and a vocabulary — nothing about it is
//!   stored in a work, so nothing about it is here.

pub mod commands;
pub mod contract;
pub mod db;
pub mod error;
pub mod folder;
pub mod os;
pub mod validate;

use std::sync::Mutex;

use tauri::Manager;

/// Start the product.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // The system's own folder dialog, and nothing else from the filesystem:
        // the plugin returns a path a person chose, and only the host's own
        // commands read or write there.
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                // `Builder::new` arrives with a default target set. Adding to it
                // rather than replacing it writes every line twice.
                .clear_targets()
                // Logs stay on this machine. There is no remote sink, by design.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let connection = db::open(app.handle())?;
            app.manage(db::Db(Mutex::new(connection)));
            app.manage(folder::OpenWork::default());
            if db::relocated_data_dir().is_some() {
                log::warn!(
                    "the application data folder is relocated by {}",
                    db::DATA_DIR_ENV
                );
            }
            log::info!("Ridgebeam {} ready", env!("CARGO_PKG_VERSION"));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::system::accent_ramp,
            commands::system::diagnostics,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::work::recent_works,
            commands::work::work_create,
            commands::work::work_open,
            commands::work::work_close,
            commands::work::work_current,
            commands::work::work_get,
            commands::work::work_update,
            commands::plan::calendar_set,
            commands::plan::person_add,
            commands::plan::stage_add,
            commands::plan::stage_rename,
            commands::plan::stage_remove,
            commands::plan::activity_add,
            commands::plan::activity_update,
            commands::plan::activity_remove,
            commands::plan::activity_move,
            commands::plan::stage_move,
            commands::plan::person_rename,
            commands::plan::person_remove,
            commands::rooms::room_add,
            commands::rooms::room_rename,
            commands::rooms::room_remove,
            commands::rooms::room_move,
            commands::rooms::activity_set_rooms,
        ])
        .build(tauri::generate_context!())
        .expect("Ridgebeam failed to start");

    app.run(|handle, event| {
        // A work left open when the product ends is closed the way the person
        // would close it: checkpointed, so its folder holds one file.
        if let tauri::RunEvent::Exit = event {
            if let Some(open) = handle.try_state::<folder::OpenWork>() {
                commands::work::work_close_with(&open);
            }
        }
    });
}
