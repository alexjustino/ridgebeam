<div align="center">

# Ridgebeam

**A works planner for the engineer, the architect and the person building once — where the
plan is intent, the diary is fact, and the plan says what it does not yet know.**

Stages and activities · Critical path on a working calendar · Decisions with computed deadlines ·
Readiness · Append-only site diary · Check gates · Money · Templates that are plans · Reports ·
Backup and restore · Three lenses, one model · English and Portuguese

No cloud. No account. No telemetry. A work is a folder you own.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4.svg)](#requirements)

</div>

---

> **Status: pre-release — slices F0 to F11, and D1 to D4.** The product was named on 2026-09-24
> ([ADR-001](docs/architecture/ADR.md#adr-001)). Slices F0 to F11 — from the foundation to backup,
> restore and polish — and all four differentiators, D1 to D4, run from source; there is no
> published installer yet: that is F12, the release, whose branch is to be cut again from
> `develop`. The [specification](docs/SPEC.md) says what
> 1.0.0 will be and what "done" means for every slice; [What exists today](#what-exists-today) says
> exactly how far the code has got.

**Differentiators, before first use.** Before using Ridgebeam on a work of his own, its owner
widened 1.0 with four things no other small-works tool does offline
([ADR-036](docs/architecture/ADR.md#adr-036)): **D1, "When will it really finish?"** — the finish as
a probability from each activity's optimistic and pessimistic duration, said as "8 in 10 chances"
([ADR-035](docs/architecture/ADR.md#adr-035)); **D2, "Am I paying ahead of the work?"** — payment
milestones earned only by facts of the work, never by dates, with a warning before a payment that
would put the owner ahead of the work — a warning, not a refusal
([ADR-037](docs/architecture/ADR.md#adr-037)); **D3, the handover book** — one PDF the owner keeps,
with the photos of hidden work taken before it was closed, which a check can require
([ADR-038](docs/architecture/ADR.md#adr-038)); and **D4, the owner's snapshot** — one
self-contained HTML file that opens on any phone, which the person sends themselves; Ridgebeam still
sends nothing ([ADR-039](docs/architecture/ADR.md#adr-039)).
**All four are in.** The release branch is cut again from `develop` now that they are.

## Why

People who build once say they will never build again. Not because the work was hard — the work
was done by people who do it every week — but because nobody had planned it all the way through:
the tile was chosen the day the tiler arrived, the electrician came before the wall was closed
and had to come back, the money ran out in the stage nobody had priced, and the argument about
what was agreed had no record to settle it. The engineer knew how to plan it and did not have a
tool the owner could read. The owner had a tool — a spreadsheet, a notes app, a group chat — that
knew nothing about building.

The incumbents are good and they are for somebody else: contractors' back offices priced per seat,
schedulers that assume you know what a predecessor is, apps that show pictures, diaries that
record the day and stop there. None of them will tell a person, on the first evening, **what
their plan does not yet know**.

Ridgebeam is built around six decisions the others do not make:

- **The plan is intent; the diary is fact.** Nobody types "60 % done" into a stage. Somebody
  writes, in one tap, that today the crew finished the plaster on the north wall — and progress,
  the slip on the critical path, the decision now overdue and the money now due are derived from
  that one true sentence. There is no command that writes progress into the plan.
- **Readiness is a measure, not a feeling.** The share of what the plan must know that it does
  know, as a figure on every screen that opens onto the list of what is missing, in a sentence
  a layperson reads: "3 activities have no duration. 2 decisions are overdue. The roof has no
  responsible."
- **A decision's deadline is computed**, never typed: the earliest start of the first activity
  that needs it, minus its lead time, on the working calendar. It moves when the schedule moves.
- **The plan is never rewritten in silence.** Approving it takes a baseline; editing an approved
  plan asks for a reason and keeps the old one; any two compare. The diary is append-only and
  hash-chained — tamper-evidence, stated plainly, never legal proof.
- **Three lenses, one model.** The engineer's work breakdown and critical path, the architect's
  rooms and finishes, the owner's this-week-what-to-decide-what-to-pay are vocabularies over the
  same rows, with every term's plain sentence in a glossary in English and Portuguese.
- **Templates are plans, not to-do lists** — stages with typical activities, dependencies,
  duration ranges, the decisions each stage needs and the checks it must pass — shipped as data
  in this repository, schema-tested, community-editable.

## The name

A **ridge beam** is the beam at the very top of a pitched roof, where the rafters meet — the
highest piece of a house's frame and the last structural one to go up. It only goes up because
everything under it was planned first. In Brazil it is the _cumeeira_, and the day it goes up
the owner feeds the crew, because from that day the house has its shape. Pronounced RIJ-beem;
in Portuguese, "rídj-bim".

## What exists today

Slices **F0** to **F11**, and the four differentiators, **D1** to **D4** — nothing after them:

- **A work is a folder.** Create one in an empty folder chosen in the system dialog, or open an
  existing one; the recent works are listed, and one whose folder has gone says so and is found
  again from a dialog — only if the folder holds the same work. Everything about a work is one SQLite file inside its folder, checkpointed and
  closed when the work closes.
- **Stages and activities on a working calendar.** A start date, working days, hours per day
  and holidays, all edited on the Plan; a stage with activities, each with a duration in working
  days and a responsible.
- **The plan (F1).** Rooms and areas, the rooms each activity touches, and an optional quantity
  with its unit (12 m² of tile). Stages, activities and rooms reordered by button or by
  keyboard (Alt+Arrow), with the numbering following. People renamed and removed. The same rows
  in three arrangements — the numbered **breakdown** where editing lives, the works **by room**,
  and the owner's **checklist** — with none of them a copy of another.
- **Three lenses, one model (F1).** The engineer's, the architect's and the owner's words for
  the same things — _activity_, _work item_, _job_ — switched from the title bar, in both
  languages, from a vocabulary table in the glossary. The lens is the person's setting; switching
  it stores nothing in the work.
- **The schedule (F2).** Dependencies between activities or whole stages, finish-to-start with
  a lag in working days; a dependency that would close a loop is refused, naming the loop. The
  critical path computed on the working calendar and highlighted on a Gantt — by colour, by a
  mark and in words — with the finish date. Approving the plan takes baseline 1, which is never
  rewritten; from then on the **slip** is a figure that opens onto every activity whose finish
  moved, on the Schedule and on the Dashboard. The engine is a sibling product's, copied and
  extended (ADR-015), and a 2 000-activity benchmark holds it to the budget.
- **Decisions (F3).** A decision belongs to a stage — _which tile_ — with a lead time in working
  days. Its **deadline is computed**, never typed: the stage's earliest start minus the lead time,
  on the working calendar, so it moves when the schedule moves. A decision is due, overdue, made
  or has no deadline yet, said in words; one that is already overdue the day it is added is kept,
  and says so. Decisions are edited in the breakdown and listed, most urgent first, on their own
  destination; the dashboard counts those due within five working days.
- **The diary (F4).** One tap for today — what was worked on and finished, who was there, the
  weather — or the detailed entry: a note, hours, a lost day, deliveries, incidents, visitors
  and photos. Entries are **append-only** and each carries the hash of the one before; an entry
  is never edited, it is **corrected** by a new entry that says what was wrong, and the original
  stays, struck through. Diagnostics verifies the chain — tamper-evidence, not proof. Photos are
  copied into the work folder by hash after being measured (25 MiB, 12 000 px, the real format
  from their first bytes), and shown as thumbnails. **Progress is derived from the diary**, in
  states — not started, started, finished — on the checklist, the Gantt and the dashboard, with a
  share only where quantities were recorded; the dashboard also counts days without an entry and
  weather days lost.
- **Checks (F5).** Every stage has a start gate and a close gate — questions it must answer,
  written in the breakdown — brought by a template, or the usual checks one button away. On the
  Plan's **Gates** tab each is answered _yes_, _no_ or _not applicable_ (which always takes a
  reason), with a photo where it matters — the inspection. A stage **cannot start or close while
  an item is unanswered or answered no**, and the screen names the items holding it. Answers are
  append-only; starting is permanent; a closed stage is read-only until it is reopened, and
  nothing may be made to wait inside it. The dashboard counts stages planned, started and closed,
  and the gates that are held.
- **Money (F6).** Three amounts from three sources: **planned** from cost lines on stages and
  activities, **committed** from the quotes and contracts accepted, **paid** from a payments
  ledger that is **append-only** — a mistake is reversed, never edited. Per stage, per trade and
  for the work, with remaining and variance; every figure opens onto the lines it adds up, and
  money is whole cents from the file to the screen. A payment over what was committed is
  recorded and **flagged**, not refused. Receipts are images or PDFs. An S-curve of planned
  against paid, with its table.
- **People and documents (F7).** People are contacts — trade, phone, e-mail, availability, a note
  and the stages they are expected on — with the days they were on site taken from the diary and
  what they are owed taken from the ledger, on the Plan's **People** tab. **Documents** — quotes,
  drawings, permits, receipts, contracts, photos — are copied into the work folder by hash,
  typed by their bytes (images and PDFs only; a PDF is never opened inside the product), and
  attached to the work, a stage, an activity, a decision, a diary entry, a commitment or a
  payment, from one library. A hostile file corpus is refused in `cargo test`, and Diagnostics
  re-hashes every file and lists any it cannot account for, without deleting them.
- **Replanning and baselines (F8).** An approved plan is **locked until somebody says why**:
  changing a stage, an activity, a duration, a link, the calendar, the start date or a cost line
  is refused until a replanning is opened with a reason, and the Plan says so with a
  **Replan…** button beside the sentence. The diary, answers, payments and every other fact stay
  free. The replanning ends only in the next baseline, which keeps its reason — there is no
  silent way back. Baselines now record the stages and the money too, and **any two compare**:
  the finish moved, the dates moved, durations changed, activities and stages added or removed,
  the money changed and the reasons in between, each count opening onto its rows. A **what-if**
  on the Schedule tries other durations and lags in memory and shows the finish it would give —
  and is never saved; to keep it, replan with a reason. The dashboard says how many times the
  plan was replanned, and whether a replanning is open.
- **Templates and the library (F9).** A new work starts from an empty plan, from one of six
  templates in the library — bathroom renovation, kitchen renovation, roof replacement, electrical
  rewire, masonry house, and an apartment refit that includes the bathroom and the kitchen — or
  from a template file, with a preview that says it is **a starting point with ranges, not a
  quote**. A template is a **plan**: stages in order with their typical activities, the links
  between them, durations as **ranges** of working days, the decisions each stage needs with
  their lead times, the questions each gate asks, the rooms, and cost lines as labels with **no
  prices**. It is applied once, as the work's own — nothing links back, and the Dashboard says
  where the plan came from. A range stays a range until a person types a duration or chooses
  **Use the upper end of each range** (or the lower); a line not priced yet says so and counts as
  nothing. The library is JSON in [`templates/`](templates/), validated and applied to an empty
  work by a test in CI, and reviewed by a maintainer; [`CONTRIBUTING.md`](CONTRIBUTING.md) is the
  procedure. Any work **exports as a template**, its numbers stripped for sharing or kept for the
  next work like it.
- **The dashboard and reports (F10).** The dashboard is the front door, composed from every
  figure the slices made, and now also says **this week on site** — the entries written and the
  working days without one — the **people expected** this week, the **weather days lost**, and the
  **last diary entries** with their photos, each opening the diary at that entry; every figure
  still opens onto its rows. A new destination, **Reports**, writes four files, each to a place
  chosen in the save dialog: the **weekly report**, a PDF in the owner's words — the days written
  and the working days not, what was done and finished, who was on site, readiness and what it
  lacks, the finish against the baseline, the decisions due and the money — where a week with no
  entry says so on its first line; **the diary** as a PDF and as CSV, written only after the host
  has verified the chain, the PDF headed by that verification and by the words that it is
  tamper-evidence, not a signature and not legal proof; **the schedule** on landscape A4, a Gantt
  and its table; and **the work as JSON**, a documented format for anybody else's tool. A CSV never
  carries a formula — a cell that would start one is written with an apostrophe before it. The PDFs
  are written by the host in the standard Helvetica fonts, and a second PDF reader parses every kind
  of report in the tests. **Open** shows a file just written in the system's own viewer.
- **Backup, restore and polish (F11).** **Back up this work**, in Settings, writes the whole work
  as one `.ridgebeam` file — a ZIP Windows opens by itself, holding the database, every document and
  thumbnail, and a manifest with each file's size and SHA-256 and the manifest's own hash. **Restore
  a backup…**, on the Start screen, treats that file as hostile — a closed list of names, every size
  capped while it inflates, every hash checked, the database checked to be this work — and brings it
  back into a **new** folder, never over one; on any refusal nothing is left, and afterwards it says
  "Restored: N entries, chain verified, N documents as recorded". `cargo test` proves the round trip
  byte for byte and table by table, and refuses a corpus of hostile archives. **A backup is not
  encrypted**: keep it as you keep the work folder. A plan started from a template now **asks one
  question at a time** on the dashboard — how long, who, how much, what was decided — through the
  same commands as the breakdown, which stays. Diagnostics lists each database's migrations, the
  chain, folder health and the last backup, and copies it all as text for a bug report; About lists
  the licence of every shipped crate and npm package, generated from the lockfiles and held by a
  gate. And the polish owed: "nothing to count yet" instead of "0 of 0", a photo field behind **Add
  a photo** on the Gates tab, and a benchmark that holds a work of 2 000 activities, 2 000 payments
  and 3 000 diary entries to its budgets.
- **When will it really finish? (D1).** Any activity takes an **optimistic** and a **pessimistic**
  duration beside its duration — and approval does not lock them, because a range is an estimate of
  uncertainty, not the plan. From them, the Schedule runs the plan 2 000 times, seeded so the same
  plan gives the same numbers, and says the finish as a chance, in natural frequencies: "8 in 10
  chances of finishing by 14 November 2026", the chance of the plan's own date and of the
  baseline's, the dates by which half and nine tenths of the runs had finished, and the activities
  whose range moves the finish most — the engineer also sees P80 and the percentages. How often each
  activity was critical is said on its Gantt bar, and can shade the bars. An activity with no range
  is counted as certain, and the page says how many; the method and what it leaves out — activities
  are drawn on their own, so a rainy month that slows everything at once is not in the runs — are on
  the page. The dashboard and the weekly report say the headline. Nothing about it is stored, and
  the plan's own dates never move ([ADR-035](docs/architecture/ADR.md#adr-035)).
- **Am I paying ahead of the work? (D2).** A commitment carries a **payment plan**: milestones, each
  a share of its amount earned only by a fact of the work — an **advance** the day it was agreed,
  the stage started, an activity finished in the diary, the stage closed — never by a date, and
  nothing marks one earned by hand. **Add the usual plan** fills 30 % / 40 % / 30 %, said to be a
  common split, not advice. Each commitment shows what it has earned, what is due now and what was
  paid ahead of the work, each opening onto its rows; the dashboard counts the commitments paid
  ahead and the weekly report says both. The Ledger's payment form shows what a payment would change
  as it is typed and, when it would put the owner ahead of the work, **warns before it is saved** —
  naming the amount and the milestone not yet earned — and still lets it be saved: money paid is a
  fact. A commitment's plan locks at its first payment, so it cannot be rewritten to hide being
  ahead; a renegotiation is a new commitment ([ADR-037](docs/architecture/ADR.md#adr-037)).
- **The handover book (D3).** One PDF the owner keeps when the work ends, written from **Reports**
  in the owner's words: a cover with the work, its dates and the people by trade; then room by room
  — or stage by stage when the work has no rooms — what was done and when, the decisions made with
  their answers, **the photos of hidden work** taken before it was closed, other photos from the
  diary, and the care notes; then the documents by kind — permits, **warranties**, **manuals**,
  contracts, receipts — by name; who did what, with their trade and contact; and one line on the
  diary's chain. The photos are **in the PDF**, scaled and embedded by the host, which finds each
  one by its hash inside the open work only. A gate check can **need a photo**: a _yes_ without one
  is refused, and the library's templates ask for one before a wall or a floor closes over pipes,
  wiring or waterproofing. **Care notes** — "The stopcock is under the sink" — are written on the
  Plan's new **Handover** tab, for the work, a room or a stage, in the person's own words. Before
  writing, the card says **what the book still lacks**, counted with its rows, and writes it anyway
  when asked; a book written before every stage closed says so on its first page
  ([ADR-038](docs/architecture/ADR.md#adr-038)).
- **The owner's snapshot (D4).** One HTML file, written from **Reports** — or from **Owner's
  snapshot…** on the dashboard — that shows the owner the work as it stands, on any phone, in their
  own words: readiness in a sentence, the finish and its chance, **the next two weeks** — what starts
  and what runs, who must be there, what to decide or order and by when, which gates come up, what
  payment falls due — the last five diary entries with their photos, and the money. Every figure
  still opens onto its rows, light and dark follow the reader's phone, and its last line says the
  day it was written and that it does not change when the work does. It has **no script and loads
  nothing from anywhere**: every string escaped, a Content-Security-Policy in the file, and the host
  checking the bytes before it writes them and refusing a file with anything in it that could run or
  load. Photos are always re-encoded, so no metadata travels; no phone number, e-mail address or
  document is in it. **Ridgebeam writes the file; sending it is yours** — by WhatsApp, by e-mail —
  and the product still sends nothing ([ADR-039](docs/architecture/ADR.md#adr-039)).
- **Readiness.** A figure that says how much of what the plan must know it does know, from seven
  rules — every activity has a duration, a responsible, and (in a plan of two or more) a link to
  another; every decision has a deadline and is made in time; every stage has checks at both
  gates and its money planned, with a priced line — that opens onto the rows it
  counts and says in a sentence what is missing, in English and in Portuguese. Rule by rule on
  the dashboard, each with why it matters; the rules add up to the figure.
- **The shell.** Dashboard, Plan, Schedule, Decisions, Diary, Money, Documents, Reports, Settings
  (language, theme, lens, and backing up the open work), Diagnostics and About — eleven destinations
  — in light and dark, in English and Portuguese. There is no command, field or control that sets
  progress.
- **The documents written before the first work:** [`docs/SPEC.md`](docs/SPEC.md), the
  specification; [`SECURITY.md`](SECURITY.md), the threat model;
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), the schema;
  [`docs/GLOSSARY.md`](docs/GLOSSARY.md), every term with its plain sentence in both languages,
  generated from data; [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md), the UI contract;
  [`docs/architecture/ADR.md`](docs/architecture/ADR.md), thirty-nine binding decisions; and
  [`docs/RELEASE.md`](docs/RELEASE.md), the release checklist.
- **The gates**: one script, `npm run gates`, run identically on a developer machine and in CI;
  an end-to-end suite that drives the real binary; and a bundle check that holds the installer
  under 10 MB.

Not yet, and not pretended: **the release** (F12) — its branch cut again from `develop`, an
installer, tried on a clean machine, and a real work planned, run for a week and its weekly report
read by somebody who is not an engineer.

Not in 1.0, by decision rather than by schedule: files other than images and PDFs (no Word,
spreadsheet, CAD, SVG or HEIC); a PDF shown inside the product; more than one currency in a work; a
decision tied to one activity rather than its whole stage; a replanning abandoned without a
baseline; a what-if applied to the plan with one button; a work that follows its template when the
library changes; prices in the library; photos inside a PDF report other than the handover book; a
snapshot that updates itself, or that the product sends; a
character outside the standard PDF fonts' set on paper; non-working days shaded on the printed
schedule; an encrypted backup, an incremental one, a backup the product makes on its own, or a
restore over an existing folder.

## What 1.0 does not do

Said once, plainly, so nobody finds out on site. Ridgebeam 1.0 is one person's planner on one
Windows computer. It has **no accounts, no sync and no network**: a work is shared by copying its
folder or a backup, and two people editing copies get two works; the owner can be sent a snapshot to
read, and nothing comes back from it. It has **no phone, tablet, web,
macOS or Linux** version. It does not read drawings, BIM, IFC or CAD, has **no price database**,
and makes **no quote, invoice or tax** document. It schedules finish-to-start links with lags on a
working calendar — no other link types, no milestones, **no resource levelling** and no earned value
beyond the S-curve. Its diary's chain is **tamper-evidence, not a signature and not legal proof**.
Its backups are **not encrypted**, and it never backs up on its own. It is not an engineer, an
architect or a contractor: a template is a starting point with ranges, not advice about a site. It
has no plugins, no auto-update and no AI. And the installers are not code-signed, so Windows warns
on first run ([ADR-012](docs/architecture/ADR.md#adr-012)).

## Run it from source

You need Windows 11, [Node.js](https://nodejs.org/) 22 or later, and
[Rust](https://www.rust-lang.org/tools/install) stable with the MSVC toolchain.

```bash
npm ci                 # install the exact dependencies in package-lock.json
npm run tauri dev      # run the application with hot reload
npm run gates          # the validation battery: what CI runs on every pull request
npm run e2e            # the end-to-end suite against the debug binary
```

`npm run e2e` builds the debug binary and drives it through WebDriver, so it needs two drivers
the repository does not install: `tauri-driver` (`cargo install tauri-driver --locked`) and
Microsoft Edge WebDriver (`msedgedriver.exe`) matching the WebView2 runtime on the machine,
with its path in `RIDGEBEAM_E2E_EDGEDRIVER` or on `PATH`. The suite works in a temporary data
folder and never touches your own works.

## Roadmap

| Release   | Theme               | Contents                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The plan            | the work, stages and activities, the schedule with critical path and baselines, decisions, readiness, the diary, checks, money, people, documents, replanning, templates and the library, three lenses, the dashboard, reports, print, backup and restore — and the four differentiators: the finish as a probability, payment milestones earned by facts, the handover book, the owner's snapshot |
| 1.1.0     | The site            | the diary from a phone: a companion build of the same app for Android, writing into the same work folder                                                                                                                                                                                                                                                                                           |
| 1.2.0     | The crew            | the work shared between the owner, the engineer and the contractors: file-based sync with conflict rules, a read-only owner view                                                                                                                                                                                                                                                                   |
| 2.0       | Only if it earns it | quantities from drawings · price databases per region · IFC import · resource levelling · the network                                                                                                                                                                                                                                                                                              |

Deliberately not in 1.0.0: accounts, sync, a phone or web app, BIM/IFC/CAD import, bills of
quantities and price databases, invoicing and tax, resource levelling, dependencies other than
finish-to-start, milestones, earned value beyond the S-curve, weather from the network, macOS, Linux, tablets, plugins, auto-update, AI.

## Requirements

Windows 11. The product will ship as an MSI and an NSIS installer under 10 MB, built on Tauri 2
with a thin Rust host, React and TypeScript, and SQLite — the stack of its siblings, deliberately.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first: green gates before anything, one commit per
concern, verified running rather than merely compiling, documentation as part of the delivery,
and the two rules that are never negotiable — the domain layer is pure, and no diary entry is
lost and no baseline overwritten. Both `main` and `develop` are protected; every change arrives
by pull request.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). "Ridgebeam" is a
trademark of Alex Justino; the licence grants rights to the code, not to the name.
