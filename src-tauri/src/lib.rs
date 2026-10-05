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
//! - F2: the schedule. Work migration 003 adds dependencies between activities
//!   or whole stages, with a lag in working days; baselines, insert-only by
//!   trigger and by rule (`db::baselines` holds no statement that edits or
//!   removes a row); and the moment the plan was approved. A dependency that
//!   would close a loop over the expanded graph is refused as
//!   `dependency_cycle`, naming the loop; removing an activity or a stage takes
//!   its dependencies with it. The schedule itself is the domain's.
//! - F3: decisions. Work migration 004 adds a decision per stage with a lead
//!   time, made or not, and an answer that belongs to the making. The host
//!   never stores a deadline and never reads the clock to call one overdue:
//!   the deadline is computed by the domain from the schedule, against a
//!   "today" the interface passes in (ADR-017).
//! - F4: the diary — requirement one. Work migration 005 adds four
//!   append-only tables with a hash chain; `db::diary` holds no statement that
//!   edits or removes a row, and a test reads its source. Photos are copied in
//!   by the host under caps (`files::intake`), shown as `data:` URLs, and
//!   opened with the system's own handler from Rust — the opener plugin is a
//!   library here, not a registered plugin, so the webview gains no command
//!   and no capability. An entry is signed with the Windows account's name.
//! - F5: checks. Work migration 006 adds a stage's lifecycle (started, closed —
//!   a start is not undone, a close is reopened), the checks at its two gates,
//!   and their answers, append-only and unchained. A stage starts or closes
//!   only when its gate is passed (`stage_gate_open` names what holds it), and
//!   a closed stage is read-only until reopened (`stage_closed`). An answer's
//!   photo takes the diary's pipeline, caps and folder.
//! - F6: money. Work migration 007 adds cost lines (planned), commitments
//!   (committed — fixed from the first payment against them) and the payments
//!   ledger (paid), append-only with its reversal rules in the schema, in whole
//!   minor units; and a person's trade. `person_update` replaces
//!   `person_rename`. A receipt or a quote is an image through the photo
//!   pipeline; a PDF is F7's.
//! - F7: people as contacts, and documents. Work migration 008 adds a person's
//!   phone, e-mail, note, availability and stages, and `document` with its
//!   links — backfilled from every photo, receipt and quote already in the
//!   work. The intake (`files::intake`, once `files::photos`) keeps images and
//!   PDFs by their bytes — a PDF never parsed — and refuses everything else,
//!   SVG by name; the hostile corpus is generated in `cargo test` against a
//!   committed manifest. `documents_verify` re-reads the bytes; orphans are
//!   listed, never deleted. A moved work is found again by `recent_relocate`.
//! - F8: replanning. Once approved, a plan is locked until somebody says why:
//!   every command that changes what a baseline records is refused as
//!   `plan_approved` unless a replanning is open (`replan_open`, a row with a
//!   reason, one at a time). It closes only by taking the next baseline, which
//!   copies the reason in the same transaction; facts never ask. Work
//!   migration 009 adds `replanning`, and baselines that record their stages
//!   (`baseline_stage`, insert-only by the same battery) and their planned
//!   money — backfilling the stages of baselines taken before, whose money
//!   stays "not recorded". A what-if is the interface's alone: nothing here.
//! - F9: templates. A template is data the domain reads; the host writes the
//!   plan it becomes (`plan_apply`, or `work_create` with a `plan`) onto a
//!   work with no stage and no approval, in one transaction, every row checked
//!   as its own command checks it and every key resolved, a loop in its links
//!   refused as `dependency_cycle` — or nothing at all, and a folder the call
//!   created removed again. Work migration 010 adds an activity's and a
//!   decision's range, where the plan came from (provenance, not a tie), and
//!   rebuilds `cost_line` so a line may be not priced yet. `ranges_take` gives
//!   every range without a duration its lower or upper end, locked after
//!   approval. A template file is read as text and written whole
//!   (`template_read`, `template_write`: `.json`, 1 MiB) — the host never
//!   parses one. No new error kind, no new capability: the save dialog was
//!   already allowed.
//! - F10: reports. A report is a document the interface composes, already in
//!   words; the host lays it out (pure, `report::layout`) and writes it as a
//!   PDF in the standard Helvetica faces, WinAnsi, nothing embedded
//!   (`report_pdf_write`). The diary's exports (`diary_export_pdf`,
//!   `diary_export_csv`) verify the chain first, over the rows they write, and
//!   write nothing when it does not hold; the PDF carries the host's own
//!   verification block, the CSV is the database's own rows, neutralised
//!   against formulas. The work is exported as JSON (`work_export_json`).
//!   Every file goes through `files::save` (F9's atomic write, now shared);
//!   `report_open` opens only a file this session wrote. No new error kind,
//!   no new capability, no migration.
//! - F11: backup and restore. A work is backed up as one `.ridgebeam` file — a
//!   ZIP written by hand (`files::archive`, store and deflate, no new crate)
//!   holding a manifest, a `VACUUM INTO` snapshot of the database and every
//!   document and thumbnail (`backup_write`). A backup is read as hostile
//!   (`backup_inspect`, `backup_restore`): an allow-list of names, every size
//!   capped while it inflates, every SHA-256 and the manifest's own checked,
//!   the database opened read-only and found to be the work it names — all in
//!   a temporary folder beside a new one, renamed into place only then, and
//!   opened as any work is. Application migration 003 keeps the day of each
//!   work's last backup (`backup_last`); `diagnostics` lists the migrations
//!   applied and `diagnostics_summary` is Diagnostics as plain text. No new
//!   error kind, no new capability.
//! - D1: "When will it really finish?" The finish as a probability is the
//!   domain's alone (a seeded simulation over each activity's range); the
//!   host's part is the input. `activity_update` takes an activity's range on
//!   any activity — the optimistic and the pessimistic duration, both or
//!   neither, 1 to 3650, the optimistic not above the pessimistic, and a
//!   change to the duration or the range that leaves the duration outside it
//!   refused with a sentence naming the range. The range is not locked after
//!   approval: a baseline does not record it. Nothing the simulation computes
//!   is stored. No migration (F9's columns), no new command, no new error
//!   kind, no new capability.
//! - D2: "Am I paying ahead of the work?" A commitment gains a payment plan:
//!   milestones, each a share of its amount in basis points, earned by a fact
//!   of the work — an advance, the stage started, an activity finished, the
//!   stage closed — never a date. Work migration 011 adds `payment_milestone`,
//!   with its rules in the schema behind the host's sentences: at most 100 %
//!   per commitment, an activity of the commitment's stage exactly when the
//!   trigger is an activity's finish, and nothing added, changed, moved or
//!   removed once a payment (a reversal included) names the commitment. Five
//!   commands (`milestone_add`, `milestone_update`, `milestone_move`,
//!   `milestone_remove`, `milestones_usual`); an activity a milestone is
//!   earned by is not removed. What is earned, due and paid ahead — and the
//!   warning before a payment ahead of the work, which never refuses it — is
//!   the domain's. No new error kind, no new capability.
//! - D3: the handover book. A report may print photos: the `image` block
//!   names a file by its SHA-256 — never a path — and the host finds it only
//!   among the open work's documents, inside its own `documents/`, reads it
//!   under the F7 caps (its hash checked again), decodes it under
//!   `image::Limits`, shrinks it to 1 600 px on the long edge and embeds it as
//!   JPEG at quality 82 (`report::images`); a small JPEG that already fits is
//!   embedded byte for byte. At most 400 photos and 150 MiB of photo data per
//!   report, refused with a sentence; a PDF document is never printed as an
//!   image. The `handover` kind joins the reports. Work migration 012 adds a
//!   check's `needs_photo` — a "yes" without a photo on such a check is
//!   refused with a sentence and by the schema — rebuilds `document` for two
//!   more kinds (`warranty`, `manual`) with every row and link kept, and adds
//!   `care_note`, removed with its room or stage in the same transaction. Five
//!   commands (`check_needs_photo`, `care_note_add`, `care_note_update`,
//!   `care_note_move`, `care_note_remove`); `checks_add_defaults` takes the
//!   usual checks that need a photo; `plan_apply` writes a draft check's
//!   `needsPhoto`. No new crate, no new error kind, no new capability.
//! - D4: the owner's snapshot. `report_html_write` renders a document of the
//!   new kind `snapshot` as one self-contained HTML page (`report::html`):
//!   every string escaped, a Content-Security-Policy that loads nothing but
//!   the page's own photos and style and runs nothing, inline CSS for a phone
//!   in light and dark, figures that open onto their rows with no script, the
//!   schedule as an inline SVG. Its photos are found by hash as D3 finds them
//!   and always re-encoded (1 024 px, quality 78); at most 60 of them, 8 MiB
//!   of them and 12 MiB of file, refused with sentences. The page is verified
//!   on its own bytes before it is written — no script, handler, address,
//!   import, frame or element it is not made of — and a page that fails is
//!   refused as a bug. Written through `files::save` (`.html`), opened by
//!   `report_open` as any report. Sending it is the person's act. No new
//!   crate, no new error kind, no new capability, no migration.
//! - E1: change orders. After the plan is approved, a change is raised on
//!   record — who asked, the stage it lands in, its signed cost, its effects
//!   (add an activity after another, change a duration, remove an activity) —
//!   and decided once. Work migration 013 adds `change_order` and
//!   `change_order_decision`, both insert-only by trigger (`change order:
//!   append-only`, with `recursive_triggers` on and off), numbered max + 1,
//!   refused before approval and for a decision that does not match its
//!   change. An approval opens a replanning (`Change order #N — title`) or
//!   joins the one open, writes the effects through the plan's own functions
//!   and a cost line `Change order #N`, and records the decision — in one
//!   transaction, or nothing. Two commands (`change_order_raise`,
//!   `change_order_decide`). The impact on the finish is the domain's, sent
//!   with the decision and kept. No new crate, no new error kind, no new
//!   capability.
//! - E2: funding — where the money comes from. Work migration 014 adds
//!   `funding` (the funds expected, each on a day: plan, edited freely, not
//!   locked by the approval, kept in order 1..n) and `funding_receipt` (the
//!   money received: an append-only ledger exactly like the payments', `seq`
//!   continuing, `funding: append-only` with `recursive_triggers` on and off,
//!   a reversal the full negative of one receipt, once, for the same fund and
//!   not dated before it — `funding: reversal`). A fund a receipt names is
//!   not removed (a sentence, and a foreign key). A receipt's day is never
//!   after today, by the host's clock. Five commands (`funding_add`,
//!   `funding_update`, `funding_remove`, `funding_receipt_add`,
//!   `funding_receipt_reverse`); the snapshot carries `funding` and
//!   `fundingReceipts`, and so the JSON export and every backup do. Whether
//!   the money lasts is the domain's. No new crate, no new error kind, no new
//!   capability.
//! - E4: snags and retention. Work migration 016 adds `snag` (what is still
//!   to fix near the end: a stage, optionally an activity of it, who must fix
//!   it, a due day not before it was raised, a photo — numbered max + 1) and
//!   `snag_closure` (once per snag, not before it was raised: `fixed` with a
//!   photo, `withdrawn` with a note — both CHECKs), both insert-only by
//!   trigger (`snag: append-only`, with `recursive_triggers` on and off;
//!   `snag: closure`). It rebuilds `payment_milestone` for the `retention`
//!   trigger, every row kept and the seven triggers of migration 011 created
//!   again. Two commands (`snag_raise`, `snag_close`), each returning the
//!   snapshot, which carries `snags`; `milestone_add` and `milestone_update`
//!   take `retention`. A photo is the hash of an image document of the work,
//!   never a path, and a snag's photos keep their files in the folder. A
//!   closed stage takes a snag. What is held and earned is the domain's. No
//!   new crate, no new error kind, no new capability.
//! - G1: the weekly site meeting. Work migration 017 adds `meeting` (numbered
//!   max + 1, held on a day not after today, with the counts of its
//!   attendees, items and actions, which seal them), `meeting_attendee` (a
//!   person of the plan or somebody named, exactly one; a person once, a name
//!   once whatever its case — `meeting: attendee`), `meeting_item` (nine kinds, the agenda's title frozen,
//!   what was said and done), `meeting_action` (what, on a person or somebody
//!   named or nobody, due not before the meeting — `meeting: action`) and
//!   `meeting_action_closure` (once per action, `done` or `dropped`, at a later
//!   meeting on its day or between meetings — `meeting: closure`), all
//!   insert-only by trigger (`meeting: append-only`, with `recursive_triggers`
//!   on and off). Two commands (`meeting_close`, writing the minutes whole in
//!   one transaction or nothing; `meeting_action_close`), each returning the
//!   snapshot, which carries `meetings`. The report kind `minutes` is written
//!   by `report_pdf_write`. The agenda is the domain's. No new crate, no new
//!   error kind, no new capability.
//! - G2: what to order this week. Work migration 018 adds `purchase` (what an
//!   activity needs that takes time to arrive: a stage, optionally an
//!   activity of it — `purchase: activity` otherwise — a name, a quantity in
//!   words, a supplier, a lead time of 0 to 365 calendar days and a note;
//!   plan, edited freely, not locked by the approval, kept in order 1..n; its
//!   stage removed takes it, its activity removed lets go of it) and
//!   `purchase_event` (what happened to it: `ordered`, `delivered` or
//!   `cancelled`, `seq` continuing per purchase, append-only —
//!   `purchase: append-only` with `recursive_triggers` on and off — in an
//!   order the schema holds as the host does: ordered first or after a
//!   cancellation, delivered or cancelled only on an open order, nothing after
//!   delivered, never before the event it follows — `purchase: event`). A
//!   purchase something has happened to is not removed, nor its stage nor
//!   the activity it needs (a sentence, and a foreign key or a trigger), and
//!   its lead time, stage and activity are fixed (`purchase: ordered`). An
//!   event's day is never after today, by the host's clock. Four commands (`purchase_add`, `purchase_update`,
//!   `purchase_remove`, `purchase_event_add`), each returning the snapshot,
//!   which carries `purchases`, each with its `events`, and so the JSON export
//!   and every backup do. The day to order by is the domain's. No new crate,
//!   no new error kind, no new capability.
//! - G3: the work teaches the next. No work migration: what an activity
//!   actually took is the domain's, read from the diary. My templates — the
//!   person's own templates, kept as `<id>.json` files in the `templates`
//!   folder of the application data (the folder `RIDGEBEAM_DATA_DIR`
//!   relocates in a debug build). Four commands (`my_templates_list`,
//!   `my_template_save`, `my_template_remove`, `my_templates_folder`), none
//!   needing a work open. The interface names a template by a kebab-case id,
//!   never by a path: the host builds the path, reads only regular files
//!   directly in the folder, follows no link, and lists at most 200. No new
//!   crate, no new error kind, no new capability.

pub mod commands;
pub mod contract;
pub mod db;
pub mod error;
pub mod files;
pub mod folder;
pub mod os;
pub mod report;
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
            app.manage(commands::reports::Written::default());
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
            commands::plan::person_update,
            commands::plan::person_set_stages,
            commands::plan::person_remove,
            commands::rooms::room_add,
            commands::rooms::room_rename,
            commands::rooms::room_remove,
            commands::rooms::room_move,
            commands::rooms::activity_set_rooms,
            commands::schedule::dependency_add,
            commands::schedule::dependency_update,
            commands::schedule::dependency_remove,
            commands::schedule::baseline_take,
            commands::schedule::replan_open,
            commands::decisions::decision_add,
            commands::decisions::decision_update,
            commands::decisions::decision_remove,
            commands::decisions::decision_move,
            commands::decisions::decision_make,
            commands::decisions::decision_reopen,
            commands::diary::diary_entry_add,
            commands::diary::diary_list,
            commands::diary::diary_entry,
            commands::diary::diary_verify,
            commands::diary::photo_thumbnail,
            commands::diary::photo_open,
            commands::checks::check_add,
            commands::checks::check_rename,
            commands::checks::check_move,
            commands::checks::check_remove,
            commands::checks::checks_add_defaults,
            commands::checks::check_needs_photo,
            commands::checks::check_answer,
            commands::checks::stage_start,
            commands::checks::stage_close,
            commands::checks::stage_reopen,
            commands::money::cost_line_add,
            commands::money::cost_line_update,
            commands::money::cost_line_remove,
            commands::money::commitment_add,
            commands::money::commitment_update,
            commands::money::commitment_remove,
            commands::money::payment_add,
            commands::money::payment_reverse,
            commands::milestones::milestone_add,
            commands::milestones::milestone_update,
            commands::milestones::milestone_move,
            commands::milestones::milestone_remove,
            commands::milestones::milestones_usual,
            commands::care_notes::care_note_add,
            commands::care_notes::care_note_update,
            commands::care_notes::care_note_move,
            commands::care_notes::care_note_remove,
            commands::change_orders::change_order_raise,
            commands::change_orders::change_order_decide,
            commands::funding::funding_add,
            commands::funding::funding_update,
            commands::funding::funding_remove,
            commands::funding::funding_receipt_add,
            commands::funding::funding_receipt_reverse,
            commands::snags::snag_raise,
            commands::snags::snag_close,
            commands::meetings::meeting_close,
            commands::meetings::meeting_action_close,
            commands::purchases::purchase_add,
            commands::purchases::purchase_update,
            commands::purchases::purchase_remove,
            commands::purchases::purchase_event_add,
            commands::documents::document_add,
            commands::documents::document_update,
            commands::documents::document_link,
            commands::documents::document_unlink,
            commands::documents::document_remove,
            commands::documents::document_open,
            commands::documents::document_thumbnail,
            commands::documents::documents_verify,
            commands::documents::folder_health,
            commands::work::recent_relocate,
            commands::templates::plan_apply,
            commands::templates::ranges_take,
            commands::templates::template_read,
            commands::templates::template_write,
            commands::templates::my_templates_list,
            commands::templates::my_template_save,
            commands::templates::my_template_remove,
            commands::templates::my_templates_folder,
            commands::reports::report_pdf_write,
            commands::reports::report_html_write,
            commands::reports::diary_export_pdf,
            commands::reports::diary_export_csv,
            commands::reports::work_export_json,
            commands::reports::report_open,
            commands::backup::backup_write,
            commands::backup::backup_inspect,
            commands::backup::backup_restore,
            commands::backup::backup_last,
            commands::system::diagnostics_summary,
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
