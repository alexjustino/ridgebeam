//! The commands for templates: a plan applied whole, ranges taken, and a
//! template file read or written.
//!
//! A template is data, applied once as the work's own plan (ADR-029). The
//! domain reads it — in one language, its includes expanded — into a
//! [`PlanDraft`] whose rows name one another by local keys; the host checks
//! every row with the same limits as the command that adds one of its kind,
//! resolves every key, and writes the plan in one transaction, or refuses it
//! whole with a sentence. The host never parses a template: a file is read as
//! text for the domain, and written as the text the domain built.
//!
//! # Changelog of this boundary
//!
//! - F9: `plan_apply`, `ranges_take`, `template_read`, `template_write`; the
//!   plan `work_create` may carry is checked here ([`check_plan`]).
//! - D3: a draft's check may need its photo (`CheckDraft.needsPhoto`, `false`
//!   when left out); the template file itself is still the domain's.
//! - G3: my templates — `my_templates_list`, `my_template_save`,
//!   `my_template_remove`, `my_templates_folder`: the person's own templates,
//!   kept as files in a folder of the application data, each named by its id.
//!   The interface sends an id, never a path; the host builds the path.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::commands::checks::{check_name, gate};
use crate::commands::money::label;
use crate::commands::work::change_work;
use crate::contract::{
    EndpointDraft, MyTemplate, MyTemplates, PlanDraft, Provenance, WorkSnapshot, WrittenFile,
};
use crate::db;
use crate::db::replanning::refuse_if_plan_locked;
use crate::db::templates::{
    self, NewActivity, NewCostLine, NewDecision, NewLink, NewPlan, NewProvenance, NewStage, Place,
    RangeEnd,
};
use crate::error::{Error, Result};
use crate::files::save::has_extension;
use crate::files::templates as file;
use crate::folder::OpenWork;
use crate::validate;

/// The longest key a draft's row carries.
pub const MAX_KEY_CHARS: usize = 64;

/// The highest version a template may say it is at.
pub const MAX_TEMPLATE_VERSION: i64 = 1_000_000;

/// The sentence for a plan with no stage.
pub const NOTHING_TO_START: &str = "A template with no stage has no plan to start.";

/// The sentence for a `which` that is neither end.
pub const WHICH_END: &str = "A range gives its lower end or its upper end: low or high.";

/// The folder of the application data that holds the person's own templates.
pub const MY_TEMPLATES_FOLDER: &str = "templates";

/// The longest id a template of the person's own may have, which is also its
/// file's name. Equal to the domain's `TEMPLATE_LIMITS.idChars`
/// (`src/domain/templates/format.ts`): an id the domain makes for an export is
/// always one the host will save, and one the host lists is always one the
/// domain will accept. Change both together.
pub const MAX_TEMPLATE_ID_CHARS: usize = 31;

/// The most templates [`my_templates_list`] lists; the rest are counted.
pub const MAX_MY_TEMPLATES: usize = 200;

/// The sentence for an id a template of the person's own cannot have.
pub const MY_TEMPLATE_ID: &str = "A template in your templates is named by its id: kebab-case, 1 to 31 characters, such as bathroom-renovation.";

/// The names Windows keeps for its devices, which no file may take on some of
/// its versions, whatever its extension.
const RESERVED_NAMES: [&str; 24] = [
    "con", "prn", "aux", "nul", "com0", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
    "com8", "com9", "lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Write a template's plan into the open work — a work with no stage, not
/// approved — in one transaction, and record where it came from.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a row that does not fit, a key that does not
/// resolve, or a work that already has a plan; [`Error::DependencyCycle`] for
/// links that close a loop; and the errors of every work command. On any of
/// them nothing is written.
#[tauri::command(rename_all = "snake_case")]
pub fn plan_apply(
    open: State<'_, OpenWork>,
    draft: PlanDraft,
    provenance: Provenance,
) -> Result<WorkSnapshot> {
    plan_apply_with(&open, &draft, &provenance)
}

/// Give every activity that has a range and no duration the `low` or the
/// `high` end of its range. An explicit act by the person, and a change to
/// the durations: refused after approval like any duration edit.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a `which` that is neither;
/// [`Error::PlanApproved`] when the plan is approved, no replanning is open,
/// and some duration would be written; and the errors of every work command.
#[tauri::command(rename_all = "snake_case")]
pub fn ranges_take(open: State<'_, OpenWork>, which: String) -> Result<WorkSnapshot> {
    ranges_take_with(&open, &which)
}

/// A template file's text, for the domain to parse: `.json`, UTF-8, at most
/// 1 MiB. No work needs to be open.
///
/// # Errors
///
/// [`Error::InvalidInput`], naming the file and why.
#[tauri::command(rename_all = "snake_case")]
pub fn template_read(path: String) -> Result<String> {
    file::read(Path::new(&path))
}

/// Write a template file — `.json`, at most 1 MiB — whole or not at all. An
/// existing file is replaced only with `overwrite: true`, which the interface
/// sends when the save dialog chose the path (the dialog asked first). No
/// work needs to be open.
///
/// # Errors
///
/// [`Error::InvalidInput`], naming the file and why; [`Error::Io`] when the
/// disk refuses.
#[tauri::command(rename_all = "snake_case")]
pub fn template_write(path: String, text: String, overwrite: Option<bool>) -> Result<()> {
    file::write(Path::new(&path), &text, overwrite.unwrap_or(false))
}

/// The person's own templates: every `.json` file directly in the folder,
/// sorted by id, each with its text or the sentence that says why it was not
/// read. A folder that is not there yet is an empty list. No work needs to be
/// open.
///
/// # Errors
///
/// [`Error::DataDir`] when the application data folder is not available;
/// [`Error::Io`] when the folder is there and cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn my_templates_list(app: AppHandle) -> Result<MyTemplates> {
    my_templates_list_with(&db::data_dir(&app)?)
}

/// Save a template among the person's own, as `<id>.json`, whole or not at
/// all. An existing one is replaced only with `overwrite: true`, which the
/// interface sends after it asked. No work needs to be open.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an id that cannot name a file there, text
/// larger than 1 MiB, or a template of that id already there without
/// `overwrite`; [`Error::DataDir`] and [`Error::Io`] when the disk refuses.
#[tauri::command(rename_all = "snake_case")]
pub fn my_template_save(
    app: AppHandle,
    id: String,
    text: String,
    overwrite: Option<bool>,
) -> Result<WrittenFile> {
    my_template_save_with(&db::data_dir(&app)?, &id, &text, overwrite.unwrap_or(false))
}

/// Remove a template of the person's own: the file `<id>.json` in the folder,
/// and nothing else. No work needs to be open.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an id that cannot name a file there, or one
/// that is not there or is not a file; [`Error::DataDir`] and [`Error::Io`]
/// when the disk refuses.
#[tauri::command(rename_all = "snake_case")]
pub fn my_template_remove(app: AppHandle, id: String) -> Result<()> {
    my_template_remove_with(&db::data_dir(&app)?, &id)
}

/// The folder the person's own templates are kept in, created if it is not
/// there, so the screen can say where it is and the person can open it.
///
/// # Errors
///
/// [`Error::DataDir`] when the application data folder is not available;
/// [`Error::Io`] when the folder cannot be created.
#[tauri::command(rename_all = "snake_case")]
pub fn my_templates_folder(app: AppHandle) -> Result<String> {
    my_templates_folder_with(&db::data_dir(&app)?)
}

/// What [`my_templates_folder`] does once the application data folder is
/// known.
///
/// # Errors
///
/// As [`my_templates_folder`].
pub fn my_templates_folder_with(data_dir: &Path) -> Result<String> {
    let folder = my_templates_folder_in(data_dir)?;
    std::fs::create_dir_all(&folder)?;
    Ok(folder.to_string_lossy().into_owned())
}

/// The folder of the person's own templates inside an application data
/// folder, as a full path — `RIDGEBEAM_DATA_DIR` may name a relative one, and
/// a template file is read and written by its full path only.
///
/// # Errors
///
/// [`Error::Io`] when the working folder, needed to make it full, is not
/// available.
pub fn my_templates_folder_in(data_dir: &Path) -> Result<PathBuf> {
    Ok(std::path::absolute(data_dir)?.join(MY_TEMPLATES_FOLDER))
}

/// Check an id that names a template of the person's own, and its file:
/// kebab-case — so no separator, no dot, no drive and no `..` can be in it —
/// of at most [`MAX_TEMPLATE_ID_CHARS`], and not a name Windows keeps.
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`MY_TEMPLATE_ID`], or the sentence for a name
/// Windows keeps.
pub fn my_template_id(id: &str) -> Result<&str> {
    if id.len() > MAX_TEMPLATE_ID_CHARS || !is_kebab(id) {
        return Err(invalid(MY_TEMPLATE_ID));
    }
    if RESERVED_NAMES.contains(&id) {
        return Err(invalid(format!(
            "“{id}” is a name Windows keeps for itself; choose another id."
        )));
    }
    Ok(id)
}

/// What [`my_templates_list`] does once the application data folder is known.
///
/// Only regular files are read: a folder or a link named like a template is
/// listed with its sentence, and a link is never followed. A name that is not
/// an id is listed with its sentence and never opened. The first
/// [`MAX_MY_TEMPLATES`] by id are listed; the rest are counted.
///
/// # Errors
///
/// [`Error::Io`] when the folder is there and cannot be read.
pub fn my_templates_list_with(data_dir: &Path) -> Result<MyTemplates> {
    let folder = my_templates_folder_in(data_dir)?;
    let entries = match std::fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(MyTemplates {
                templates: Vec::new(),
                not_listed: 0,
                note: None,
            })
        }
        Err(error) => return Err(Error::Io(error)),
    };

    // Names first, and nothing opened: which ones are listed must not depend
    // on the order the disk gives them in.
    let mut found = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if !has_extension(&path, "json") {
            continue;
        }
        let Some(stem) = path.file_stem() else {
            continue;
        };
        let id = stem.to_string_lossy().into_owned();
        let name = entry.file_name().to_string_lossy().into_owned();
        found.push((id, name, entry));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let not_listed = found.len().saturating_sub(MAX_MY_TEMPLATES);
    let templates = found
        .into_iter()
        .take(MAX_MY_TEMPLATES)
        .map(|(id, name, entry)| my_template_at(id, &name, &entry))
        .collect();

    let note = match not_listed {
        0 => None,
        1 => Some(format!(
            "1 more template is in the folder and was not listed: only the first {MAX_MY_TEMPLATES} are."
        )),
        more => Some(format!(
            "{more} more templates are in the folder and were not listed: only the first {MAX_MY_TEMPLATES} are."
        )),
    };
    Ok(MyTemplates {
        templates,
        not_listed: not_listed as u64,
        note,
    })
}

/// One entry of the folder, read only when it is a regular file named by an
/// id.
fn my_template_at(id: String, name: &str, entry: &std::fs::DirEntry) -> MyTemplate {
    let refused = |id: String, problem: String| MyTemplate {
        id,
        text: None,
        problem: Some(problem),
    };
    let not_read = |reason: &str| format!("“{name}” was not read: {reason}.");
    // `DirEntry::file_type` does not follow a link.
    match entry.file_type() {
        Ok(kind) if kind.is_symlink() => {
            return refused(id, not_read("it is a link, and a link is not followed"))
        }
        Ok(kind) if kind.is_dir() => return refused(id, not_read("it is a folder, not a file")),
        Ok(kind) if kind.is_file() => {}
        _ => return refused(id, not_read("it is not a file")),
    }
    if my_template_id(&id).is_err() {
        return refused(
            id,
            not_read(&format!(
                "its name is not a template's id — kebab-case, 1 to {MAX_TEMPLATE_ID_CHARS} characters, such as bathroom-renovation"
            )),
        );
    }
    match file::read(&entry.path()) {
        Ok(text) => MyTemplate {
            id,
            text: Some(text),
            problem: None,
        },
        Err(error) => refused(id, error.to_string()),
    }
}

/// What [`my_template_save`] does once the application data folder is known.
///
/// # Errors
///
/// As [`my_template_save`].
pub fn my_template_save_with(
    data_dir: &Path,
    id: &str,
    text: &str,
    overwrite: bool,
) -> Result<WrittenFile> {
    let id = my_template_id(id)?;
    let folder = my_templates_folder_in(data_dir)?;
    std::fs::create_dir_all(&folder)?;
    let path = folder.join(format!("{id}.json"));
    // Asked of the name itself, not of what a link there points to.
    if !overwrite && std::fs::symlink_metadata(&path).is_ok() {
        return Err(invalid(format!(
            "“{id}.json” is already in your templates; replace it to save over it."
        )));
    }
    file::write(&path, text, overwrite)?;
    Ok(WrittenFile {
        path: path.to_string_lossy().into_owned(),
        bytes: text.len() as u64,
        pages: None,
    })
}

/// What [`my_template_remove`] does once the application data folder is
/// known. Only a regular file is removed: a folder or a link of that name is
/// refused, and nothing outside the folder can be named.
///
/// # Errors
///
/// As [`my_template_remove`].
pub fn my_template_remove_with(data_dir: &Path, id: &str) -> Result<()> {
    let id = my_template_id(id)?;
    let path = my_templates_folder_in(data_dir)?.join(format!("{id}.json"));
    match std::fs::symlink_metadata(&path) {
        Err(_) => Err(invalid(format!(
            "“{id}.json” is not in your templates folder; it may have been removed already."
        ))),
        Ok(metadata) if !metadata.file_type().is_file() => Err(invalid(format!(
            "“{id}.json” was not removed: it is not a file."
        ))),
        Ok(_) => {
            std::fs::remove_file(&path)?;
            log::info!("a template of the person's own was removed");
            Ok(())
        }
    }
}

/// What [`plan_apply`] does once the state is in hand.
pub fn plan_apply_with(
    open: &OpenWork,
    draft: &PlanDraft,
    provenance: &Provenance,
) -> Result<WorkSnapshot> {
    let plan = check_plan(draft)?;
    let provenance = check_provenance(provenance)?;
    change_work(open, |conn| templates::apply(conn, &plan, &provenance))
}

/// What [`ranges_take`] does once the state is in hand.
pub fn ranges_take_with(open: &OpenWork, which: &str) -> Result<WorkSnapshot> {
    let which = match which {
        "low" => RangeEnd::Low,
        "high" => RangeEnd::High,
        _ => return Err(invalid(WHICH_END)),
    };
    change_work(open, |conn| {
        // Nothing to write is not a change to the plan, and is not refused.
        if templates::ranges_open(conn)? > 0 {
            refuse_if_plan_locked(conn)?;
        }
        templates::take_ranges(conn, which).map(|_| ())
    })
}

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// A key: 1 to [`MAX_KEY_CHARS`] characters, compared exactly as written.
fn key(what: &str, value: &str) -> Result<String> {
    let length = value.chars().count();
    if length == 0 || length > MAX_KEY_CHARS || value.trim() != value {
        return Err(invalid(format!(
            "{what}'s key is 1 to {MAX_KEY_CHARS} characters, with no space around it."
        )));
    }
    Ok(value.to_string())
}

/// A range: both ends or neither, each checked by `check`, the lower not above
/// the higher.
fn range(
    what: &str,
    low: Option<f64>,
    high: Option<f64>,
    check: fn(f64) -> Result<i64>,
) -> Result<Option<(i64, i64)>> {
    match (low, high) {
        (None, None) => Ok(None),
        (Some(low), Some(high)) => {
            let (low, high) = (check(low)?, check(high)?);
            if low > high {
                return Err(invalid(format!(
                    "The range of {what} runs from its lower end to its upper end: {low} is above {high}."
                )));
            }
            Ok(Some((low, high)))
        }
        _ => Err(invalid(format!(
            "The range of {what} needs both of its ends, or neither."
        ))),
    }
}

/// Check a plan the way each row's own command would, and resolve every key
/// into a position. Nothing here reads the work: a plan that fails here is
/// refused before a folder is created for it.
///
/// # Errors
///
/// [`Error::InvalidInput`] for the first row that does not fit, or key that is
/// missing, repeated, or names nothing.
pub fn check_plan(draft: &PlanDraft) -> Result<NewPlan> {
    if draft.stages.is_empty() {
        return Err(invalid(NOTHING_TO_START));
    }

    let mut room_index: HashMap<&str, usize> = HashMap::new();
    let mut rooms = Vec::with_capacity(draft.rooms.len());
    for (index, room) in draft.rooms.iter().enumerate() {
        let name = validate::name("room", &room.name)?;
        let room_key = key("A room", &room.key)?;
        if room_index.insert(room.key.as_str(), index).is_some() {
            return Err(invalid(format!(
                "Two rooms of the plan share the key “{room_key}”."
            )));
        }
        rooms.push(name);
    }

    let mut stage_index: HashMap<&str, usize> = HashMap::new();
    let mut activity_index: Vec<HashMap<&str, usize>> = Vec::with_capacity(draft.stages.len());
    let mut stages = Vec::with_capacity(draft.stages.len());
    for (s, stage) in draft.stages.iter().enumerate() {
        let stage_name = validate::name("stage", &stage.name)?;
        let stage_key = key("A stage", &stage.key)?;
        if stage_index.insert(stage.key.as_str(), s).is_some() {
            return Err(invalid(format!(
                "Two stages of the plan share the key “{stage_key}”."
            )));
        }

        let mut activities_here: HashMap<&str, usize> = HashMap::new();
        let mut activities = Vec::with_capacity(stage.activities.len());
        for (a, activity) in stage.activities.iter().enumerate() {
            let name = validate::name("activity", &activity.name)?;
            let activity_key = key("An activity", &activity.key)?;
            if activities_here.insert(activity.key.as_str(), a).is_some() {
                return Err(invalid(format!(
                    "Two activities of the stage “{stage_name}” share the key “{activity_key}”."
                )));
            }
            let duration_days = activity
                .duration_days
                .map(validate::duration_days)
                .transpose()?;
            let range = range(
                &format!("the activity “{name}”"),
                activity.duration_min_days,
                activity.duration_max_days,
                validate::duration_days,
            )?;
            let mut touched = BTreeSet::new();
            for room in &activity.rooms {
                let index = room_index.get(room.as_str()).ok_or_else(|| {
                    invalid(format!(
                        "The activity “{name}” names a room “{room}” that is not in the plan."
                    ))
                })?;
                touched.insert(*index);
            }
            activities.push(NewActivity {
                name,
                duration_days,
                range,
                rooms: touched.into_iter().collect(),
            });
        }

        let checks = stage
            .checks
            .iter()
            .map(|check| {
                Ok((
                    gate(&check.gate)?,
                    check_name(&check.name)?,
                    check.needs_photo,
                ))
            })
            .collect::<Result<Vec<_>>>()?;

        let mut cost_lines = Vec::with_capacity(stage.cost_lines.len());
        for line in &stage.cost_lines {
            let line_label = label("A cost line", &line.label)?;
            let activity = line
                .activity_key
                .as_deref()
                .map(|wanted| {
                    activities_here.get(wanted).copied().ok_or_else(|| {
                        invalid(format!(
                            "The cost line “{line_label}” names an activity “{wanted}” that is not in its stage."
                        ))
                    })
                })
                .transpose()?;
            let amount_cents = line
                .amount_cents
                .map(|amount| validate::amount_cents(amount, false))
                .transpose()?;
            cost_lines.push(NewCostLine {
                label: line_label,
                activity,
                amount_cents,
            });
        }

        let mut decisions = Vec::with_capacity(stage.decisions.len());
        for decision in &stage.decisions {
            let name = validate::name("decision", &decision.name)?;
            let lead_time_days = validate::lead_time_days(decision.lead_time_days)?;
            let range = range(
                &format!("the decision “{name}”"),
                decision.lead_min_days,
                decision.lead_max_days,
                validate::lead_time_days,
            )?;
            if let Some(wanted) = decision.needs_key.as_deref() {
                if !activities_here.contains_key(wanted) {
                    return Err(invalid(format!(
                        "The decision “{name}” names an activity “{wanted}” that is not in its stage."
                    )));
                }
            }
            decisions.push(NewDecision {
                name,
                lead_time_days,
                range,
            });
        }

        activity_index.push(activities_here);
        stages.push(NewStage {
            name: stage_name,
            activities,
            checks,
            cost_lines,
            decisions,
        });
    }

    let place = |end: &EndpointDraft| -> Result<Place> {
        let stage = *stage_index.get(end.stage_key.as_str()).ok_or_else(|| {
            invalid(format!(
                "A dependency names a stage “{}” that is not in the plan.",
                end.stage_key
            ))
        })?;
        match (end.kind.as_str(), end.activity_key.as_deref()) {
            ("stage", None) => Ok(Place {
                stage,
                activity: None,
            }),
            ("stage", Some(activity)) => Err(invalid(format!(
                "A dependency on the stage “{}” names no activity, and this one names “{activity}”.",
                end.stage_key
            ))),
            ("activity", Some(activity)) => {
                let index = activity_index[stage].get(activity).ok_or_else(|| {
                    invalid(format!(
                        "A dependency names an activity “{}/{activity}” that is not in the plan.",
                        end.stage_key
                    ))
                })?;
                Ok(Place {
                    stage,
                    activity: Some(*index),
                })
            }
            ("activity", None) => Err(invalid(format!(
                "A dependency on an activity says which one of the stage “{}”.",
                end.stage_key
            ))),
            _ => Err(invalid("A dependency joins an activity or a stage.")),
        }
    };
    let links = draft
        .links
        .iter()
        .map(|link| {
            Ok(NewLink {
                blocker: place(&link.blocker)?,
                blocked: place(&link.blocked)?,
                lag_days: validate::lag_days(link.lag_days)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(NewPlan {
        rooms,
        stages,
        links,
    })
}

/// Whether an id is kebab-case: lowercase letters and digits in words joined
/// by single hyphens.
fn is_kebab(value: &str) -> bool {
    !value.is_empty()
        && value.split('-').all(|word| {
            !word.is_empty()
                && word
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

/// Check where a plan came from.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an id that is not kebab-case of at most
/// [`MAX_KEY_CHARS`], a version that is not a whole number from 1, or a title
/// that is empty or longer than a name.
pub fn check_provenance(provenance: &Provenance) -> Result<NewProvenance> {
    let id = provenance.template_id.as_str();
    if id.len() > MAX_KEY_CHARS || !is_kebab(id) {
        return Err(invalid(format!(
            "A template's id is kebab-case, 1 to {MAX_KEY_CHARS} characters — such as bathroom-renovation."
        )));
    }
    let version = provenance.template_version;
    if !(version.is_finite()
        && version.fract() == 0.0
        && (1.0..=MAX_TEMPLATE_VERSION as f64).contains(&version))
    {
        return Err(invalid(format!(
            "A template's version is a whole number, from 1 to {MAX_TEMPLATE_VERSION}."
        )));
    }
    let title = provenance.template_title.trim();
    if title.is_empty() {
        return Err(invalid("A template needs a title."));
    }
    if title.chars().count() > validate::MAX_NAME_CHARS {
        return Err(invalid(format!(
            "A template's title is at most {} characters.",
            validate::MAX_NAME_CHARS
        )));
    }
    Ok(NewProvenance {
        template_id: id.to_string(),
        template_version: version as i64,
        template_title: title.to_string(),
    })
}
