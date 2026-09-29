# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-09-28

The first release. Ridgebeam plans a building work — a bathroom, a kitchen, a roof, a house — for
the engineer, the architect and the owner who is not either, on one Windows machine, with no
account and no network. It is built in twelve slices, F0 to F11, each described below in the order
it arrived.

**What it does.** A work is a folder on the person's disk. Its plan is stages and activities on a
working calendar, linked with lags, with the critical path and the finish date computed, and the
plan can start from a template of the library (six, in English and Portuguese) whose durations are
ranges until somebody picks. **Readiness** — how much of what the plan must know it does know — is
the front door's figure, and it says in a sentence what is missing. Decisions carry a deadline
computed from the schedule. The **site diary** is append-only and hash-chained; progress comes from
it, never from a field. Each stage has a start gate and a close gate of checks. Money is planned,
committed and paid in whole cents, the payments in an append-only ledger. Approving the plan takes
baseline 1; after that the plan changes only through a replanning with a reason, and any two
baselines compare. Files the work holds are copied into its folder by their hash and never parsed.
The weekly report, the diary and the schedule print as PDFs; the diary exports as CSV and the work
as JSON; the whole work backs up as one file and restores into a new folder.

**What it is not.** Not a signature and not legal proof: the diary's chain shows whether the file
was changed outside the product, nothing more. Not a quote: the library carries ranges and no
prices. Not synchronised, not shared and not in the cloud — one person, one machine, in 1.0. The
installers are not code-signed, so Windows SmartScreen warns on the first run.

**Migrations.** A work written by this release is at schema 10 and the application database at 3.
There is no earlier release to migrate from.

### Added in F0 — the foundation, the shell, one stage, and readiness

The product's thesis is on the screen from the first slice: the plan says what it does not yet
know, in English and in Portuguese.

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

### Added in F5 — checks

Start and close checklists per stage; a stage cannot close with an unanswered item; _not
applicable_ needs a reason; checks are edited per work; the inspection is a check with a photo.

- **A stage's lifecycle** (ADR-022): _planned_, _started_, _closed_, decided by the person and
  stored as two moments on the stage. It is intent, not progress — progress still comes from the
  diary. Starting cannot be undone, and the confirmation says so; a closed stage can be
  reopened.
- **Checks.** A stage has questions at its start gate and at its close gate, added, renamed,
  reordered (buttons and Alt+Arrow, announced) and removed in the breakdown. A check that has been
  answered cannot be removed — its answers are facts — and so neither can its stage. Until
  templates arrive (F9), **Add the usual checks** inserts four at each gate in the person's
  language: the previous stage is closed, the materials are on site, the area is clear and
  protected, the people are confirmed; the work was inspected, photos were taken, the owner
  walked it, leftovers and waste were removed.
- **Answers are facts, append-only and not chained.** _Yes_, _no_ or _not applicable_ — which
  is refused without a reason — with the account's name and the moment. Answering again adds to
  the history; the latest answer counts. The same triggers and guard as the diary refuse any
  edit or removal. An answer may carry a photo, copied and thumbnailed exactly as a diary photo
  is: the inspection is a check with a photo.
- **The gate.** A stage starts only when every start check's latest answer is _yes_ or _not
  applicable_, and closes only when every close check's is — and only once it has started. An
  unanswered item or a _no_ holds the gate, and the **Gates** tab says which items, by name,
  beside the disabled button; the host refuses too (`stage_gate_open`), naming them.
- **A closed stage is closed.** Its activities cannot be added, changed, moved or removed, its
  rows cannot be renamed, and no dependency may make one of its activities wait — refused by the
  domain and by the host (`stage_closed`), saying to reopen it first. This is the negative case
  deferred since F2, now a real test. The diary may still write about a closed stage's
  activities.
- **The Gates tab** on the Plan: one card per stage with its state, both checklists with each
  item's latest answer and _Yes_ / _No_ / _N/A_, the photo beside an item answered with one, and
  _Start stage_, _Close stage_ and _Reopen_.
- **A sixth readiness rule**, `stage.checks`: every stage has at least one check at each gate —
  "2 stages have no checks." — the specification's "every stage has … its checks defined".
- **The dashboard grows**: stages planned, started and closed, and the gates held — each a
  figure opening onto its stages and, for a held gate, the items holding it.
- **Work migration 006** (`006_checks.sql`) adds `stage.started_at`, `stage.closed_at`,
  `stage_check` and `check_answer`. A work from F4 is migrated when it is opened, without loss,
  and its diary's chain still verifies.

Not yet, said plainly: checks come from the usual list, not from a template, until F9; answers
carry no hash chain.

### Added in F6 — money

Planned, committed and paid per stage and per trade; the payments ledger with receipts; every
figure opens onto its rows; paid over committed is flagged; the S-curve of planned against paid.

- **Three amounts, three sources** (ADR-023). **Planned** comes from cost lines — a label and an
  amount — on a stage or on an activity, edited in the breakdown; a stage's planned amount is its
  own lines and its activities'. **Committed** comes from commitments — a quote or contract
  accepted, with the person, the amount and the day agreed — which can be changed or removed
  only while nothing has been paid against them. **Paid** comes from the payments ledger.
- **Money is whole cents.** Every amount is an integer number of minor units in the work's
  currency, from the file to the screen; the interface reads major units with decimals and
  formats with the platform's own formatting — "$1,000.00" in English, "US$ 1.000,00" in
  Portuguese.
- **The ledger is append-only, with reversals.** A payment — day, stage, person, commitment,
  amount, what for, receipt, the account's name — is never edited or removed; triggers refuse
  `UPDATE`, `DELETE` and `REPLACE`. A mistake is **reversed**: a new, negative payment naming
  the one it reverses, with a note — never larger than the original, and only once. No chain:
  the diary's is the record's spine.
- **Every money figure carries its rows** (ADR-024): per stage, per trade and for the work —
  planned, committed, paid, remaining (planned minus paid) and variance (committed minus
  planned) — each a button opening onto the lines it adds up. The stages add up to the work.
- **Paid over committed is flagged, not refused**: the payment is recorded, and the stage and
  the commitment are marked _over committed_ with the excess, in words. The dashboard counts the
  stages paid over what was committed.
- **Trades.** A person gains a trade; the By trade tab groups commitments and payments by it,
  and people with no trade yet are grouped as such.
- **The S-curve**: planned money spread over the schedule — each cost line over its activity's
  working days — against paid money by payment day, two lines told apart by colour and dash,
  with a weekly table beneath that is its accessible reading. Lines with nothing scheduled are
  placed at the start, and the chart says so.
- **Receipts are images**, through the same caps, copy and thumbnail as diary photos. PDF
  receipts arrive with F7's documents.
- **The Money destination**, between Diary and Settings: By stage, By trade and the Ledger, with
  Record a payment and Reverse…. The dashboard grows planned, committed and paid for the work,
  each opening onto its rows, and the over-committed count.
- **A seventh readiness rule**, `stage.money`: every stage has at least one cost line — "every
  stage has its money planned". Readiness moves again for every work with stages.
- **Work migration 007** adds `person.trade`, `cost_line`, `commitment` and `payment` with its
  insert-only and reversal triggers. A work from F5 is migrated when it is opened, without loss,
  and its diary's chain still verifies.

Not yet, said plainly: a receipt is an image or nothing until F7; one currency per work;
payments are not chained.

### Added in F7 — people and documents

Trades and contacts; who is on site from the diary; files copied into the work folder with
thumbnails, hashes and caps; the hostile file corpus refused with a sentence; a moved work folder
found again from a dialog.

- **People are contacts** (ADR-026): a trade, a phone, an e-mail, a note, their availability and
  the stages they are expected on, edited in the breakdown's People card. The phone and e-mail
  are text somebody typed — the product never dials, sends or looks anything up. A **People** tab
  on the Plan lists everyone with their stages, **the days they were on site and the last one,
  from the diary**, and what they are owed, from the ledger.
- **Documents are files the work owns** (ADR-025): quotes, drawings, permits, receipts,
  contracts, photos and others, each with an editable title and kind, copied into
  `documents/<hash>.<ext>` and attached to the work, a stage, an activity, a decision, a diary
  entry, a commitment or a payment — any number of each.
- **Typed by their bytes.** JPEG, PNG, WebP, GIF and BMP are images, measured and thumbnailed as
  in F4; a PDF is recognised by its first bytes and is **never parsed or rendered** — it shows as
  a mark and opens in the system's viewer. Everything else is refused with a sentence naming the
  file: Word, spreadsheets, archives, executables, HEIC — and SVG, which can carry scripts. Every
  file is capped at 25 MiB.
- **Deduplicated by hash.** The same file attached twice is one file. Removing a document deletes
  its file only when nothing else names it — another document, a diary photo, an answer's photo,
  a receipt or a commitment — and otherwise says the file stays.
- **One file, one transaction**: adding ten files where one is refused keeps the nine and names
  the one with its reason.
- **Photos, receipts and quotes are documents too**: every file copied in is recorded in the
  library, and migration 008 records the ones earlier slices copied, linked to where they came
  from. Receipts may now be PDFs.
- **The Documents destination**, between Money and Settings: the library with filters by kind
  and by attachment, Open, Attach to…, Detach and Remove. Elsewhere — a stage, an activity, a
  decision, an entry, a commitment, a payment — a count that links to it, never a second editor.
  The dashboard counts the documents by kind.
- **The hostile corpus is the gate.** `cargo test` generates a text file named `.jpg`, a PNG
  claiming 100 000 pixels, a truncated JPEG, an empty file, a 26 MiB image and a 26 MiB PDF, an
  executable named `.pdf`, a zero-width PNG, a WebP with a lying size, a HEIC, an SVG and a zip
  bomb named `.pdf`, and proves each is refused with a sentence and nothing is written — and that a PNG named `.pdf` is kept, as the PNG it is. The files
  are not committed; their SHA-256 manifest is, in `fixtures/hostile/MANIFEST.json`, and a test
  fails when the generator drifts from it.
- **Folder health** in Diagnostics: the folder's size and file counts; **Re-hash the documents**,
  which reads every file and compares it with its recorded hash — closing the gap F4 stated, that
  the diary's chain checks the rows and not the files; rows whose file is missing; and files no
  row names, **listed and never deleted**.
- **A moved work folder is found again.** A recent work whose folder is gone offers _Find it…_;
  the chosen folder opens only if it holds the same work, and a folder holding another work is
  refused, naming both.
- **Work migration 008** (`008_documents.sql`) adds the person's contact columns,
  `person_stage`, `document` and `document_link`, and records every file already in the folder.
  A work from F6 is migrated when it is opened, without loss, and its diary's chain still
  verifies.

Readiness is unchanged: the specification names no rule for contacts or documents.

### Added in F8 — replanning and baselines

Editing an approved plan asks for a reason and makes baseline N+1; any two baselines compare with
the dates moved, the stages added or removed, the money changed and the reasons between them; a
what-if that is not saved is not a baseline.

- **An approved plan is locked until somebody says why** (ADR-027). After approval, the host
  refuses every change to what a baseline records — adding, renaming, moving or removing a stage
  or an activity, an activity's name or duration, a link or its lag, the calendar, the work's
  start date, a cost line — with a new error kind, `plan_approved`: "The plan is approved. To
  change it, replan it with a reason first." Facts stay free: the diary, gate answers, starting,
  closing and reopening a stage, payments, commitments, decisions, people, rooms and documents,
  and what a baseline does not record — an activity's responsible, rooms and quantity, and the
  work's name, place and currency.
- **Replan…** opens a replanning with its reason, from the Plan's breakdown — where a banner
  says the plan is locked — or from the Schedule's baseline card. A blank reason is refused; so is
  a replanning before approval, and a second one while one is open. A replanning is a row, so it
  survives a restart; while it is open the Plan, the Schedule and the Dashboard show since when
  and why, and the plan can be edited.
- **Take baseline N+1** closes it: the new baseline copies the replanning's reason, in the same
  transaction. A second baseline without an open replanning is refused — "A second baseline needs
  the reason the plan changed." There is no abandon: an edit already made ends in a baseline.
- **Baselines record stages and money.** Every stage — one with no activities included — with its
  planned money, each activity's planned money and the work's total, in cents, read from the file
  when the baseline is taken.
- **Any two baselines compare** (ADR-028), on the Schedule's new **Baselines** card: every
  baseline with its reason — or "the approval" — its finish date and its planned money, and two
  to compare, the last two by default. The comparison is counted figures that open onto their
  rows: the finish moved, dates moved, durations changed, activities added and removed, stages
  added and removed, the money changed, and the reasons in between, in order. Activities and
  stages are matched by id, so one renamed is the same one. The pair is read from the earlier to
  the later whichever way it was chosen, and the card says so; a baseline compared with itself is
  refused with a sentence.
- **What if**, on the Schedule: try other durations for activities and other lags for links, as
  many as wanted, and see the finish date they would give against today's plan and against the
  latest baseline. Nothing is written — a sentence says so, **Clear** drops it, and leaving the
  Schedule or a restart forgets it; to keep it, replan with a reason. A duration on an activity of a closed stage is
  refused.
- **The Dashboard** says how many times the plan was replanned, and whether a replanning is open.
- **Work migration 009** (`009_replanning.sql`) adds `replanning` with its written-once triggers,
  the money columns of `baseline` and `baseline_activity`, and `baseline_stage` with the
  insert-only triggers of every baseline table. Baselines taken before it gain their stages,
  rebuilt from their activity rows, and their money reads **not recorded** — never 0. A work from
  F7 is migrated when it is opened, without loss, and its diary's chain still verifies.

Readiness is unchanged, and the slip still measures the plan against the latest baseline. Not in
1.0, by decision: abandoning a replanning without a baseline, and applying a what-if with one
button.

### Added in F9 — templates and the library

A work starts from a template as a **plan** with ranges; the library ships as data in the
repository and is schema-tested; a work exports as a template with its numbers stripped or kept;
[`CONTRIBUTING.md`](CONTRIBUTING.md) says how a template enters the library and the test says
whether it may.

- **The library** (ADR-029): six templates in `templates/`, one JSON file each, in English and
  Portuguese — **Bathroom renovation**, **Kitchen renovation**, **Roof replacement**, **Electrical
  rewire**, **Masonry house** and **Apartment refit**, which includes the bathroom and the kitchen
  and adds its own stages. Each is a plan a small residential work follows: stages in order with
  their typical activities, finish-to-start links, durations as **ranges of working days**, the
  decisions each stage needs with their lead-time ranges, the questions each stage must answer
  before it starts and before it closes, the rooms it touches, and cost lines as **labels with no
  prices**. Each says it is a starting point, not a quote.
- **Starting from a template.** New work offers an empty plan, the library by title in the
  current language, or a template **from a file**, with a preview that counts its stages,
  activities, decisions and checks and says it is a starting point with ranges, not a quote. An
  empty work's breakdown offers **Start from a template…**. The plan is applied once, whole, in the
  work's language, as the work's own: new rows, nothing linked back. The work records where it came
  from — "Started from: Bathroom renovation, v1" on the Dashboard — and what applying did is said
  there once: templates included, texts taken in the other language, single numbers applied as
  durations.
- **A range stays a range until a person picks.** An activity from a template has its range and no
  duration: the breakdown shows the range as the duration's hint, readiness counts it as having no
  duration and names the range, and **Use the upper end of each range** or **Use the lower end**
  writes the duration of every activity that has a range and none — an explicit act, refused after
  approval like any duration edit. A decision takes the upper end of its lead range as its lead
  time — the earlier deadline — and keeps the range.
- **A cost line may be not priced yet.** A template's cost lines are labels: planned money lists
  them as rows marked _not priced yet_, counted as nothing and said so, and the S-curve draws only
  priced lines. Readiness's _money planned_ rule now needs a **priced** line. Every cost line
  written before F9 has an amount, so no existing total and no existing readiness figure moves. An
  amount can be cleared again to unprice a line.
- **Export as a template…** on the Plan (ADR-030): **strip** (the default) keeps the plan's shape
  and the ranges it took from its template, with no durations of the site, no lead times, no lags
  and no amounts; **keep** carries the work's own durations and lead times as single numbers (a
  range stays a range only where nothing was picked yet), its lags and its priced amounts. Either way the file is in
  the work's language and carries no person, contact, payment, diary entry or document. It is
  written whole or not at all, and replaces a file only when the save dialog chose it.
- **A template from a file is hostile input.** `.json` only, 1 MiB, UTF-8, read by the host as
  text; parsed and validated by the domain, every unknown field refused and every problem named
  with where it is in the file; includes resolve only against the library; applied in one
  transaction only into a work with no stage that is not approved ("A template starts a plan:
  this work already has one."); a link cycle or an include cycle refused with its chain. A new work
  whose template is refused leaves no folder and no recent row behind.
- **The library test** (`src/domain/templates/library.test.ts`, in `vitest`, so in the gates and
  in CI) validates every library file at the strict level — both languages, a summary, ranges
  with `min < max` and never a single number, no amounts, no text that looks like a web address,
  an e-mail address or a phone number — checks that its id is its file name, and applies it to an
  empty work. A maintainer reviews every template before it merges.
- **Work migration 010** (`010_templates.sql`) adds an activity's range, a decision's lead range and
  the work's `template_id`, `template_version` and `template_title`, and rebuilds `cost_line` so
  that `amount_cents` may be empty, keeping every row, id and amount. A work from F8 is migrated
  when it is opened, without loss, and its diary's chain still verifies.

Not in 1.0, by decision: a work that follows its template when the library changes; prices of any
kind in the library; a template in a third language.

### Added in F10 — the dashboard and reports

The front door composed from every figure the slices made, each carrying its rows; the weekly
report as a PDF in the owner's words; the diary exported as a PDF and as CSV with its chain
verified when it is written; the schedule printed; the work exported as JSON for anybody else's
tool. A CSV never carries a formula, and a second PDF reader parses every report.

- **The dashboard, composed.** _This week on site_, Monday to Sunday, is now figures that open onto
  their rows: the **entries** of the week, the **working days without one** (a day is not missing
  until it is over), **who was on site** and the **people expected** — whoever answers for an
  activity the schedule places in the week, and whoever is on a stage that is running. Beside the
  days the diary marked lost, **weather days lost** counts the days an entry says rain or storm and
  nothing was done. The **last entries** are a figure too — three, with their photos' thumbnails,
  each with a button that opens the diary at that entry. The weekly report prints these same
  figures.
- **Reports**, a new destination after Documents — eleven on the rail, eight needing a work. One
  card per file, each saying in one line what the file holds and what it does not; a path chosen in
  the save dialog (or typed); the file written, its path and pages named; and **Open**, which shows
  it in the system's own viewer. A refusal is a sentence on its card.
- **The weekly report** (ADR-031), for the Monday-to-Sunday week of any day chosen — this week by
  default; a week that has not begun is refused — always in the owner's words. It opens with the
  diary's week: each day and what the diary says of it, and the working days over with nothing
  written — **a week with no entry says so on its first line**, in strong type, and the rest is
  still printed. Then what was worked on and finished, who was on site, the weather days lost,
  readiness and the first three things it lacks, the finish date against the latest baseline and
  the slip, decisions overdue or due in the next 14 calendar days, money planned, committed and paid
  and paid this week, and the stages planned, ready, started, closed and held. Every figure is
  printed with its rows. Decisions, money and stages are as they stand on the day it is written, and
  the page says so.
- **The diary exported** (ADR-032), as a PDF and as CSV. The host verifies the chain first, over the
  rows it is about to write, and writes **nothing** when it does not hold, naming the entry where
  it broke; the card verifies it before offering to write — "12 entries, chain verified just now".
  The PDF opens with the host's own block — "Chain verified on {date}: {N} entries, head {the first
  16 hex digits of the last hash}. This is tamper-evidence: it shows whether the file was changed
  outside Ridgebeam. It is not a signature and not legal proof." — in English or in Portuguese,
  then every entry as it was written, a correction beside what it corrects, with its author,
  weather, what was done and finished, who was present, the note whole and how many photos. The
  CSV is written by the host from the database: one row per entry, thirteen columns ending in each
  entry's hash and the one before, the photos as their hashes, UTF-8 with a byte-order mark, RFC
  4180 quoting, `,` in English and `;` in Portuguese.
- **A CSV never carries a formula.** Every cell whose first character is `=`, `+`, `-`, `@`, a tab
  or a carriage return is written with a `'` before it, in every column.
- **The schedule printed**, on landscape A4: the screen's Gantt, one column per calendar day —
  critical bars filled, the others outlined, the latest baseline a thin bar beneath — then a table
  of every activity with its number, stage, start, finish, duration, float and responsible. The
  whole plan fits the page's width, each day narrower the longer it runs and the day labels thinned
  so none touch; many activities break across pages with the day header repeated.
- **The work as JSON** — `"ridgebeamWork": 1`, the work as `work_get` returns it and every diary
  entry with its hashes, pretty-printed UTF-8; documents are named by their hash and not embedded.
  The format is in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), for anybody else's tool.
- **How a PDF is made.** The interface composes a document from the rows the screen shows, already
  in words; the host lays it out — A4, 20 mm margins, text wrapped by each glyph's real width,
  tables breaking across pages with their header repeated, "Ridgebeam · {title} · page N of M" on
  every page, no author in the metadata — and writes it with `pdf-writer` in the standard
  Helvetica faces, WinAnsi, nothing embedded, their widths from Adobe's published metrics. Three
  characters outside WinAnsi print as stand-ins (→ `->`, ≥ `>=`, ≤ `<=`), and a test composes every
  report in both languages and fails on any character that would print as `?`. `cargo test` reads
  every kind of report back with a second PDF reader, `lopdf`, a development dependency that is
  never shipped.
- **One write path for every file** (`files::save`, now shared with the template export): `.pdf`,
  `.csv` or `.json` by kind, a full path, written whole or not at all, an existing file replaced
  only when the save dialog chose it, nothing over 256 MiB; a document past its caps (5 000 blocks,
  20 000 rows, 2 000 characters in a string) refused with a sentence. **Open** opens only a file a
  report command wrote in this session.
- **New dependencies.** `pdf-writer` 0.15 (MIT OR Apache-2.0) in the binary, bringing one crate
  the binary did not have, `ryu` (Apache-2.0 OR BSL-1.0); `flate2`, already in the tree through
  `png`, is now a direct dependency of the host; and `lopdf` 0.45 (MIT) for tests only. [`NOTICE`](NOTICE) lists them, with the notice of the font
  metrics.
- **The glossary** gains _export_.

No migration: F10 adds no table and no column. Not in 1.0, by decision: photos inside a PDF; a
character outside WinAnsi and the three stand-ins on paper; non-working days shaded on the printed
schedule.

### Added in F11 — backup, restore and polish

The whole work as one file, restored into a new folder and proven byte for byte; a plan started
from a template that asks what it does not yet know, one question at a time; Diagnostics that can
be copied into a bug report; About that lists the licence of every package the product ships; and
the polish owed by F0 to F10.

- **Back up this work** (ADR-033), in a new **This work** section of Settings, shown while a work
  is open. One `.ridgebeam` file, saved where the save dialog says: a plain ZIP that Windows opens
  by itself, holding `manifest.json` first, then `work.sqlite3` — a snapshot taken with
  `VACUUM INTO` while the work stays open, deflated — then every file of `documents/` and
  `thumbnails/`, stored, and last `manifest.sha256`, the manifest's own hash. The manifest lists
  every file with its size and SHA-256, the work's id, name and schema version, and the build that
  wrote it. The answer names the path, the size and how many files it holds; a file in the work
  folder whose name a backup never holds is left out and counted. A backup is never written inside
  the work's own folder, and replaces a file only when the save dialog chose it. The day of the last
  backup is kept per work in the application's database — "Last backed up on this machine on {day}", or not yet — in
  Settings and in Diagnostics. **A backup is not encrypted**, and the product says so.
- **Restore a backup…** on the Start screen. The file, then a folder that is new or empty; a
  preview of what the manifest says — the work, when it was backed up, by which build, how many
  files — before anything is written. The file is treated as hostile: the shape the host writes and
  no other, 4 GiB at most, every name from a closed allow-list and none twice, the manifest's own
  hash first, every size checked against the manifest and capped **while it inflates** (2 GiB the
  database, 25 MiB a document or a thumbnail), every SHA-256 checked, and the database opened
  read-only and found to be this work at a schema this build knows. It is written into a temporary
  folder beside the target, opened there — an older schema migrates forward — and renamed into place
  only when every check has passed; on a refusal a sentence says why and nothing is left. Then the
  work opens, and the Start screen says "Restored: N entries, chain verified, N documents as
  recorded". A work the recent list knew at another folder moves to the restored one, and the
  sentence says the old folder was left as it was.
- **Byte for byte, in `cargo test`.** A full work — stages, activities, links, baselines 1 and 2
  with a replanning, decisions, checks with answers and a photo, a diary with a correction and
  photos, documents with a PDF, cost lines, commitments, payments with a reversal, a template's
  provenance — backed up and restored: the database byte-identical to the snapshot the archive
  holds, every document and thumbnail byte-identical, every table's rows equal (read through `PRAGMA
table_info`, so a column added later cannot be missed), the chain verifying, every document as
  recorded. Windows' own `tar.exe` reads what the host wrote. A hostile corpus of thirty-two
  archives, generated in the test — `..`, a full path, a drive letter, a name not on the list, a
  duplicate, a size that lies, a zip bomb, a wrong hash, a changed manifest, no manifest, another
  product's database, another work's, a newer schema, an archive cut short — is refused, each with a
  sentence and nothing written.
- **The ZIP is written and read by the host itself** (`files::archive`): store and deflate, no
  ZIP64, no encryption, no extra fields. The `zip` crate was measured and not taken; deflate and
  CRC-32 come from `flate2`, already in the binary. **No crate is added.**
- **Next question** (ADR-034, SPEC R3). While a work's plan has open questions, the dashboard's
  first card, in every lens, asks one — in this order: how many working days an activity with a
  range will take ("Most take 1 to 2."), who answers for an activity with nobody responsible, how
  much a cost line not priced yet is, and what was decided about a decision overdue or due within
  14 calendar days. One control answers it, through the same command the breakdown uses; **Skip for
  now** moves on for this session and records nothing, and **Ask the skipped ones again** brings
  them back; the card says "3 of 22 answered". Nothing is asked
  while the plan is approved and locked, nor of a closed stage. The breakdown is unchanged.
- **Diagnostics lists schema, chain and folder health.** Each database's schema version and every
  migration it has been through, by number and name; the diary's chain, verified on demand, with
  the last result; folder health; and the last backup. **Copy the diagnostics** puts the whole of
  it on the clipboard as plain text for a bug report — the chain verified as it is copied — and its
  first lines say that it holds this computer's folders as they are, so the person reads it before
  sending it.
- **About lists the third-party notices**: the text of [`NOTICE`](NOTICE), bundled at build time,
  in a scrollable region, and the licence of every crate compiled into the binary and every npm
  package of the production tree, from `src/features/about/notices.json`. That file is written by
  `scripts/notices.mjs` from `cargo metadata` (offline, normal dependencies of the Windows target,
  no dev or build dependencies) and `package-lock.json` (production dependencies for Windows x64),
  sorted and with no timestamp; its check is a new gate in `npm run gates`, so a dependency changed
  without the list fails CI.
- **Polish owed by F0–F10.** A readiness rule that counts nothing reads "nothing to count yet", in
  a muted tone, and is listed last — never "0 of 0". On the Gates tab each item's photo field sits
  behind **Add a photo**, open when the answer needs one. A closed stage's move buttons follow the
  host's rule exactly. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §10 says why a value refused with
  `plan_approved` goes back to what the plan holds, where every other refusal keeps what was typed;
  §8 gains _the plan asks one question at a time_.
- **Large works, measured.** A benchmark in vitest over a work of 2 000 activities (40 stages, 3 000
  links), 2 000 payments and 3 000 diary entries holds every computation the screens make to a
  budget of five times its first median, scaled by how much slower the machine running it is (a
  fixed sorting workload timed in the same run — release 1.0.0's first CI run showed a budget in
  plain milliseconds is a fact about one machine): the schedule 35 ms (6.3 measured), readiness 40 ms (7.4),
  the weekly report 85 ms (16.4), the money of the work 25 ms (1.3), by stage 260 ms (51.4), by
  trade 25 ms (4.3), paid over committed 225 ms (45.0), the S-curve 135 ms (26.8), the diary report
  25 ms (3.9) and the open questions 30 ms (5.6). Its first run found two computations that grew
  with the square of the work, fixed before the budgets were set: money searched its lists once per
  row (By stage took 657 ms), and the working days to a deadline were walked day by day (the weekly
  report took 279 ms) — now indexed once per snapshot, and counted by whole weeks. The host reads
  the same work in `cargo test` (not ignored: under two seconds): `work_get` in 4.2 ms and the whole
  diary in 12.8 ms in a release build (8.3 ms and 23.4 ms in debug), each held to five times that.
- **The glossary** gains _restore_; _backup_ says it is not encrypted; _baseline_ is taken at
  approval **and at every replanning**; _weekly report_ is a PDF of as many pages as the week needs,
  not one page; _range_ is for durations and lead times — a cost has no range in 1.0.

Migration: the application database gains `003_backups` (the `backup` table, one row per work).
The work's schema does not change.
