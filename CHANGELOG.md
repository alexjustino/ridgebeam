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

### Added in F2 — the schedule

Dependencies with lag on the working calendar; the critical path highlighted on a Gantt; the
finish date; approving the plan takes baseline 1; and a slip that moves every dependent activity
and the finish date is a figure that carries its rows.

- **Dependencies.** An activity or a whole stage starts after another activity or stage has
  finished, with a lag of 0 to 3650 working days that is waiting, not work. They are added and
  removed on the Plan's breakdown, under each activity. A stage stands for all its activities; a
  dependency onto a stage with no activities joins nothing and is shown as inert. Removing an
  activity or a stage removes the dependencies that name it.
- **A cycle is refused twice**, with the loop named in the activities' own words — "Plaster →
  Foundations → Walls → Plaster" — by the domain before the host is asked, and by the host
  (`dependency_cycle`). A file that already holds a cycle is not drawn; the Schedule says so.
- **One scheduling engine** (ADR-015): the critical path of a sibling product, copied literally
  with its tests and then extended to working days, lags, stage endpoints and the working
  calendar. An activity nothing constrains starts on the first working day. It replaces F0's
  placement in sequence.
- **The Schedule**, a new destination on the rail: a Gantt over working days with weekends and
  holidays shaded, stages as bands, dependency arrows, the critical path marked by colour, by a
  heavier stroke and in each bar's accessible name, and also given as a list; activities with no
  duration listed below the chart with the reason. Every bar is reachable by keyboard.
- **Approve the plan = baseline 1** (ADR-016). Approving copies every activity's name, stage,
  duration, start and finish into a baseline and records when. Baselines are insert-only from
  the first: triggers refuse `UPDATE`, `DELETE` and `REPLACE`, rows may be added only to the
  latest baseline, the approval instant never changes, and the host holds no statement that
  would try. The latest baseline is drawn as ghost bars under the current plan.
- **The slip.** Once a baseline exists, the finish date's slip in working days is a figure — "2
  days", "0 days", "3 days early" — that opens onto every activity whose finish moved, each with
  its own days and its baseline and current finish; an activity removed since approval is listed
  and not counted, and one added since is listed as added. An activity can move inside its
  float without moving the finish, so each row also says how far its finish lies past the
  baseline's finish, and a positive slip is the largest of those, never a sum. The Dashboard shows the finish date
  against the baseline, the same slip figure, and how many activities are on the critical path.
- **A third readiness rule**: in a plan of two or more activities, one that is linked to nothing
  is not ready — "1 job is not linked to any other." — the specification's "every dependency
  that matters is declared", made measurable. Rules now say when they apply: in a plan of one
  activity there is nothing to link, and the rule counts neither as known nor as missing.
- **The benchmark.** A seeded work of 2 000 activities in 40 stages with 3 000 links is scheduled,
  and its Gantt laid out, within SPEC §4's budget with CI's threefold headroom; the medians are
  recorded in ADR-015: 5.3 ms to schedule and 5.4 ms to lay out, against 100 ms and 500 ms.
- **Work migration 003** (`003_dependencies_and_baselines.sql`) adds `dependency`,
  `work.approved_at`, `baseline` and `baseline_activity` with their insert-only triggers. A work
  from F1 is migrated when it is opened, without loss.

Not yet, said plainly: editing an approved plan does not ask for a reason, and there is no
second baseline or comparison between baselines — those are F8's. Dependencies are
finish-to-start only; there are no milestones and no resource levelling.

### Added in F3 — decisions and readiness

A decision belongs to a stage with a lead time, and its deadline is computed and moves with the
schedule; readiness is explained rule by rule; "what the plan does not know" is a list that
opens onto each row.

- **Decisions.** A decision — "Which tile" — belongs to a stage and has a lead time of 0 to 3650
  working days. It is added, renamed, reordered (buttons and Alt+Arrow, announced), removed with
  a confirmation, marked as made with an optional answer, and reopened, which clears the answer.
  Removing a stage removes its decisions.
- **The deadline is computed, never stored** (ADR-017): the earliest scheduled start of the
  decision's stage minus its lead time, counted backwards in working days on the calendar. It
  moves when the schedule moves. A stage with nothing scheduled gives no deadline, and the
  decision says why. There is no deadline column and no overdue column.
- **Today is an input.** The domain never reads the clock; the interface passes the local day.
  A decision is _due in N working days_, _due today_, _overdue by N working days_, _made_, or has
  _no deadline yet_. A made decision is never overdue.
- **Overdue on creation is said, not refused.** A lead time longer than the time left keeps the
  decision and puts a caution on its row at once: "Already overdue: 10 working days of lead time,
  but Tiling starts in 4 working days."
- **The Decisions destination**, between Schedule and Settings: every decision of the work,
  overdue first, then due, then without a deadline, made last — with its stage, lead time,
  deadline and days left, and the way to mark it made or reopen it. Names and lead times are
  edited in the breakdown, which it links back to.
- **Two readiness rules** — every decision has a deadline; every decision with a deadline is
  made or not yet overdue — "1 decision has no deadline yet.", "2 decisions are overdue."
- **Readiness rule by rule** (ADR-018). Under the figure, one line per rule — "Durations · 4 of
  4", "Decisions in time · 0 of 1" — each opening onto its own rows with a sentence on why the
  plan must know it. The rules add up exactly to the figure, and a test holds it. "What the plan
  does not know" is grouped by the rule each row fails.
- **Decisions due** is a dashboard figure: the decisions overdue or due within the next five
  working days, opening onto each with its deadline and days left.
- **Work migration 004** (`004_decisions.sql`) adds `decision`. A work from F2 is migrated when
  it is opened, without loss.

Not yet, said plainly: a decision is needed by its whole stage, so its deadline counts from the
stage's earliest start rather than from the one activity that needs it.

### Added in F4 — the diary

One-tap and detailed entries with photos copied in; entries append-only with a verified chain;
an edit refused and a correction offered; progress on the plan derived from the entries; the
day view; and after a restart, the chain still holds.

- **An entry is a fact about one day**: what was worked on and what was finished (with a
  quantity where there is one), who was there, the weather, hours, a lost day, deliveries,
  incidents, visitors, a note and photos, signed with the Windows account's name. A day in the
  future is refused — by the domain before the host is asked, and by the host against its own
  clock. A second entry on the same day is allowed and ordered after the first.
- **Append-only, twice** (ADR-019). Four tables — entries, done lines, people present, photos —
  refuse `UPDATE`, `DELETE` and `REPLACE` with triggers; a guard refuses a key that exists; a
  child row can be added only to the entry being written; and a chain trigger accepts only the
  next entry carrying the previous one's hash. The host's diary module holds no `UPDATE`,
  `DELETE` or `REPLACE`, and a test reads its source to prove it. There is no edit command.
- **A correction is a new entry.** _Correct…_ opens the entry's facts as a new entry that names
  it and asks what was wrong; the day view shows the original struck through, "corrected by #N",
  beside it. Everything derived from the diary reads the latest correction; a correction may be
  corrected.
- **The chain.** Each entry's hash is the SHA-256 of a canonical form of the entry and its
  children, including the previous hash. **Verify the diary** in Diagnostics recomputes every
  hash and link — "3 entries, chain intact" or "broken at #2" with the reason — and says what
  that proves: tamper-evidence, not a signature and not legal proof. `cargo test` tampers with a
  file from outside — a note rewritten, a photo hash changed, a row deleted — and shows the
  verification fail at that entry.
- **Photos are hostile files, copied by the host** (ADR-021): measured before decoding — 25 MiB,
  the format from the first bytes (JPEG, PNG, WebP, GIF, BMP; HEIC refused by name), 12 000 px
  from the header — hashed, copied to `documents/<hash>.<ext>` and given a 320 px thumbnail
  decoded under limits. A refused photo refuses the whole entry, naming the file, and nothing is
  written. Thumbnails reach the screen as data URLs; there is no asset protocol and no
  file-system permission; the original opens in the system's viewer, from Rust, on a click. A
  hostile corpus — a text file named `.jpg`, a lying PNG header, a truncated JPEG, an empty file,
  a 26 MiB file — is refused in `cargo test`.
- **Progress is derived, in states** (ADR-020): not started, started, finished, with the day
  each began and ended, and a share only where the diary recorded quantities against a planned
  one. The checklist ticks a line the diary says is finished; the Gantt fills finished bars,
  marks started ones and draws the actual dates; stages count their activities by state.
- **The Diary destination**, between Decisions and Settings: today at the top, the days below,
  newest first, each entry with its author, time, work, people, weather, photos and _Correct…_.
- **The dashboard grows**: this week on site, days without an entry (over working days),
  weather days lost, _Done_ — finished, started, not started — and the last entries with their
  photos; each figure opens onto its rows.
- **Work migration 005** (`005_diary.sql`) adds the four diary tables and their triggers. A work
  from F3 is migrated when it is opened, without loss. The release checklist gains a step: verify
  the diary after an upgrade.

Not yet, said plainly: the diary's export with the chain verified in its header is F10's; HEIC
photos are refused; documents other than photos are F7's.
