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
  budget of five times its first median: the schedule 35 ms (6.3 measured), readiness 40 ms (7.4),
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

### Added in D1 — when will it really finish

The first of four differentiators the product's owner added to 1.0 before its first use
(ADR-036): the plan's finish date is one number, and a site is not. From the optimistic and
pessimistic durations a person gives, the finish is also a probability, said in natural frequencies
— "8 in 10 chances of finishing by 14 November 2026" — seeded so that the same plan gives the same
numbers, and never changing the plan's own dates (ADR-035).

- **A range on any activity.** The breakdown gains **Optimistic** and **Pessimistic** working days
  beside every activity's duration, not only on one a template brought. `activity_update` takes
  `durationMinDays` and `durationMaxDays` together or not at all — both `null` clears the range —
  each a whole number of working days from 1 to 3 650, the optimistic not above the pessimistic.
  One end alone, a fraction, 0, a value past 3 650 and an upside-down range are refused, each with a
  sentence; the row says "Give both ends, or clear both." while one end waits for the other. **A
  change that would leave the duration outside the range is refused**, with a sentence naming the
  range: the person widens the range, or sends both together; nothing widens or clears a range on
  its own. A duration an activity already held outside its range from before D1 is not refused
  when its name or its responsible changes.
- **A range is not locked by approval.** A baseline records an activity's name and duration, never
  its range, so an approved plan with no replanning open still takes a new range, while a new
  duration is refused with `plan_approved` as before. An activity of a closed stage takes no change,
  a range included. There is no migration: the columns are F9's.
- **The simulation** (`src/domain/schedule/probability.ts`, pure). Each activity with a range is a
  triangular distribution from its optimistic to its pessimistic end, peaking at its duration, or at
  the middle of the range when it has none yet — inside the simulation only; nothing is written.
  A duration outside its range, which only a plan from before D1 can hold, widens the range to take
  it in, in the simulation only. An activity with a duration and no range, or a range of one number,
  is **certain**, the same in every run; nothing adds a range the person did not give. With neither,
  it is left out, and counted. Lags are certain; a drawn duration is rounded to the nearest whole
  working day, a half up, never below one. The diary is respected: a finished activity is certain
  at the working days it really took, an activity of a closed stage at its duration, and a started
  one is drawn only from what is left of its range. The schedule's network — the same edges in the
  same order, now extracted from the critical-path engine as `network()` and shared by both — is
  passed forward and back once per run.
- **Seeded.** `mulberry32`, seeded by an FNV-1a hash of the start date, the working days, the
  holidays, every activity's model and every link with its lag: the same plan gives the same
  numbers after a restart and on another machine, and any change to those gives new ones. There is
  no "run again".
- **2 000 runs**, or fewer on a plan of more than 10 000 activities and links together — as many as
  fit in 40 million activity-and-link passes, rounded down to a hundred, never fewer than 200, and
  said on the page. The large-work benchmark gains the simulation: 2 000 activities, 400 of them
  ranged, 3 000 links, all 2 000 runs in a median of 116 ms, held to 580 ms.
- **What it says.** The P50, P80 and P90 dates — the first days by which half, eight tenths and
  nine tenths of the runs had finished; the chance of the plan's own finish date and of the latest
  baseline's; the chance of finishing by any date; each activity's criticality index, the share of
  runs in which it had no float; and up to five **drivers**, the ranged activities whose drawn
  duration moves the finish most by Spearman's rank correlation, named only above 0.1 and above
  three standard errors of no correlation at all. Nothing is simulated, and a sentence says why,
  when the calendar or the start date cannot be counted on, the links make a loop, or no activity
  has a duration or a range.
- **Natural frequencies, floored.** A chance is said as "N in 10", whole tenths **floored** — 0.79
  is "7 in 10" — so the words never promise more than the runs showed; "10 in 10" only when every
  run finished by then, "fewer than 1 in 10" below a tenth, "almost no chance" when none did. The
  engineer's lens adds "(P80)" and the share of the runs in percent, floored the same way.
- **A chance is a figure with its rows.** The figure contract gains the unit `chance` — `hits` of
  `runs`, the value exactly their share — whose rows are what it depends on, each with its role: the
  drivers with their rank correlation, and the activities counted as certain. The criticality
  figure's rows are every activity with its index. `traceable` holds both.
- **When will it really finish?** A card on the Schedule, after the finish and the baseline: the
  headline, a figure that opens onto its rows; the P50 and P90 sentences; the plan's date and the
  baseline's with their chances; a chart of the chance of having finished by each day, with the
  plan's date and the headline's marked and a table of weekly rows as its reading; the drivers, each
  with its range and how often it was critical; how many activities were counted as certain and how
  many were left out; and a method line — the runs, the seed, fewer runs on a large plan, and that
  each activity is drawn on its own, so a rainy month that slows everything at once is not in the
  runs. With no range anywhere, the card shows the plan's date and says that every activity is
  counted as certain, and how to give a range. It writes nothing.
- **Criticality on the Gantt.** **Shade each bar by how often it is critical**: each bar shaded by
  its criticality index, the share beside its name, and its accessible name ending "critical in N of
  10 runs".
- **On the dashboard**, the finish card gains one line with the headline, from the same seeded
  simulation, so the two pages agree; it is not shown while every activity is certain.
- **In the weekly report**, one figure, _When will it really finish?_, with the headline and the
  drivers, in the owner's words.
- **An optional last question.** Once every other question is answered or skipped, **Next question**
  asks of an activity on the critical path with a duration and no range: "What is the most Tiling could take, in working days? The plan says 4.". It is marked optional and is not in the "N of M answered" count; the answer sets the
  range from the duration to that number, so the activity can only run late in the runs — no
  optimism is invented.
- **Documentation.** ADR-035 (the finish is also a probability) and ADR-036 (the owner widened 1.0
  before first use), with their costs — the triangle is a choice, a range is a guess, activities are
  drawn independently, runs are capped on a huge plan; a dated addendum in the specification;
  [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a probability is said as N in 10, in words_ and
  the optional question; [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) says the range columns are
  editable on every activity and not locked by approval; the glossary's _range_ now covers the
  optimistic and the pessimistic duration on any activity.

No migration: neither database's schema changes.

### Added in D2 — am I paying ahead of the work

The second of the four differentiators (ADR-036). The mistake an owner makes most often on a small
work is not paying too much but paying too soon — three quarters of a job paid while a fifth of it
is done — and nothing in F6 said so while paid stayed under committed. A commitment now carries a
**payment plan**: milestones, each a share of its amount earned only by a fact of the work, never by
a date. The product says what is earned, what is due and what was paid ahead of the work, and warns
**before** a payment that would put the owner ahead — and still lets it be saved (ADR-037).

- **Milestones** (`payment_milestone`, migration 011). A label of up to 120 characters, a share of
  the commitment's amount in basis points — whole hundredths of a percent, 1 to 10 000, so "30 %" is
  3 000 and a share may carry one decimal — and the fact that earns it, in an order the person sets.
  The shares of one commitment add up to at most 100 %, and the rest is said on the screen as not in
  the plan yet, never assumed. Commands `milestone_add`, `milestone_update`, `milestone_move`,
  `milestone_remove` and `milestones_usual`.
- **Earned by facts.** Four triggers, a closed list: an **advance**, earned the day the commitment
  was agreed, before any work — and the screen says so plainly; **the stage started**, its start
  gate passed; **an activity finished**, by an effective diary entry, corrections applied — an
  activity of the commitment's own stage; and **the stage closed**, its close gate passed, which a
  reopened stage un-earns. A milestone is earned on the day of its fact, and says since when.
  Nothing marks one earned by hand.
- **Four figures, each with its rows.** Per commitment: **earned** (the milestones reached, each
  with its fact and day), **paid** (reversals applied), **due now** (earned minus paid, when
  positive) and **ahead of the work** (paid minus earned, when positive); per stage and for the
  work, the sums, with a row per commitment — due and ahead are never netted across commitments,
  since one paid ahead does not pay what another has earned. A fact dated after today is not a fact
  yet. A milestone's amount is its share of the commitment's cents rounded half up, and a plan of
  exactly 100 % puts the rounding remainder on its last milestone, so it adds up to the commitment
  to the cent. A commitment with no plan is not evaluated — counted and listed as having none, never
  assumed earned or not, and a payment on it is not warned about — and payments on no commitment are
  outside the question, with a line that says how many. All of it is in `src/domain/milestones.ts`,
  pure.
- **The warning comes before the payment.** The Ledger's form shows, under its fields and as the
  amount is typed on a commitment, what it has earned so far, what has been paid and what would be
  paid after this payment, and whether that leaves money due or paid ahead. When the payment would
  put the owner ahead of the work, a caution titled _Ahead of the work_ says so with the amount and
  the next milestone not yet earned — "This payment puts you R$ 500,00 ahead of the work on Tiler's
  quote: earned so far R$ 300,00 — Tiles laid (40 %) is not earned yet: Lay the tiles is not
  finished yet." — and "You can still record it: whether to pay is yours to decide." **Record the
  payment stays enabled**: money paid is a fact, and the decision is the person's. A reversal is
  never warned about, and a payment on a commitment with no plan is not either: the form says
  whether it is ahead cannot be said.
- **Locked once money has moved.** From the first payment that names a commitment — a reversal
  included — its milestones cannot be added, changed, moved or removed: the plan is shown as it is,
  with the sentence that says why and no control that would change it; the host refuses with a
  sentence, and triggers in the schema refuse it again. A renegotiation is a new commitment. A
  closed stage does not refuse a milestone, and an approved plan's lock does not cover one: a
  payment plan is an agreement, not something a baseline records.
- **The usual plan.** On a commitment with none, **Add the usual plan** fills 30 % when the stage
  starts, 40 % when its last activity is finished and 30 % when it closes, labelled in the person's
  language and editable — said to be a common split, not advice. The middle milestone names the
  stage's last activity, so the usual plan is refused, with a sentence, on a stage with no activity
  yet — and on a commitment that already has a plan.
- **An activity a milestone is earned by is not removed.** The host refuses, with a sentence, to
  remove an activity a milestone names — change or remove the milestone first — and the schema
  refuses it after. Once the commitment is paid, the milestone is locked, so that activity can never
  be removed.
- **Where it shows.** Money → By stage: each commitment's **Payment plan**, open by default when it
  has none, with its milestones, their state — "earned on 3 Oct" or "not yet" — and the share in the
  plan; the commitment's earned and due figures; and marks in words: "R$ 500,00 ahead of the work",
  "R$ 300,00 earned and not paid". The dashboard's money card counts the commitments paid ahead and
  sums what is earned and not paid, each opening onto its rows — a commitment with its excess and
  the milestone it waits for — and says under them, in words, how many commitments have no payment
  plan and how many payments name no commitment. The weekly report gains _Paid ahead of the work_
  and _Earned and not paid_, as of the day it is written. And the **Next question**, last and
  optional, asks "How is Tiler's quote to be paid?" of a commitment with no plan and no payment on
  it yet, and answers by opening its plan — not inline.
- **Work migration 011** (`011_payment_milestones.sql`) adds `payment_milestone` with its `CHECK`s
  and its triggers — an activity of the commitment's stage, at most 100 % per commitment, locked
  once a payment names the commitment — and changes no existing row: every commitment starts with no
  payment plan, so no earlier figure moves. A work from D1 is migrated when it is opened, without
  loss, and its diary's chain still verifies.
- **Readiness does not change**: a commitment with no payment plan is not something the plan lacks.
- **Documentation.** ADR-037 (a payment plan is earned by facts, and paying ahead is warned, not
  refused), with its costs — a fact recorded late is a milestone earned late, an advance is money
  before work and is said so rather than forbidden, a renegotiation after the first payment is a new
  commitment, payments on no commitment are not evaluated;
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) gains `payment_milestone` and migration 011;
  [`SECURITY.md`](SECURITY.md), the lock after payment and why;
  [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a warning comes before the act it warns about_
  and how a payment plan reads; the glossary gains _milestone_ (_marco de pagamento_) and _advance_
  (_sinal_).

### Added in D3 — the handover book

The third of the four differentiators (ADR-036). At the end of a work the owner keeps one PDF for
the decades after it: room by room what was done and when, every decision with its answer, **the
photos of the work hidden behind walls and floors, taken before it was closed**, the documents by
name, who did what with their trade and contact, and the care notes — in the owner's words, in
English or Portuguese. A gate check can now require its photo, and the book says what it still
lacks before it is written (ADR-038).

- **The handover book**, a fifth card on **Reports**, in the owner's words whatever lens is on. Its
  first page says _Written while the work was in progress_ while any stage is open, then the place,
  the start, the day the last stage closed or that the work is in progress, the template it started
  from, what the book holds and what it does not, what it still lacks with its rows, and the people
  by trade. Then one section per room, in room order — or per stage when the work has no rooms, and
  a last section, _Elsewhere in the work_, for what touches no room — with the activities finished
  and the day the diary says they finished, the decisions made with their answer and day, **the
  photos of hidden work**, every one, full width, captioned with the check, its stage and the day it
  was answered; the diary's other photos of the section's activities, two to a row, at most six per
  section, the latest per activity first, with how many more are in the work's folder; and the care
  notes. Then the documents by kind — permits, warranties, manuals, contracts, receipts — by title,
  file name, day and what each is attached to; **who did what** — everyone in the plan with their
  trade, phone and e-mail, the stages the diary saw them on and their days on site; the care notes
  for the whole work, and any whose room or stage is gone; and **the record**: how many entries the
  diary holds, from which day to which, and that its chain is verified whenever the diary is written
  out as a PDF — the book claims no verification of its own. The selection is pure
  (`src/domain/reports/handover.ts`, with `handoverGaps`); the composer is
  `src/features/reports/compose/handover.ts`.
- **Photos in a PDF.** The report model gains an **image** block — a hash, a caption, `full` or
  `half` width, two half-width images side by side — and a report kind, `handover`. The host
  (`src-tauri/src/report/images.rs`) accepts an image **only by a 64-hex-digit hash that a
  `document` row of the open work names**, and only an image: a path-shaped value is refused before
  any file is looked for, an image block naming a PDF or a hash the work does not hold is refused,
  not skipped, and a PDF document is listed by name, never embedded. It reads the original from the
  work's `documents/` under the documents' caps, checks that its bytes still hash to its name,
  decodes it under the `image` crate's limits, turns it the way the camera said, lays transparency
  on white, scales it to at most 1 600 pixels on the long edge and embeds it as JPEG at quality 82;
  a JPEG already within those bounds — 8 bits, grey or colour, not turned, at most 4 MiB — is
  embedded byte for byte. At most **400 images and 150 MiB of image data** per document, each
  distinct photo counted once; past 400 the book leaves the later photos out and says how many, and
  a book past 150 MiB is refused with a sentence. The second reader checks the embedded images in
  `cargo test`.
- **Hidden work needs its photo.** A gate check can **need a photo** (`check_needs_photo`, on the
  Gates tab, while the stage is not closed). A _yes_ on it without a photo is refused — _"This check
  needs a photo of the work before it is closed."_ — by the host and again by the schema
  (`checks: needs a photo`); _no_, and _not applicable_ with its reason, are not. A check that needs
  a photo shows its photo field open. The usual checks gain one at the close gate, _The pipes and
  wiring were photographed before the walls were closed_, added needing its photo.
- **The library asks for the photo where work is hidden.** The template format gains an optional
  `"photo": true` on a check — validated as a boolean, applied as the check's flag, kept by a
  work's export as a template — and five templates gain or convert one close-gate check that needs
  a photo, each raised to version 2: the bathroom's pipes and wiring and its waterproofing, the
  kitchen's pipes, gas line and wiring, the rewire's conduit runs, the apartment's wiring in the
  walls and above the ceilings, and the masonry house's foundations, slab, pipes and conduits, and
  wet-area waterproofing. The roof is unchanged.
- **Warranties and manuals.** Two more kinds of document, `warranty` and `manual`, offered on
  **Documents** and listed by the book under their own headings.
- **Care notes** — "Reseal the shower grout once a year", "The stopcock is under the sink" — on the
  work, a room or a stage, up to 1 000 characters each, in an order the person sets
  (`care_note_add`, `care_note_update`, `care_note_move`, `care_note_remove`). They are not the
  plan: no approval locks them and a closed stage does not refuse them. A room or a stage removed
  takes its notes with it, in the same transaction.
- **What the book still lacks.** The card shows a counted figure of the book's gaps, opening onto
  its rows — checks that need a photo answered without one, checks that need a photo not answered,
  stages not closed, rooms with no photo, no warranty or manual at all, no care note — and **writes
  the book anyway** when asked: an owner may want it halfway through. A book written while any stage
  is open says so on its first page.
- **The Plan's Handover tab**: the care notes of the work, of each room and of each stage, written,
  changed, moved and removed in place; and every check that needs a photo, with its state and its
  photo, linking to the Gates tab.
- **Work migration 012** (`012_handover.sql`) adds `stage_check.needs_photo` (0 for every check
  already in a file) with the trigger that refuses a _yes_ without a photo on such a check;
  rebuilds `document` to take the two new kinds, setting its links aside first and restoring them,
  so every document keeps its id and every link its target; and adds `care_note`. A work from D2 is
  migrated when it is opened, without loss, and its diary's chain still verifies.
- **Documentation.** ADR-038 (the handover book, and photos of hidden work required where it
  matters), with its costs — photos make a large PDF; a photo required for a _yes_ can be taken
  after the wall is closed and the product cannot tell; care notes are the person's words, not
  advice; a book written mid-work says so; [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) gains
  `needs_photo`, the two kinds, the rebuild of `document` and `care_note`;
  [`SECURITY.md`](SECURITY.md), an image in a report resolved by hash inside the open work only, and
  its caps; [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a book says what it still lacks before
  it is printed_; [`CONTRIBUTING.md`](CONTRIBUTING.md), the template check's `photo` flag; the
  glossary gains _handover book_ (_manual de entrega_) and _care note_ (_cuidado de manutenção_).

### Added in D4 — the owner's snapshot

The last of the four differentiators (ADR-036). The owner asks how the work is going from wherever
they are; Ridgebeam now writes the answer as **one HTML file, with no script and nothing loaded from
anywhere**, that opens in any phone's browser and shows the work as it stands — readiness, the
finish and its chance, the next two weeks, the last diary entries with their photos, and the money —
with every figure still opening onto its rows. Ridgebeam writes the file; **sending it is the
person's act**, by WhatsApp, by e-mail or any other way. The product still sends nothing (ADR-039).

- **The owner's snapshot**, a sixth card on **Reports**, in the owner's words whatever lens is on and
  in the language on screen. It says in one line what the file holds and that sending it is the
  person's, writes it to the `.html` path chosen in the save dialog, names the path and the size, and
  **Open** shows it in the system's browser. The dashboard's header gains **Owner's snapshot…**,
  which goes to the card with the focus on its path.
- **What it holds.** Titled _Owner's snapshot_, with the work's name and the day. **Today** — the
  place, readiness as a figure with the dashboard's sentence, the finish date and the chance of
  finishing by it, or the sentence that every activity is counted as certain; **The next two
  weeks**; **Lately on site** — the last five diary entries, corrections applied, newest first, each
  with its note, what was done, who was there and at most two photos captioned with the day and the
  file name; and **Money** — planned, committed and paid with their lines, the commitments paid
  ahead of the work and what is earned and not paid now. Its last line says the day it was written
  and that it does not change when the work does. **No phone number, no e-mail address, no Windows
  account and no document** is in it: contacts belong in the handover book.
- **The next two weeks** (`src/domain/reports/lookahead.ts`, pure). The 14 calendar days from
  today, today included, on the schedule as of today — a closed stage and an activity the diary says
  is finished are left out. The activities starting in the window and those running through it,
  with their responsible and stage; the people expected, by the dashboard's rule for the week; the
  open decisions overdue or due in the window, with their lead time and the day to order by; the
  gates coming up — the start gate of a stage whose first activity starts in the window and the
  close gate of one whose last activity finishes in it, with the items that hold each; and the
  payments — milestones whose fact the schedule expects in the window, less what was already paid
  ahead on their commitment, and what is earned and not paid now. Each is a figure with its rows,
  days in the owner's words — _Monday 5 Oct_ — and a small Gantt of the window when anything is
  placed; with nothing placed, the page says there is no schedule rather than a quiet fortnight. The
  composer is `src/features/reports/compose/snapshot.ts`.
- **A second renderer for the same report model.** The report model gains the kind `snapshot`, and
  the host renders it to HTML (`src-tauri/src/report/html.rs`, `report_html_write`) where it renders
  the others to PDF: headings and paragraphs with their tones; a figure as `<details>` and
  `<summary>` with its rows under it, which needs no script; a table that scrolls sideways on a
  phone; the Gantt as inline SVG, each bar with a `<title>`; photos as `data:image/jpeg` URLs. The
  style is inline — one readable column, the system's fonts, large tap targets, print styles — and
  **light and dark follow the reader's phone**.
- **Nothing in it can run or load.** Every string is escaped, in text and in attributes — the five
  markup characters and also `/ : = @ (` and the backtick. The file carries its `lang`, a
  `no-referrer` policy and a Content-Security-Policy `<meta>`:
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'`. Before the bytes are written the
  host checks them (`report::html::verify`) and **refuses the write**, as a bug in the product,
  unless the policy is there once before what it governs, every `src` is a base64
  `data:image/jpeg` address, nothing else holds `<script`, an `on…=` attribute, `javascript:`,
  `vbscript:`, `http:`, `https:`, `//`, `<iframe`, `<object`, `<embed`, `<link`, `<base`, `<form`,
  `@import`, `url(`, `expression(`, another `data:` or `<!--`, and the page is made only of its own
  elements and attributes. `cargo test` puts hostile strings into every field of every block and
  injects each forbidden pattern into a rendered page.
- **Photos are always re-encoded.** Resolved by hash inside the open work, as the handover book's,
  then decoded and written again as JPEG at most 1 024 pixels on the long edge, quality 78 — never
  passed through — so no metadata reaches the file. At most **60 photos placed, 8 MiB of image data as
  placed, and 12 MiB in all**; a snapshot past a cap is refused with a sentence and nothing is
  written.
- **Documentation.** ADR-039 (the owner's snapshot), with its costs — it is stale the moment the work
  changes, and says so; photos make it a few megabytes; it holds the work's state, which the person
  chooses to share; it is not the 1.2 "crew" sync; a phone's browser decides how it looks within the
  style it is given; [`SECURITY.md`](SECURITY.md), the snapshot's policy, its escaping, the verifier
  and its exact rules, photos always re-encoded, no contact and no document in it, and nothing sent
  by the product; [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a file meant to be sent carries
  nothing that runs and nothing the reader did not need_; [`docs/RELEASE.md`](docs/RELEASE.md), the
  snapshot opened on a real phone; the glossary gains _owner's snapshot_ (_retrato da obra_).

### Changed — the dependencies brought up to date

- **Desktop host.** Tauri 2.12 (`tauri-build` 2.7, the log plugin 2.10 on both sides, `@tauri-apps/api`
  and the CLI 2.12); **the crate now needs Rust 1.90**, which those three declare. `rusqlite` 0.40,
  so the bundled SQLite moves from 3.46.0 to 3.53.2 — the forward-only migrations from every older
  schema pass on it. `windows` 0.62, the version Tauri already uses, so the tree holds one copy;
  reading the account's display name follows its new signature. `thiserror` 2.0.21.
- **Interface tooling.** Vite 8 with `@vitejs/plugin-react` 6, which requires it; Vitest 5 with
  `@vitest/coverage-v8` 5, which requires it exactly; `@types/node` 26.6.3. The Vite configuration
  uses `import.meta.dirname` and references Vitest's config types. The built page is the same within
  a percent.
- **Workflows.** `actions/upload-artifact` 7 and `softprops/action-gh-release` 3, both on the Node 24
  runtime.

### Added in U1 — before the first real work

The owner runs his acceptance test on a real work next. U1 takes away the friction a first real
week meets: photos already sitting in Explorer, the same crew ticked one by one every evening, and a
backup nobody is reminded of. Nothing new reaches the host, and the product still never backs up on
its own (ADR-040).

- **Drop files on the window.** Files dragged from Explorer are taken in exactly as if they had been
  chosen in the dialog, through the same intake and refused with the same sentences. A drop takes
  only what that screen's dialog would offer — photos on the Diary, photos and PDFs on Documents —
  and every other name, a folder's included, is left out and named in one sentence: _"Week 1 was
  left out: it is a folder, or not a kind of file taken here."_ A folder whose name ends like a
  photo's reaches the host, which refuses it by name. On the **Diary** the photos join the entry
  being written — **More…** opens if it was closed — and are copied into the work when the entry is
  saved. On **Documents** the files are added at once, with the kind the form has selected, attached
  to what the page is filtered on (the work when it is not), and refusals in the page's list of
  files not kept. Anywhere else, with no work open, or before the diary's form is on the screen, a
  sentence says _"Drop photos on the Diary, or files on Documents."_ and nothing happens; it stays
  as an information bar at the top of the content, announced and closable, until the next screen or
  the next drag. While files are over the window, one overlay (`drop-hint`) says what will happen on
  this screen, in its own polite live region; it is gone when the files leave or land, and does not
  move under reduced motion.
- **Same people as last time.** The diary entry offers **Same people as {day}**, which ticks the
  people present in the latest effective entry that names anybody — corrections applied — adding to
  what is ticked and never unticking. People since removed from the plan are skipped, and the form
  says how many; if all of them are gone it ticks nobody and says so. Each press is announced. It is
  not offered when no entry names anybody, when the plan has no people, or while a correction is
  written. The rule is pure, in the domain (`lastPresence`).
- **A reminder to back up.** The dashboard says, in a muted line under its header and never in red,
  _"This work has never been backed up on this machine."_ when it holds a diary entry or an
  activity, or _"The last backup was {days} days ago, and the work has changed since."_ when the
  last backup is more than 7 days old and the work has changed after it. **Back up now…** (_Fazer a
  cópia de segurança agora…_) goes to **Settings → This work** with the focus on the backup's file
  field, where the existing backup is written; after a backup the line is gone. **Not now** hides it
  for that work until the product is next started, as a skipped question is. The rule is pure, in
  the domain (`backupDue`), from the day of the last backup this machine wrote; nothing new is
  stored. The product still never backs up on its own.
- **The owner's snapshot follows the product's own rules.** Under **The next two weeks**, a gate
  with no checks is no longer listed or counted among the gates coming up, and the decisions are
  chosen by the same rule as the decisions screen and the weekly report — overdue, or due within the
  next 14 days, day 14 included — from the same function (`decisionsDueWithin`).
- **Documentation.** ADR-040, with its costs — a drop on the wrong screen does nothing and says so;
  the reminder can be ignored, knows only the backups this machine wrote, and the product still
  never backs up on its own; "same people" can tick somebody who was not there, and the person still
  answers for the entry; the snapshot's decisions follow the same 14-day rule as the rest, one day
  past the rest of its window. ADR-033 and ADR-039 point to it where it amends them.
  [`SECURITY.md`](SECURITY.md): a dropped path goes through the same intake as a chosen one, and
  nothing new reaches the host. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a drop zone is the
  window, and it says what a drop will do_. [`docs/RELEASE.md`](docs/RELEASE.md): files dropped from
  Explorer on the Diary and on Documents, "same people", and the reminder on a work never backed up.

### Added in E1 — change orders

The first slice of a second wave, admitted before the owner's acceptance test: four answers to the
four ways a small work fails (ADR-041). The first is the work that grows by small changes nobody
priced. After the plan is approved, **nothing changes without a price and a date**: a change order
is a request on record — who asked, what changes, what it costs, and what it does to the finish,
**computed by the schedule before anybody decides**. It is approved, declined or withdrawn once,
and the decision freezes its impact. An approval opens the replanning with the change already in
the plan and its price as a cost line, and the next baseline is still the person's to take. A
standing tally says how much the work has grown, and who asked for it.

- **Change orders** (`change_order`, migration 013). Raised from the Plan's new **Changes** tab once
  the plan is approved — before that there are no change orders, because the plan is still being
  written, and the form says so. Each has a number, #1, #2, … never reused; a title of up to 200
  characters and an optional description; **who asked** — the owner, a person of the plan, or
  somebody else by name; the stage it lands on; a **price** that may be negative, since a change can
  save money, or left empty, which is _not priced_ and not 0; and its **effects** — **add** an
  activity to the stage, with its name, its working days and the activity it follows; change an
  activity's **duration**; **remove** an activity. At most 50; none at all is a change that is only
  money. The host validates them when the change is raised — the kinds and ranges, a new duration
  inside the activity's range, no activity in a closed stage, none named twice, none a payment
  milestone is earned by removed — and never computes a schedule. Commands `change_order_raise` and
  `change_order_decide`.
- **The impact before the decision.** As the change is written, the form shows what it does —
  _"Finishes 3 working days later — on 14 Nov instead of 11 Nov; costs $1,200.00 more."_ — worked
  out by the same engine and the same delta as the Schedule's **What if**, from the effects applied
  to a copy of the plan in memory (`withEffects`, `changeImpact`). An activity added off the
  critical path moves the finish by no day, and the sentence says so. The dialogs that approve,
  decline or withdraw show it again, with an optional note.
- **One decision, frozen** (`change_order_decision`). Approved, declined or withdrawn, once, on a
  day; the finish before and after and the working days between them are kept as the schedule said
  them that day, with the price. A second decision, a decision on a change the work does not have,
  and an approval before the plan is approved are refused with a sentence.
- **An approval writes the change into the plan, inside a replanning, all or nothing.** With no
  replanning open it opens one with the reason _"Change order #N — {title}"_; with one open, the
  change joins it. The effects go through the plan's own functions, with their own refusals — one
  refused and nothing is written — and a change priced at 0 or more adds a cost line _"Change order
  #N"_ on its stage; a saving adds none, since a planned amount is never negative, and the plan's
  own lines are lowered by hand in the same replanning. The screen says that the replanning is open
  with the change applied and that the next baseline is the person's to take, and offers to go to
  the Schedule. A decline or a withdrawal writes the decision and nothing else.
- **The tally, each figure with its rows** (`changeTally`). **Changes approved** (money), **Days
  added by changes** (working days) and **Waiting for a decision**, each row saying how long that
  change has waited — on a new **Changes** card on the dashboard, not shown before approval; in the
  weekly report, the changes decided that week and those waiting; and in the owner's snapshot, what
  waits for the owner's decision, with the tally. A comparison of two baselines lists the change
  orders decided between them (`Comparison.changes`).
- **Readiness learns one rule.** A change order waiting more than 7 calendar days for a decision is
  something the plan does not know — in the owner's words, _a change is waiting for your decision_.
- **Insert-only.** Neither table can be edited or emptied: triggers refuse `UPDATE`, `DELETE` and
  `REPLACE`, with `recursive_triggers` on and off, and the module that writes them holds no such
  statement, which a test reads its source to prove. A mistake is withdrawn and raised again, and
  the record keeps both. A work at schema 12 migrates to 13 losing nothing, its chain still
  verifying.
- **Documentation.** ADR-041, which admits the second wave — E1 change orders, E2 funding and the
  cash runway, E3 the delay ledger, E4 the snag list and retention — and records E1, with its costs:
  a change order is immutable, and a mistake is withdrawn and raised again; the impact frozen at the
  decision is that day's schedule, and the plan may move later for other reasons; an approval writes
  into the plan inside a replanning the person still has to close; "who asked" is a record, not a
  signature; the price is planned money, not an agreement, and a saving is not written into the
  plan; three kinds of effect are not every change. [`docs/SPEC.md`](docs/SPEC.md) gains the
  addendum that admits E1 to E4. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): migration 013, both
  tables, their triggers and the effects JSON. [`SECURITY.md`](SECURITY.md): the effects are data
  validated by the host — kinds, ranges, ids — no SQL comes from the interface, and both tables are
  insert-only. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _an impact is shown before a
  decision, always_. [`docs/RELEASE.md`](docs/RELEASE.md): raise a change, see its impact, approve
  it into the replanning, take the baseline, decline another, and read the tally on the dashboard
  and in the snapshot. The glossary gains _change order_ (_aditivo_).
