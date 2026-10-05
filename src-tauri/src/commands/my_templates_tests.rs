//! My templates, walked through the functions the commands call (slice G3).
//!
//! The person's own templates are files in a folder of the application data,
//! named by their id. The interface sends an id, never a path: an id that
//! could name anything outside the folder, or a name Windows keeps, is refused
//! before the disk is touched. A file in the folder is somebody's file and is
//! read with the same caps as any template; a folder or a link named like one
//! is listed and never read. Every test runs in a scratch folder standing in
//! for the application data folder; nothing touches the real one. Every
//! fixture is synthetic.

use std::path::Path;

use serde_json::json;

use crate::commands::templates::{
    my_template_id, my_template_remove_with, my_template_save_with, my_templates_folder_in,
    my_templates_folder_with, my_templates_list_with, MAX_MY_TEMPLATES, MAX_TEMPLATE_ID_CHARS,
    MY_TEMPLATES_FOLDER, MY_TEMPLATE_ID,
};
use crate::db::testing::Scratch;
use crate::error::Error;
use crate::files::templates::MAX_TEMPLATE_BYTES;

const KITCHEN: &str = r#"{ "ridgebeamTemplate": 1, "id": "kitchen-joinery", "version": 1 }"#;

/// The templates folder of a scratch application data folder, created.
fn folder(data: &Scratch) -> std::path::PathBuf {
    let folder = data.path().join(MY_TEMPLATES_FOLDER);
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

fn invalid_sentence(error: Error) -> String {
    assert_eq!(error.kind(), "invalid_input", "{error}");
    error.to_string()
}

/// Every name in a folder, sorted.
fn names_in(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn the_host_and_the_domain_keep_the_same_id_limit() {
    let format = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/domain/templates/format.ts"),
    )
    .expect("the domain's template format");
    assert!(
        format.contains(&format!("idChars: {MAX_TEMPLATE_ID_CHARS},")),
        "TEMPLATE_LIMITS.idChars and MAX_TEMPLATE_ID_CHARS are one number"
    );
}

#[test]
fn an_id_that_could_name_anything_but_a_file_in_the_folder_is_refused() {
    let too_long = "a".repeat(MAX_TEMPLATE_ID_CHARS + 1);
    for id in [
        "",
        "..",
        ".",
        "a/b",
        "a\\b",
        "../outside",
        "..\\outside",
        "C:",
        "c:",
        "C:\\templates\\x",
        "/abs",
        "x.json",
        "Kitchen",
        "KITCHEN",
        "kitchen joinery",
        " kitchen",
        "kitchen-",
        "-kitchen",
        "kitchen--joinery",
        "cozinha-é",
        "kitchen\0",
        too_long.as_str(),
    ] {
        let refused = my_template_id(id).expect_err(id);
        assert_eq!(invalid_sentence(refused), MY_TEMPLATE_ID, "{id:?}");
    }
    let longest = "a".repeat(MAX_TEMPLATE_ID_CHARS);
    assert_eq!(my_template_id(&longest).unwrap(), longest);
    assert_eq!(
        my_template_id("kitchen-joinery-2").unwrap(),
        "kitchen-joinery-2"
    );
}

#[test]
fn a_name_windows_keeps_is_refused_in_any_case() {
    for id in ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt0"] {
        assert_eq!(
            invalid_sentence(my_template_id(id).unwrap_err()),
            format!("“{id}” is a name Windows keeps for itself; choose another id."),
        );
    }
    for id in ["CON", "NUL", "Com1"] {
        assert_eq!(
            invalid_sentence(my_template_id(id).unwrap_err()),
            MY_TEMPLATE_ID,
            "{id}: not kebab-case either"
        );
    }
    my_template_id("console").expect("only the whole name is kept");
    my_template_id("con-1").expect("only the whole name is kept");
}

#[test]
fn a_refused_id_saves_nothing_and_removes_nothing_anywhere() {
    let data = Scratch::create();
    let templates = folder(&data);
    // A file beside the folder, and one inside it, that a traversal would reach.
    std::fs::write(data.path().join("outside.json"), KITCHEN).unwrap();
    std::fs::write(templates.join("inside.json"), KITCHEN).unwrap();

    for id in [
        "../outside",
        "..\\outside",
        "..",
        "a/b",
        "C:",
        "con",
        "NUL",
        "",
    ] {
        my_template_save_with(data.path(), id, "{}", true).expect_err(id);
        my_template_remove_with(data.path(), id).expect_err(id);
    }
    assert_eq!(
        names_in(data.path()),
        vec!["outside.json", MY_TEMPLATES_FOLDER]
    );
    assert_eq!(names_in(&templates), vec!["inside.json"]);
    assert_eq!(
        std::fs::read_to_string(data.path().join("outside.json")).unwrap(),
        KITCHEN
    );
}

#[test]
fn a_missing_folder_is_an_empty_list_and_is_not_created_by_listing() {
    let data = Scratch::create();
    let listed = my_templates_list_with(data.path()).unwrap();
    assert!(listed.templates.is_empty());
    assert_eq!(listed.not_listed, 0);
    assert_eq!(listed.note, None);
    assert!(!data.path().join(MY_TEMPLATES_FOLDER).exists());

    let shown = my_templates_folder_with(data.path()).unwrap();
    assert!(Path::new(&shown).is_absolute(), "{shown}");
    assert!(
        Path::new(&shown).is_dir(),
        "the folder the screen names is there"
    );
    assert_eq!(
        Path::new(&shown),
        my_templates_folder_in(data.path()).unwrap()
    );
}

#[test]
fn a_template_is_saved_by_its_id_listed_with_its_text_and_removed() {
    let data = Scratch::create();
    let written = my_template_save_with(data.path(), "kitchen-joinery", KITCHEN, false).unwrap();
    let path = my_templates_folder_in(data.path())
        .unwrap()
        .join("kitchen-joinery.json");
    assert_eq!(Path::new(&written.path), path);
    assert_eq!(written.bytes, KITCHEN.len() as u64);
    assert_eq!(
        serde_json::to_value(&written).unwrap(),
        json!({ "path": written.path, "bytes": KITCHEN.len() }),
        "WrittenFile without pages"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), KITCHEN);

    let listed = my_templates_list_with(data.path()).unwrap();
    assert_eq!(
        serde_json::to_value(&listed).unwrap(),
        json!({
            "templates": [ { "id": "kitchen-joinery", "text": KITCHEN, "problem": null } ],
            "notListed": 0,
            "note": null
        }),
        "camelCase, and every unknown is null, never absent"
    );

    my_template_remove_with(data.path(), "kitchen-joinery").unwrap();
    assert!(!path.exists());
    assert!(my_templates_list_with(data.path())
        .unwrap()
        .templates
        .is_empty());
}

#[test]
fn an_existing_template_is_replaced_only_with_overwrite() {
    let data = Scratch::create();
    my_template_save_with(data.path(), "bathroom", "{ \"v\": 1 }", false).unwrap();

    let refused = my_template_save_with(data.path(), "bathroom", "{ \"v\": 2 }", false);
    assert_eq!(
        invalid_sentence(refused.unwrap_err()),
        "“bathroom.json” is already in your templates; replace it to save over it."
    );
    let templates = my_templates_folder_in(data.path()).unwrap();
    assert_eq!(
        std::fs::read_to_string(templates.join("bathroom.json")).unwrap(),
        "{ \"v\": 1 }"
    );

    my_template_save_with(data.path(), "bathroom", "{ \"v\": 2 }", true).unwrap();
    assert_eq!(
        std::fs::read_to_string(templates.join("bathroom.json")).unwrap(),
        "{ \"v\": 2 }"
    );
    assert_eq!(
        names_in(&templates),
        vec!["bathroom.json"],
        "no temporary file left behind"
    );
}

#[test]
fn a_template_past_the_cap_is_not_saved() {
    let data = Scratch::create();
    let cap = MAX_TEMPLATE_BYTES as usize;
    my_template_save_with(data.path(), "full", &" ".repeat(cap), false)
        .expect("1 MiB is inside the cap");
    assert_eq!(
        invalid_sentence(
            my_template_save_with(data.path(), "large", &" ".repeat(cap + 1), false).unwrap_err()
        ),
        "“large.json” was not saved: it would be larger than 1 MiB."
    );
    assert_eq!(
        names_in(&my_templates_folder_in(data.path()).unwrap()),
        vec!["full.json"]
    );
}

#[test]
fn a_folder_named_like_a_template_is_not_saved_over_listed_but_not_read_or_removed() {
    let data = Scratch::create();
    let templates = folder(&data);
    std::fs::create_dir(templates.join("x.json")).unwrap();
    std::fs::write(templates.join("x.json").join("inner.json"), KITCHEN).unwrap();

    assert_eq!(
        invalid_sentence(my_template_save_with(data.path(), "x", "{}", true).unwrap_err()),
        "“x.json” was not saved: a folder of that name is already there."
    );
    assert_eq!(
        invalid_sentence(my_template_save_with(data.path(), "x", "{}", false).unwrap_err()),
        "“x.json” is already in your templates; replace it to save over it."
    );

    let listed = my_templates_list_with(data.path()).unwrap();
    assert_eq!(listed.templates.len(), 1, "no recursion into it");
    assert_eq!(listed.templates[0].id, "x");
    assert_eq!(listed.templates[0].text, None);
    assert_eq!(
        listed.templates[0].problem.as_deref(),
        Some("“x.json” was not read: it is a folder, not a file.")
    );

    assert_eq!(
        invalid_sentence(my_template_remove_with(data.path(), "x").unwrap_err()),
        "“x.json” was not removed: it is not a file."
    );
    assert!(templates.join("x.json").join("inner.json").is_file());
}

#[test]
fn files_that_cannot_be_templates_are_listed_with_their_sentence_and_others_are_ignored() {
    let data = Scratch::create();
    let templates = folder(&data);
    let cap = MAX_TEMPLATE_BYTES as usize;
    let at = |name: &str, bytes: &[u8]| std::fs::write(templates.join(name), bytes).unwrap();
    at("bathroom.json", b"{}");
    at("empty.json", b"");
    at("large.json", &vec![b' '; cap + 1]);
    at("latin1.json", b"{ \"title\": \"Cozinha \xe9\" }");
    at("Kitchen Plan.json", KITCHEN.as_bytes());
    at("UPPER.JSON", KITCHEN.as_bytes());
    at("con.json", KITCHEN.as_bytes());
    let long = format!("{}.json", "a".repeat(MAX_TEMPLATE_ID_CHARS + 1));
    at(&long, KITCHEN.as_bytes());
    // Not a template by name: not listed at all.
    at("notes.txt", b"{}");
    at("plan.json.tmp", b"{}");
    at(".bathroom.json.0190.tmp", b"{}");

    let listed = my_templates_list_with(data.path()).unwrap();
    let rows: Vec<(String, Option<String>, Option<String>)> = listed
        .templates
        .into_iter()
        .map(|row| (row.id, row.text, row.problem))
        .collect();
    let not_an_id = |name: &str| {
        Some(format!(
            "“{name}” was not read: its name is not a template's id — kebab-case, 1 to {MAX_TEMPLATE_ID_CHARS} characters, such as bathroom-renovation."
        ))
    };
    assert_eq!(
        rows,
        vec![
            ("Kitchen Plan".into(), None, not_an_id("Kitchen Plan.json")),
            ("UPPER".into(), None, not_an_id("UPPER.JSON")),
            (
                "a".repeat(MAX_TEMPLATE_ID_CHARS + 1),
                None,
                not_an_id(&long)
            ),
            ("bathroom".into(), Some("{}".into()), None),
            ("con".into(), None, not_an_id("con.json")),
            (
                "empty".into(),
                None,
                Some("“empty.json” was not read: it is empty.".into())
            ),
            (
                "large".into(),
                None,
                Some("“large.json” was not read: it is larger than 1 MiB.".into())
            ),
            (
                "latin1".into(),
                None,
                Some("“latin1.json” was not read: it is not text in UTF-8.".into())
            ),
        ],
        "sorted by id; each read or said why not"
    );
}

#[test]
fn past_two_hundred_the_rest_are_counted_and_said() {
    let data = Scratch::create();
    let templates = folder(&data);
    let total = MAX_MY_TEMPLATES + 3;
    for n in 0..total {
        std::fs::write(templates.join(format!("t-{n:04}.json")), b"{}").unwrap();
    }

    let listed = my_templates_list_with(data.path()).unwrap();
    assert_eq!(listed.templates.len(), MAX_MY_TEMPLATES);
    assert_eq!(listed.not_listed, 3);
    assert_eq!(
        listed.note.as_deref(),
        Some("3 more templates are in the folder and were not listed: only the first 200 are.")
    );
    assert_eq!(listed.templates[0].id, "t-0000");
    assert_eq!(
        listed.templates[MAX_MY_TEMPLATES - 1].id,
        format!("t-{:04}", MAX_MY_TEMPLATES - 1),
        "the first 200 by id, whatever order the disk gives"
    );

    std::fs::remove_file(templates.join("t-0000.json")).unwrap();
    std::fs::remove_file(templates.join("t-0001.json")).unwrap();
    let listed = my_templates_list_with(data.path()).unwrap();
    assert_eq!(listed.not_listed, 1);
    assert_eq!(
        listed.note.as_deref(),
        Some("1 more template is in the folder and was not listed: only the first 200 are.")
    );
}

#[test]
fn removing_a_template_that_is_not_there_says_so() {
    let data = Scratch::create();
    assert_eq!(
        invalid_sentence(my_template_remove_with(data.path(), "gone").unwrap_err()),
        "“gone.json” is not in your templates folder; it may have been removed already."
    );
    folder(&data);
    assert_eq!(
        invalid_sentence(my_template_remove_with(data.path(), "gone").unwrap_err()),
        "“gone.json” is not in your templates folder; it may have been removed already."
    );
}

#[test]
fn removing_one_template_removes_that_file_and_nothing_else() {
    let data = Scratch::create();
    let templates = folder(&data);
    std::fs::write(data.path().join("kitchen.json"), KITCHEN).unwrap();
    std::fs::write(templates.join("kitchen.json"), KITCHEN).unwrap();
    std::fs::write(templates.join("kitchen.json.bak"), KITCHEN).unwrap();
    std::fs::write(templates.join("kitchen-2.json"), KITCHEN).unwrap();

    my_template_remove_with(data.path(), "kitchen").unwrap();

    assert_eq!(
        names_in(&templates),
        vec!["kitchen-2.json", "kitchen.json.bak"]
    );
    assert!(
        data.path().join("kitchen.json").is_file(),
        "the file of the same name outside the folder is untouched"
    );
}

/// Make a link to a file, where the system lets this process; `false` when it
/// does not (Windows without the privilege to make one).
fn link_file(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(target, link);
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(target, link);
    made.is_ok()
}

#[test]
fn a_link_named_like_a_template_is_never_followed_read_saved_over_or_removed() {
    let data = Scratch::create();
    let templates = folder(&data);
    let outside = data.path().join("outside.json");
    std::fs::write(&outside, KITCHEN).unwrap();
    if !link_file(&outside, &templates.join("linked.json")) {
        eprintln!("skipped: this process may not make a link");
        return;
    }

    let listed = my_templates_list_with(data.path()).unwrap();
    assert_eq!(listed.templates.len(), 1);
    assert_eq!(listed.templates[0].id, "linked");
    assert_eq!(
        listed.templates[0].text, None,
        "the file it points to is not read"
    );
    assert_eq!(
        listed.templates[0].problem.as_deref(),
        Some("“linked.json” was not read: it is a link, and a link is not followed.")
    );

    assert_eq!(
        invalid_sentence(my_template_save_with(data.path(), "linked", "{}", false).unwrap_err()),
        "“linked.json” is already in your templates; replace it to save over it."
    );
    assert_eq!(
        invalid_sentence(my_template_remove_with(data.path(), "linked").unwrap_err()),
        "“linked.json” was not removed: it is not a file."
    );
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), KITCHEN);
}

#[test]
fn a_relative_application_data_folder_is_made_full() {
    let folder = my_templates_folder_in(Path::new("relative-data")).unwrap();
    assert!(folder.is_absolute(), "{}", folder.display());
    assert!(folder.ends_with(Path::new("relative-data").join(MY_TEMPLATES_FOLDER)));
}

/// A junction needs no privilege on Windows, so the link that is never
/// followed is tested on every Windows machine, not only where a symbolic
/// link may be made.
#[cfg(windows)]
#[test]
fn a_junction_named_like_a_template_is_never_followed_or_removed() {
    let data = Scratch::create();
    let templates = folder(&data);
    let outside = data.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("inner.json"), KITCHEN).unwrap();
    let junction = templates.join("joined.json");
    let made = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&outside)
        .output()
        .expect("cmd runs");
    assert!(made.status.success(), "mklink /J made the junction");

    let listed = my_templates_list_with(data.path()).unwrap();
    assert_eq!(listed.templates.len(), 1, "nothing behind it is listed");
    assert_eq!(listed.templates[0].text, None);
    assert_eq!(
        listed.templates[0].problem.as_deref(),
        Some("“joined.json” was not read: it is a link, and a link is not followed.")
    );
    assert_eq!(
        invalid_sentence(my_template_remove_with(data.path(), "joined").unwrap_err()),
        "“joined.json” was not removed: it is not a file."
    );
    assert_eq!(
        invalid_sentence(my_template_save_with(data.path(), "joined", "{}", true).unwrap_err()),
        "“joined.json” was not saved: a folder of that name is already there."
    );
    assert_eq!(
        std::fs::read_to_string(outside.join("inner.json")).unwrap(),
        KITCHEN
    );
    std::fs::remove_dir(&junction).expect("the junction alone is removed");
}
