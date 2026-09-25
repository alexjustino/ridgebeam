# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Slice F0 — the foundation, the shell, one stage, and readiness. The product's thesis is on the
screen from the first slice: the plan says what it does not yet know, in English and in
Portuguese.

### Added

- **A work is a folder.** A new work is created in an empty folder chosen in the system dialog,
  as one SQLite database (`work.sqlite3`) opened in WAL mode with `synchronous = FULL`, and
  checkpointed and closed when the work is closed so that a closed folder holds one file
  (ADR-004). An existing work is opened from its folder; the recent works are listed, and one
  whose folder is gone says so and offers a way to find it. A folder moved while its work is
  open is refused with a sentence, not a crash.
- **One stage and one activity, scheduled on a working calendar.** A work has a start date and a
  working calendar — working days and hours per day; a calendar with no working day is refused.
  Holidays are in the model and the host, counted by the calendar and shown on the dashboard;
  the screen to enter them arrived with F1. A stage holds activities; an activity has a duration in working days and a responsible. Activities
  are placed on the calendar in order — a deliberately simple placement that the critical-path
  engine replaces in F2 — and an activity with no duration is shown as not scheduled, with the
  reason.
- **Readiness.** The share of what the plan must know that it does know, computed from two rules
  that are data — every activity has a duration, every activity has a responsible (ADR-008). The
  figure opens onto its rows, each naming the activity and what it lacks, and a sentence built
  from counts says what is missing: "1 activity has no responsible." — "1 atividade não tem
  responsável."
- **The shell.** A Fluent window with Mica and the system accent, light and dark themes, and a
  rail with Dashboard and Plan, then Settings, Diagnostics and About. Settings holds the
  language (system, English, Portuguese), the theme and the lens, with the owner's lens as the
  default (ADR-013). Diagnostics lists the application and work databases, their schema versions
  and their pragmas. About tells the name's story in both languages and reads the version from
  the binary.
- **No progress command.** There is no command, column or control that sets progress; progress
  arrives from the diary in F4 (ADR-009).
- **Documents written before the first work is created:** [`SECURITY.md`](SECURITY.md), the
  threat model; [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), the schema of both databases;
  [`docs/GLOSSARY.md`](docs/GLOSSARY.md), every term with its plain sentence in both languages,
  generated from `src/i18n/glossary.json`; [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md);
  [`docs/RELEASE.md`](docs/RELEASE.md); and ADR-002 to ADR-013 in
  [`docs/architecture/ADR.md`](docs/architecture/ADR.md).
- **Gates and CI.** `npm run gates` runs the version check, the glossary check, `cargo fmt`,
  `cargo clippy -D warnings`, `cargo test`, `tsc`, ESLint (with `react-hooks/rules-of-hooks` as
  an error and the domain boundary enforced), Prettier and Vitest — including the literals and
  dictionaries tests that hold both languages. CI runs the same script on every pull request,
  with `npm audit` and `cargo audit` beside it.
- **End-to-end tests against the binary.** The debug build, driven through `tauri-driver` and
  Microsoft Edge WebDriver on a relocated data folder: a work created, a stage and an activity
  added, readiness opened onto its missing row in both languages, filled to 100 %, and still
  there after a restart — with axe-core on every destination in both themes and both languages
  (ADR-010, ADR-011).
- **Release tooling.** A bundle check that fails an installer over 10 MB, a `dist/` carrying
  source, or a binary that was not stripped; a release workflow that builds the MSI and NSIS
  installers from a tag on `main` and writes their SHA-256 into a draft release. The installers
  are not code-signed (ADR-012).

### Added in F1 — the plan

Stages, activities, rooms, quantities and responsibles; the work breakdown, the works by room
and the owner's checklist as the same rows in three arrangements; reorder by keyboard; and the
lens switch changing every term through the glossary while storing nothing.

- **Rooms.** A work has rooms or areas, in an order the person sets; an activity touches zero or
  more of them. Removing a room leaves its activities; removing an activity leaves its rooms.
- **Quantity and unit.** An activity may say how much of it there is — 12 m² of tile — with a
  unit of up to 16 characters that means nothing without a quantity and is refused on its own.
  A quantity is not a readiness rule.
- **Order, by keyboard.** Stages, the activities of a stage, and rooms move up and down with
  Move up and Move down buttons and with Alt+ArrowUp and Alt+ArrowDown on the focused row; the
  move is announced, the focus stays on the row, and the numbering (1, 1.1, 1.2 …) follows.
  Positions stay 1 … n on disk, renumbered in the same transaction as the move.
- **Three arrangements of the same rows.** The Plan opens onto the numbered **breakdown**, where
  editing lives; the works **by room**, with the activities in no room yet grouped last and an
  activity in two rooms shown under both; and the owner's **checklist**, one line per activity
  in placement order, saying what each line's plan still lacks. The checklist's box is not a
  control: done arrives from the diary in F4. A test holds that the three arrangements contain
  exactly the same activities.
- **Three lenses, one model** (ADR-014). The glossary gains a vocabulary table: per language,
  the word the engineer, the architect and the owner use where a term differs — _activity_,
  _work item_, _job_; _atividade_, _serviço_, _serviço_. The lens switch sits in the title bar
  and writes the `lens` setting and nothing else; the tab the Plan opens first follows it.
  `docs/GLOSSARY.md` shows the table, and its gate validates the lens names.
- **Holidays have their screen.** A Calendar card on the Plan edits the working days, the hours
  per day and the holidays; a calendar with no working day is refused with a sentence, and the
  finish date moves with every holiday added inside the plan.
- **People** are renamed and removed on the Plan. Removing one leaves their activities with no
  responsible, the confirmation says so, and readiness drops accordingly.
- **Work migration 002** (`002_rooms_and_quantities.sql`) adds `room`, `activity_room`,
  `activity.quantity` and `activity.unit`. A work created by F0 is migrated when it is opened,
  without loss.
