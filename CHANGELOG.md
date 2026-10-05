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

### Added in E2 — will the money last?

The second slice of the second wave (ADR-041), for the second way a small work fails: the money
runs out before the work does. The product already knew what the work will ask for and when — the
cost lines, the commitments, the payment plans and the schedule — and nothing about the money
coming in. The owner now writes down **where the money comes from** — savings on hand, a loan's
tranches, a client's instalments — each expected on a day, and records each sum when it actually
arrives. Ridgebeam projects, **week by week from today to the finish**, what will have to be paid
against what will have come in, and says in one sentence whether the money lasts — _"The money
lasts to the end, with $1,800.00 to spare."_ or _"Money runs short in the week of 16 Nov — $4,200.00
short."_ — with, from D1's ranges, the chance that it runs short (ADR-042).

- **Funding** (`funding`, migration 014). On Money's new **Funding** tab: a fund's label of up to
  200 characters, where it comes from, its amount, the day it is expected and a note, listed in the
  order written. Funding is plan: it is changed at any time — amount and day included, even after
  money was received against it — and an approved plan does not lock it. Only removing is refused
  once money has been received against a fund, with a sentence. Commands `funding_add`,
  `funding_update` and `funding_remove`.
- **Money received** (`funding_receipt`). **Mark as received…** on a fund asks for the amount and
  the day; money that arrived unplanned is recorded against no fund. The receipts are a ledger like
  the payments: numbered in order, never edited or removed, a mistake corrected by a **reversal** of
  the whole receipt, dated on or after it, once and with no note — a receipt is not reversed in
  part. **A receipt's day is never in the future**: money that has not arrived is a fund, not a
  receipt. Commands `funding_receipt_add` and `funding_receipt_reverse`; the work's snapshot carries
  the funds by position and the receipts by number.
- **The projection** (`runway`, in the domain, pure). Calendar weeks, Monday to Sunday, from this
  week to the finish's week — eight weeks past today when the plan has no finish, and never more
  than 260 weeks. It opens with the **money on hand today**, received less paid, both ledgers with
  their reversals. **Out**: each payment-plan milestone not yet earned on the day the schedule
  expects its fact, net of what was paid ahead on its commitment; the rest of a payment plan that
  covers less than its commitment, and the unpaid rest of a commitment with no payment plan, spread
  evenly over the stage's remaining working days; and the money planned and not yet committed on
  each stage, less what was paid on it outside any commitment, spread the same way. Money earned and
  not paid, a milestone past its expected day, a closed stage's money still owed and money the
  schedule cannot date — noted as such — fall in the current week. A line not priced yet adds
  nothing and is counted as such. **In**: what each fund still expects, on its day; a fund expected
  today counts. **Money expected on an earlier day and not received is not counted**, and a note
  says how much: _"1 expected sum has not arrived: $5,000.00 not counted — money that has not come
  is not money."_ Money dated after the last week is listed, not counted. The result is one of four
  states — lasts, short, no funding, nothing to project. `expectedOn` moves from the lookahead into
  `milestones.ts`, so the owner's snapshot and the projection read one answer.
- **Will the money last?** A card on Money with the sentence, the chance, a table of the weeks —
  what came in, what went out, what was left, a short week's closing reading _"$700.00 short"_ and
  never a minus sign — and a small balance chart drawn as the S-curve is. Four figures carry their
  rows: **Money on hand today**, **Money runs short in the week of** (the week's Monday), **Money
  left at the end** and **Money expected and late** (a count). The short sentence carries a
  danger-toned error icon; the money lasting is not shown as a success. Beside the number, in words,
  what the projection left out, and at the end what it is: _"A projection, not a promise: it is as
  good as the schedule, the payment plans and the dates typed here."_ The dashboard's money card
  shows the short week's Monday, or the money left at the end, with the sentence, and does not run
  the chance. The weekly report projects from the day it is written and prints the sentence, with
  the short week's rows or none when the money lasts; the owner's snapshot carries the same
  sentence, rows and chance as the weekly report.
- **The chance, from D1.** `finishProbability` gains an optional per-run hook that changes none of
  D1's results or its seed, and `runwayChance` counts the runs whose balance goes below zero in any
  week up to that run's own finish week: _"3 in 10 chances that the money runs short before the work
  ends."_ About 0.3 s on the 2 000-activity benchmark work. With no range in the plan the card gives
  no chance and says why: _"Every duration is taken as certain, so the weeks below are the only
  answer. Give activities a range to see the chance."_
- **Change orders.** One waiting for a decision is not projected; an approved one is already in the
  plan, and is projected like any planned money.
- **Readiness learns one rule** (`work.funding`). A work whose priced planned money is above zero
  and that has no fund recorded is missing where the money comes from — _"Where the money comes from
  is not written down yet."_ (_"De onde vem o dinheiro ainda não está anotado."_). Money received
  with no fund does not answer it. A work from E1 with priced cost lines reads one row more missing
  until a fund is recorded.
- **Append-only, behind the host.** `funding_receipt` carries the payments' battery — triggers
  refuse `UPDATE`, `DELETE` and `REPLACE`, with `recursive_triggers` on and off, and the module that
  writes it holds no such statement, which a test reads its source to prove — and a reversal that is
  partial, repeated, for another fund or dated before its receipt is refused again by the schema. A
  fund money was received against cannot be removed. **Work migration 014** (`014_funding.sql`) adds
  the two tables and changes no existing row; a work at schema 13 migrates to 14 losing nothing, its
  chain still verifying.
- **Documentation.** ADR-042 (will the money last? Funding as plan, receipts as facts, a weekly
  projection), with its costs: a projection, not a promise — as good as the schedule, the payment
  plans and the dates the owner typed; money that has not arrived is not counted, which can call a
  week short that a late tranche would cover; uncommitted planned money is spread evenly, which a
  real invoice will not be; the chance uses D1's ranges and nothing else; the week is the unit; and
  money in is recorded, not connected to any bank. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md):
  migration 014, both tables, their triggers and the readiness rule. [`SECURITY.md`](SECURITY.md):
  the receipts ledger is append-only like the payments, a receipt's day is never in the future, and
  nothing is sent anywhere — money in is recorded, not connected to any bank.
  [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a projection says what it counts and what it does
  not, in words, beside the number_. [`docs/RELEASE.md`](docs/RELEASE.md): record funds and a
  receipt, read the sentence, make the money run short and then last, see a late fund listed and
  not counted, the chance with ranges, the snapshot's sentence, in Portuguese. The glossary gains
  _funding_ (_recursos_).

### Added in E3 — why is it late?

The third slice of the second wave (ADR-041), for the third way a small work fails: it is late, and
nobody can say on whose account. Until now the product had **no forecast**: the slip compares the
plan with its baseline, so a work weeks behind on site whose plan nobody had touched read as on
time. Ridgebeam now says **when the work will finish as things stand**, read forward from what the
diary says happened — _"As things stand it finishes on 23 Oct — 5 working days after the baseline's
16 Oct."_ — and **why it is late**: every working day of that difference attributed to a cause the
record names and, where it names one, a party, with the days it cannot attribute said in words. A
lost day in the diary can now say why (ADR-043).

- **Why a day was lost** (migration 015). When **No work was possible** is ticked, the diary entry
  form asks **Why?** — Weather, Waiting for a decision, Crew did not come, Material did not arrive,
  Owner's request, No access to the site, Other — and, for a crew, material or anything else,
  **Who**, a person of the plan, optional. The entry reads _"Lost — waiting for a decision"_, with
  the person's name when one is given. A cause on a day not marked lost, a cause outside the seven,
  a person with no cause and a person who is not one of the work are refused with a sentence. A
  cause is changed as everything in the diary is, by a correction. `DiaryEntry` and `EntryDraft`
  gain `lostCause` and `lostPartyPersonId`, `null` when absent.
- **The chain is extended, not rewritten.** The canonical form gains one record, `lost`, after the
  photos, **only when a cause is given**: every entry written before this slice — and every one
  written after it without a cause — has the same canonical string and the same hash, byte for
  byte, and the tag stays `entry.v1`. `cargo test` hashes every entry of a real schema-14 work with
  entries, a correction and photos before and after migrating and finds them equal, the chain
  verifying on both sides; an entry with a cause verifies; and an update of either new column is
  refused by the existing trigger.
- **As things stand** (`forecast`, in the domain, pure). The plan's activities and links on its
  calendar, with its lags, forward from the diary: a finished activity at its diary dates, a started
  one from the day it started and not finishing before today, one not started not before today. It
  gives the forecast finish, its critical chain, and the working days against the latest baseline
  and against the plan's own finish date. On the **Schedule**, an **As things stand** card beside
  the finish and the slip says which is the plan and which is the forecast. The plan's schedule, the
  Gantt and the slip are untouched: the slip is still plan against plan.
- **Why is it late?** (`delayLedger`, in the domain, pure). The working days late as things stand,
  attributed one cause per working day per activity, in a fixed order so nothing is counted twice:
  a **change order** approved after the baseline, by the days its decision froze, on the account of
  who asked; a **cause stated** for a lost day, and the person it names; **weather**; a **decision
  made late** against its deadline in the baseline, capped at the days its stage actually started
  late, on the owner's account; and **absence** — a day with an entry on which the responsible for a
  running critical activity was not on site and nothing was done on it. Days lost count only while
  an activity of the forecast's critical chain was running or due to start. A day with no entry is
  not absence. What is left is **not explained**, and is always shown — _"3 days the record does not
  explain"_. When the work is on or ahead of the baseline the ledger says so and names no cause;
  before approval it says it needs an approved plan. Three figures carry their rows: **days late as
  things stand**, **by cause** and **by party**. A **Why is it late?** card on the dashboard; the
  weekly report prints the forecast's sentence and the ledger, and the owner's snapshot the sentence
  and the leading causes, in the owner's words.
- **Exports.** The diary CSV gains two last columns, `lost_cause` and `lost_party`, so a sheet built
  on the thirteen before them still finds each where it was, with every cell under the same
  neutralisation; the JSON export carries `lostCause` and `lostPartyPersonId` on every entry.
- **Work migration 015** (`015_lost_cause.sql`) adds the two columns with a plain `ADD COLUMN` and
  their `CHECK`s — a cause only on a lost day, a person only with a cause — copies no row and leaves
  the diary's triggers as they were; a work at schema 14 migrates to 15 losing nothing, every hash
  as it was and its chain still verifying.
- **Documentation.** ADR-043 (as things stand: a forecast from the diary, and a ledger of why it is
  late), with its costs: the forecast assumes every unfinished activity takes its planned duration
  from today; one cause per day, by a fixed priority, can under-count a day with two causes; a day
  without an entry is unknown, not absence; a decision's delay is capped at what its stage actually
  lost; the ledger attributes, it does not judge — it is not a claim or legal evidence — and the
  party is who the record names. ADR-016's slip is not amended: it stays plan against plan, and the
  two are shown apart. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): migration 015, both columns and
  the canonical form's conditional record. [`SECURITY.md`](SECURITY.md): the hash of every old entry
  is unchanged byte for byte, the new record is written only when a cause exists, and the ledger
  attributes and does not judge. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _the plan and the
  forecast are never the same number on screen_ and _what the record does not explain is always
  shown_. [`docs/RELEASE.md`](docs/RELEASE.md): say a cause on a lost day, read the forecast against
  the baseline, read the ledger by cause and by party, and verify the diary still reads "chain
  intact" on an upgraded work. The glossary gains _forecast_ (_previsão_).

### Added in E4 — a work that ends well

The fourth and last slice of the second wave (ADR-041), for the last way a small work fails: it ends
badly — the last payment made with defects still open, and with it the only reason anybody had to
come back. What is found wrong or unfinished near the end is now a **snag** (_pendência_): written
down with where it is, who must fix it, the day it is due and a photo, and **closed only with a
photo of it fixed** — or withdrawn with a reason, never deleted. A commitment's payment plan can
hold back its last part as **retention** (_retenção_), earned only when its stage is closed and
every snag on that commitment's person is closed — the retention a layperson never knows to hold.
The handover book lists what is still to fix and prints each fix with its before and after photos.
With E4 the second wave is complete (ADR-044).

- **Snags** (`snag`, migration 016). On the Plan's new **Snags** tab: a title of up to 200
  characters, a description, the stage — required, and allowed after the stage is closed, because
  that is when snags are found — an activity, optionally, who must fix it, a person of the plan or
  nobody yet, the day it is due and a photo of the problem, chosen or dropped. Each is numbered in
  the order raised, from #1, and a number is never reused. The list shows the open ones first, the
  overdue marked. A stage, an activity or a person the work does not have is refused with a
  sentence. Command `snag_raise`.
- **Closing a snag** (`snag_closure`). **Fix…** requires a photo of it fixed and takes a note;
  **Withdraw…** requires the reason. Once only, on a day not before the snag was raised. A fix with
  no photo, a withdrawal with no reason, a closure dated before its snag and a second closure are
  refused with a sentence. A snag found again after its fix is a new snag, which may name the old
  one. Nothing about a snag is ever edited, and there is no delete. Command `snag_close`; the work's
  snapshot carries the snags, each with its closure or none.
- **Photos are documents of the work**, named by their hash as the handover book's are: the photo is
  taken in through the documents' intake first, and the host refuses a hash that names no image
  document of the open work.
- **Retention** (the payment milestone trigger `retention`). A milestone that names no activity and
  is earned on the day the last snag of its stage on the commitment's person is closed — fixed or
  withdrawn — or on the day the stage closes, if that is later; with no snag on that person, when
  the stage closes. Never while one is open: a stage reopened, or a snag raised on that person after
  it was earned, un-earns it. A snag on nobody, and a commitment with no person, hold nothing. The
  payment plan's editor offers **Hold back as retention** as the last part, suggested at 5 % and
  said to be a common practice, not advice. On Money it reads _held until …_ with the snags that
  hold it, never as due; the projection places it on the stage's expected close while nothing holds
  it and, while something does, lists it apart as money held rather than projecting it into a week.
  Paying it early is paying ahead of the work, which the Ledger's warning already says — a warning,
  not a refusal.
- **The snag list** (`snagRows`, `snagFigures`, in the domain, pure): open, fixed or withdrawn;
  overdue by its due day; how long each has waited; and the figures **open**, **overdue**, **by
  person** and **by stage**, each with its rows. Readiness gains no rule. The dashboard's **Still to
  fix** card shows open, overdue and by person, and is not shown while the work has never had a
  snag; the weekly report and the owner's snapshot say what is still open and on whom, in the
  owner's words.
- **The handover book.** Each open snag is a gap of its own, **Still to fix**, counted on the
  Reports card and listed first on the book's first page; writing is still allowed. Each fixed snag
  is printed in its room's section, or its stage's, with both photos — before and after — half
  width, side by side.
- **Insert-only, behind the host.** `snag` and `snag_closure` carry the change orders' battery —
  triggers refuse `UPDATE`, `DELETE` and `REPLACE`, with `recursive_triggers` on and off, and the
  module that writes them holds no such statement, which a test reads its source to prove — and a
  fixed closure without a photo or a withdrawal without a reason is refused again by a `CHECK`.
  **Work migration 016** (`016_snags.sql`) adds the two tables and rebuilds `payment_milestone` to
  take the trigger `retention`, keeping every row with its id and creating D2's index and triggers
  again as they were, so a paid commitment's plan stays locked; a work at schema 15 migrates to 16
  losing nothing, its chain still verifying.
- **Documentation.** ADR-044 (a work that ends well: snags closed with a photo, and retention held
  until they are), with its costs: a snag closed with a photo is closed by the record, not inspected
  — the photo's honesty is the person's; retention holds money only in the plan's arithmetic — the
  product holds no money and cannot stop a payment, it warns; 5 % is a common practice offered as a
  suggestion, not advice; a snag is never deleted, a mistake is withdrawn with a reason; a snag on
  nobody holds no retention. It amends ADR-037 with the trigger `retention` and ADR-038 with the
  snags' gaps and before-and-after photos, and their Status lines point to it.
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): migration 016, both tables, and the rebuild of
  `payment_milestone` and what it kept. [`SECURITY.md`](SECURITY.md): snags and their closures are
  insert-only, their photos are documents named by hash inside the work, and the product holds no
  money and cannot stop a payment. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _a snag is closed
  with a photo or withdrawn with a reason, never deleted_ and _held money is shown as held, never as
  due_. [`docs/RELEASE.md`](docs/RELEASE.md): raise snags with photos, fix one with a photo, try to
  fix one without, withdraw one with a reason, watch a retention held and then earned, and read the
  handover book's gaps and its before-and-after photos, in Portuguese. The glossary gains _snag_
  (_pendência_) and _retention_ (_retenção_).

### Changed in H0 — before the acceptance test

- **A day is typed in the product's language.** Every date field is the new `DateField`: Portuguese
  shows and reads `DD/MM/AAAA`, English shows the product's own short day, `Feb 10, 2026`, with the
  month as a word; typing is forgiving (any separator or none, the month as a word, the stored form),
  a year is four digits and never guessed, and a month grid opens beside the field and is driven by
  the keyboard. The stored value is still `YYYY-MM-DD`. Before, the system's own date control drew the
  day in the order of the machine's locale — `10/02/2026` month-first on an English Windows, read by a
  Brazilian as the 10th of February. A snag's due day typed only halfway is now refused rather than
  saved as no due day.
- **The unit tests run within the machine's memory.** On a machine short of memory, Windows fails
  file lookups with "no system resources", and every resolver on the way reads that as a missing file:
  a test file failed to load with "Cannot find module" for a file that was there. Vitest now runs one
  worker per 2 GB of memory, never more than its own default; nine runs under the load that failed
  before passed.
- **The new screens were looked at in the light theme**, in Portuguese: change orders, the money
  projection, why it is late, snags and the diary's "same people".

### Added in G1 — the weekly site meeting

The first slice of a third wave, admitted before the owner's acceptance test at his own request —
all of the next list, and a surprise (ADR-045). The second wave gave each way a small work fails a
record; G1 turns them into a weekly ritual. **This week's meeting** (_Reunião da semana_) opens
with its agenda already written from the record — the actions still open from the last meeting,
the decisions overdue or due within 14 days, the change orders waiting, the snags open, the payments
falling due and the money held, why the work is late, what starts in the next two weeks and who
must be there, the gates coming up. What the meeting decides is done right there, through the
product's own commands, and goes to the record at once. Closing the meeting writes its **minutes**
(_ata_) — who was there, each item with what was said and done, and the **actions** raised
(_encaminhamentos_): what, who, by when — once, and never edited. The next meeting starts from the
actions still open.

- **The agenda** (`meetingAgenda`, in the domain, pure). Built every time from what the product
  already computes — `decisionsDueWithin`, `changeOrderRows`, `snagRows`, `runway`, `delayLedger`
  and the lookahead — never a second way, in one fixed order: actions open, oldest first, the
  overdue marked; decisions, overdue first; change orders waiting, with how long; snags open,
  overdue first; money falling due and money held; why it is late, as one item, only while it is;
  the next two weeks; gates coming up. A section with nothing in it is left out, an agenda with
  nothing on it says so, and what is new since the last meeting is marked.
- **The meeting** — a full page opened from the dashboard's new **This week's meeting** card, which
  shows the last meeting's day and the actions still open, on whom. Tick who was there — a person of
  the plan or somebody named — write what was said on each item, and do what the item asks with the
  product's own dialogs: **Make the decision…**, **Approve…** or **Decline…** a change order,
  **Fix…** or **Withdraw…** a snag, **Raise a snag…**. Each runs the same command as on its own
  screen, with the same refusals, and is in the record the moment it is done; the item then says
  what was done, in words. Add actions — what, who, by when. Until the meeting is closed nothing of
  it is written, and leaving the page with a draft asks first.
- **The minutes** (`meeting`, `meeting_attendee`, `meeting_item`, `meeting_action`, migration 017).
  **Close the meeting** writes, in one transaction or not at all, the meeting with its number — #1,
  #2, … — and its day, never after today nor before the last meeting's; who was there; each item
  as the agenda said it, frozen, with what was said and what was done; the actions raised; and the
  earlier actions closed at it. Commands `meeting_close` and, for an action closed between meetings,
  `meeting_action_close`; the work's snapshot carries the meetings, each with its attendees, items
  and actions, and each action with its closure or none.
- **Actions** (`meeting_action_closure`). An action is closed once, as **done** or **dropped**, with
  an optional note — at a later meeting, on its day, or between meetings — and never before the
  meeting that raised it. It is never edited and never deleted: one written wrongly is dropped and
  raised again.
- **The minutes as a PDF.** A new kind of report, written by the same renderer as the weekly report
  and in the owner's words: the meeting's number and day, who was there, each item with what was
  said and done, the actions raised — who, by when — and the actions closed, ending with what the
  minutes are: a record, not a signature. **Reports** lists the meetings and writes any one's
  minutes to a path chosen in the save dialog. The owner's snapshot gains the last meeting: its day
  and the actions still open, on whom.
- **Insert-only, behind the host.** The five tables carry the snags' battery — triggers refuse
  `UPDATE`, `DELETE` and `REPLACE`, with `recursive_triggers` on and off, and the module that writes
  them holds no such statement, which a test reads its source to prove — and a meeting **seals** its
  minutes: it says how many attendees, items and actions it holds, and nothing is taken past that
  count, so nothing can be added after the close. **Work migration 017** (`017_meetings.sql`) adds
  the five tables and nothing else; a work at schema 16 migrates to 17 losing nothing, its chain
  still verifying.
- **Documentation.** ADR-045 (the weekly site meeting: an agenda from the record, minutes that are
  never edited), which also admits the third wave — H0 and G1 to G6 — with its costs: the minutes
  are never edited, a mistake is said in the next meeting's; the agenda is the record's, and what
  nobody wrote down is not on it; an action is a promise on record, not an obligation the product
  enforces; who attended is what the person ticked; the minutes are not a signature; an open
  meeting is lost if the product closes; what was done in a meeting is done even if the meeting is
  never closed. [`docs/SPEC.md`](docs/SPEC.md) gains the third wave's addendum.
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): migration 017, the five tables and the seal.
  [`SECURITY.md`](SECURITY.md): the minutes and the actions are insert-only, and everything a
  meeting does to the record goes through the product's own commands — nothing bypasses them.
  [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _an agenda is built from the record, and says when
  it is empty_ and _minutes are written once, at the close_. [`docs/RELEASE.md`](docs/RELEASE.md):
  hold a meeting — the agenda, the attendees, a decision made in it, a change approved in it, an
  action; close it; the next meeting carries the action; the minutes as a PDF, in Portuguese. The
  glossary gains _meeting minutes_ (_ata_) and _action_ (_encaminhamento_).

### Added in G2 — what to order this week

The second slice of the third wave (ADR-046). The most ordinary delay on a small work is nobody's
decision: the worktop measured once the cabinets are in, a supplier who takes three weeks, and the
tiler waiting. The materials an activity needs that take time to arrive are now written down with
**how long the supplier takes** — the **lead time** (_prazo de entrega_), in calendar days — and
Ridgebeam works out the day to **order by** (_encomendar até_) from when that activity starts **as
things stand**: the forecast's date, which moves when the work slips or gets ahead, not the plan's.
The Dashboard says what to order this week, what is late to order and what is late to arrive;
ordering and delivery are facts on record. Ridgebeam orders nothing: it says when.

- **Purchases** (`purchase`, migration 018). On the Plan's new **Purchases** tab (_Compras_): what
  to buy, the stage it is for and, optionally, the activity that needs it — with none, the stage's
  first — how much, in the person's words, the supplier and the lead time, from 0 to 365 calendar
  days. A purchase is plan: edited freely, not locked by the plan's approval, and removed only while
  nothing has happened to it. Commands `purchase_add`, `purchase_update` and `purchase_remove`; the
  work's snapshot carries the purchases in their order, each with its events, and so do the JSON
  export and every backup.
- **What happened to it** (`purchase_event`). **Mark as ordered…**, **Mark as delivered…** and **The
  order fell through…**, each on a day that has happened and with a note; an order that fell through
  puts the purchase back to order. The events keep one order — ordered first, or after an order that
  fell through; delivered or fell through only on an open order; nothing after a delivery; never
  dated before the event before — which the host refuses with a sentence and the schema refuses
  again. Command `purchase_event_add`.
- **The day to order by** (`purchaseRows`, in the domain, pure). Each purchase's state from its
  events — to order, ordered, delivered; the day it is needed, from the forecast's start of its
  activity, or the schedule's where the forecast has none; the day to order by, that day less the
  lead time; once ordered, the day it is expected. Flagged in words and with an icon: **late to
  order**, **to order this week** — Monday to Sunday, the late ones included — **late to arrive**,
  and **arrives after it is needed**. What is done is not flagged. Each row says what its day was
  computed from: the start as things stand and the lead time.
- **On the Dashboard, in the meeting and in the reports.** A **To order this week** card — to order
  this week, late to order, late to arrive, each a figure that opens onto its rows — not shown while
  the work has no purchase. The next two weeks list what is to order in them; the meeting's agenda
  gains a **Purchases** section between the snags and the money; the weekly report and the owner's
  snapshot say the same, in the owner's words. Readiness learns no rule: a purchase late to order is
  a fact of the work's execution, not something the plan does not know.
- **Insert-only, behind the host.** `purchase_event` carries the money received's battery — triggers
  refuse `UPDATE`, `DELETE` and `REPLACE`, with `recursive_triggers` on and off, and the module that
  writes the events holds no such statement, which a test reads its source to prove. A purchase
  something has happened to cannot be removed, nor its stage. **Work migration 018**
  (`018_purchases.sql`) adds the two tables and nothing else; a work at schema 17 migrates to 18
  losing nothing, its chain still verifying.
- **Documentation.** ADR-046 (what to order this week: lead times against the forecast, orders and
  deliveries as facts), with why the forecast and not the plan's dates, why readiness learns no
  rule, and its costs: the day to order by is as good as the lead time typed and the forecast; lead
  times are calendar days, and a supplier's working week is not modelled; the product orders nothing
  and sends nothing; ordered and delivered are what the person records; a purchase is not money — no
  price, no stock, no arithmetic on its quantity. ADR-039 and ADR-045 are amended: the next two
  weeks gain the purchases to order, and the agenda a section.
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): migration 018 and the two tables.
  [`SECURITY.md`](SECURITY.md): the events are insert-only, and the product orders nothing and sends
  nothing. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _an order-by day is shown with what it is
  computed from_. [`docs/RELEASE.md`](docs/RELEASE.md): add purchases with lead times, see what is
  late to order and what to order this week, mark ordered and delivered, an order that falls
  through, the agenda's Purchases, in Portuguese. The glossary gains _order by_ (_encomendar até_),
  and _lead time_ says how a decision and a purchase each count it.

### Added in G3 — the work teaches the next

The third slice of the third wave (ADR-047). Every work ends knowing something its plan did not —
the cabinets that were to take three days took five — and the product held both halves without
putting them side by side. The Schedule now shows **planned against actual** for every activity the
diary says started: how many working days it was planned to take, how many it **took** or has taken
**so far**, the difference, and whether it fell inside the range it was given. And a work exports as
a template **learned from this work**: each finished activity's duration becomes a range that holds
what was planned and what it actually took, saved to **My templates** (_Meus modelos_), the person's
own library, which the next work offers beside the library. Its ranges are what D1's probability is
drawn from, so the next work's chance of finishing by a date is the person's own.

- **Planned and actual** (`activityActuals`, in the domain, pure). For each activity, from the
  diary's progress and the work's calendar: what it was planned to take and the range it was given;
  its state, the day it started and the day it finished; once finished, the **actual duration**
  (_duração real_) — the working days from the first day the diary says it was worked on to the day
  it was said finished, both included, waiting and lost days among them; while it runs, the working
  days so far, today counted when it is a working day; the difference; whether it fell inside its
  range; and whether a started activity is already overrunning. Figures with their rows:
  **finished**, **took longer than planned** — most days over first — **took less** and **outside
  the range it was given**, with the sum of the days over. A work with no calendar or start date
  says why it has no days, and invents none.
- **On the Schedule.** A **Planned and actual** card after the forecast: the figures, each opening
  onto its rows, and a row for every activity that started, saying it in words and with its unit —
  _"Planned 3 working days · took 5 — 2 more"_, _"so far 4 — already 1 more than planned"_, _"inside
  the range it was given (2 to 6)"_. While nothing has started, the card says that the diary is what
  tells it.
- **Learned from this work.** **Export as a template…** gains a third choice beside strip and keep:
  everything as kept, except a finished activity's duration, which becomes the **hull** of the
  template's range it carried, the planned duration and what it took — from the lowest to the
  highest, a point when they all agree. A learned range never narrows: one work is one sample. An
  activity that did not finish is exported as kept. The template's summary says what it learned, in
  the work's language — _"Durations learned from {work}: {n} of {m} activities finished."_ An export
  learned, validated and applied puts the range on the new work's activity, which a test holds.
- **My templates.** The dialog asks **Where**: **My templates** — first for a learned export — or
  **A file**, as before. My templates is the folder `templates/` in the application data folder; the
  id is proposed from the title, replacing one asks first, and the dialog says where it went. A new
  work's template picker lists them under **Your templates**, after the library; one that does not
  validate is listed, disabled, with its reason. **Remove from my templates…** asks in the danger
  tone, because it deletes the file, and the picker says where the folder is. Commands
  `my_templates_list`, `my_template_save`, `my_template_remove` and `my_templates_folder`.
- **The host builds the path.** None of the four commands takes a path from the interface: an id,
  kebab-case and at most 31 characters, the names Windows keeps for its devices refused, is turned
  into `<data folder>/templates/<id>.json` by the host itself. Only regular files directly in the
  folder are read — a directory or a link named like a template is never followed — each at most
  1 MiB and UTF-8, at most 200 listed and the rest counted; a save is whole or nothing and replaces
  only when asked to; a remove deletes that one file. In debug builds the folder moves with the
  application data folder, so the end-to-end suite never touches the person's.
- **No migration.** G3 adds no table to a work and none to the application: the work's schema stays
  at 18. What each activity took is computed every time from the diary, and My templates are files.
- **Documentation.** ADR-047 (the work teaches the next: planned against actual, and templates
  learned from it), with why the person's own numbers, why a hull that never narrows, why a folder
  whose paths the host builds, and its costs: one work is one sample, not a statistic; a learned
  range widens and never narrows, so an unusually slow job stays in it until somebody edits the
  file; the actual duration is elapsed working days, not effort, and a gap between two stretches of
  work is counted; it is only as true as the diary, and an activity never said finished never
  teaches; My templates is a folder on this computer, not synced or shared by the product; removing
  one deletes the file; lead times are kept as planned, not learned. ADR-030 is amended: a third
  choice and a second place to write. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): no migration, and
  My templates as application data, outside every work and every backup.
  [`SECURITY.md`](SECURITY.md): My templates are reached by id, never by path, and read as data.
  [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §8 gains _planned and actual are two numbers, side by side,
  with the difference in words and its unit_ and _a template learned from a work says what it
  learned, and where it goes_. [`docs/RELEASE.md`](docs/RELEASE.md): planned against actual on the
  Schedule, a learned export to My templates, a new work started from it, and a template removed, in
  Portuguese. The glossary gains _actual duration_ (_duração real_) and _my templates_ (_meus
  modelos_).
