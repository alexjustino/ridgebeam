# Ridgebeam — product specification, v1.0.0

The single source of what the product is and what "done" means for it. Architecture rationale
lives in [`architecture/ADR.md`](architecture/ADR.md), the schema in
[`DATA_MODEL.md`](DATA_MODEL.md), the UI contract in [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md),
the threat model in [`../SECURITY.md`](../SECURITY.md), the vocabulary — every term with its plain
sentence, in English and Portuguese — in [`GLOSSARY.md`](GLOSSARY.md).

**This repository is public**, Apache-2.0, and it is built for three people at once: the
engineer who needs a critical path, the architect who thinks in rooms and finishes, and the
person who is about to renovate a bathroom and has been told that a build is something you do
once and never again. The product exists to make that sentence false.

## 0. The name — Ridgebeam

**Ridgebeam** — the beam at the very top of a pitched roof, where the rafters meet: the highest
piece of a house's frame and the last structural one to go up. From Middle English _rigge_ (a
back, a crest) and _beam_. Pronounced RIJ-beem in English and "rídj-bim" in Portuguese — the
"dg" of _bridge_, then _beam_. In Brazil the piece is the **cumeeira**, and the day it goes up
has a name of its own: the owner feeds the crew, because from that day the house has its shape.

**The sentence a layperson is told.** "It is the beam at the top of the roof. When it goes up
the house has its shape — and it only goes up because everything under it was planned first."

**Why this name.** The product exists to get every build to that day. The beam is a thing of
the trade that an engineer, an architect and a first-time owner all recognise; it is said on a
site and in a kitchen ("put it in Ridgebeam"); it is two syllables in both languages; and it
does not sound like an enterprise suite, a contractor's back office or a spreadsheet.

**How it was chosen.** Decided by Alex on 2026-09-24, before this repository existed, from three
finalists the squad brought with collision evidence — **Ridgebeam**, **Firstbrick** and
**Ridgepole** — after the specification's own starting references (Plumbline, Topout,
Groundwork, Sitebook, Plinth, Underpin, Lintel) and twenty more had been run through the same
battery: GitHub repositories and handles, npm, crates.io, PyPI and RubyGems, the Microsoft
Store, the `.app`/`.dev`/`.com`/`.io` domains, USPTO and INPI (cross-checked on TMview), and a
plain web search for the name with "construction" and "app". Ridgebeam was the only finalist
clean in every register: no trademark containing the word in the United States or Brazil, every
package name free, `.app`/`.dev`/`.io` free, no software product anywhere with the name. The
full evidence, what fell and why, and what could not be verified are recorded in
[`architecture/ADR.md`](architecture/ADR.md), ADR-001.

**Cost accepted.** Two small residential contractors in California trade under the word, one of
them holding `ridgebeam.com` since 2011; one US mark reads "RIDGE BEAM" for floor mats. None is
software and none is in Brazil. The name is always written as one word, capitalised: Ridgebeam.

## 1. Thesis

People who build once say they will never build again. Not because the work was hard — the work
was done by people who do it every week — but because **nobody had planned it all the way
through**: the tile was chosen the day the tiler arrived, the electrician came before the wall
was closed and had to come back, the money ran out in the stage nobody had priced, and the
argument about what was agreed had no record to settle it. The engineer knew how to plan it and
did not have a tool the owner could read. The owner had a tool — a spreadsheet, a notes app, a
group chat — that knew nothing about building.

The incumbents are good and they are for somebody else. **Procore**, **Buildertrend** and
**Fieldwire** are contractors' back offices: per-seat, cloud, priced for a company, shaped around
billing. **Primavera** and **Project** are schedulers that assume the person already knows what
a predecessor is. **Houzz** shows pictures. The Brazilian site-diary apps record the day and stop
there. None of them will tell a person, on the first evening, **what their plan does not yet
know** — and that is the whole difference between a build you dread and a build you finish.

> A **work** is a set of **stages**, each a set of **activities** with durations, dependencies and
> a person responsible; the **decisions** each stage needs, each with the last day it can still be
> made; the **checks** that must be true before a stage starts and before it closes; the **money**
> each stage is planned, committed and paid; and the **diary** that records, day by day, what
> actually happened. Ridgebeam holds all of that in one model, shows it to the engineer, the architect
> and the owner in their own words, measures **how ready the plan is** as a number that every
> screen can see, and never lets the plan be rewritten in silence — local, open, free, and
> readable by the person paying for the work.

The move the incumbents do not make: **the plan is intent and the diary is fact, and the two are
never confused.** Nobody types "60 % done" into a stage. Somebody writes, in one tap, that today
the crew finished the plaster on the north wall — and the plan's progress, the slip on the
critical path, the decision that is now overdue and the money that is now due are all derived
from that one true sentence. The product asks questions instead of offering a blank Gantt chart;
**being different is what makes it easy.**

## 2. Scope

### In 1.0.0

1. **The work** — one project is one work: a name, a place, a start, a currency, a working
   calendar (working days, holidays, hours), a set of **rooms or areas** (the architect's and
   owner's map of the work), and the people on it. A work is a folder on disk holding its
   database, its photos and its documents, self-contained and movable.
2. **Stages and activities** — a stage (_Demolition_, _Rough-in_, _Plaster_, _Tiling_ …) holds
   activities; an activity has a duration, a responsible, the rooms it touches, and optional
   quantities and units (m² of tile, m of pipe). Stages and activities order themselves into a
   work breakdown the engineer recognises and a checklist the owner recognises — the same rows.
3. **The schedule** — dependencies between activities and stages (finish-to-start, with lag),
   the working calendar applied, **critical path** computed, a Gantt with the path highlighted,
   and a **baseline** kept from the day the plan is approved. When reality slips, the consequence
   is shown on every dependent stage and on the finish date, in days, before anybody asks.
4. **Decisions** — a decision is a first-class object: _which tile_, _where the outlets go_,
   _which contractor for the roof_. It belongs to the stage that needs it and carries a **lead
   time** (how long between deciding and having); its **deadline is computed** — the stage's
   earliest start minus the lead time — never typed. A stage whose decisions are not made is
   shown as not ready, and the dashboard says which decisions are due this week.
5. **Readiness** — the number the product is built around. A plan is ready to the extent that it
   knows what it must know: every activity has a duration and a responsible; every stage has its
   decisions made or scheduled, its checks defined, its money planned; every dependency that
   matters is declared. Readiness is computed from the rows, shown as a figure that opens onto
   the list of **what the plan does not yet know**, and explained in plain language: "3
   activities have no duration. 2 decisions are overdue. The roof stage has no responsible."
6. **The diary** — one entry per day per work, written in one tap or in detail: what was done
   (which activities, how much), who was on site, the weather, deliveries, incidents, visitors,
   hours, and **photos**, each stamped with the day. Entries are **append-only** and chained: a
   correction is a new entry that says so. Progress on the plan is **derived from the diary**,
   never typed into the plan.
7. **Checks** — each stage has two checklists: _before it starts_ (the wall is closed; the
   waterproofing was tested; the material is on site) and _before it closes_ (the inspection
   passed; the photos were taken; the owner walked it). A stage cannot be closed with an
   unanswered item; an item can be answered _not applicable_ with a reason. Checklists come from
   the template and are edited per work.
8. **Money** — each stage and activity has a **planned** cost; a quote or contract makes it
   **committed**; a payment makes it **paid**. Payments are a ledger (date, to whom, amount,
   what for, receipt attached). The figures — planned, committed, paid, remaining, variance — are
   per stage, per trade and for the work, and each opens onto the rows it counts.
9. **People** — trades and contacts (the tiler, the electrician, the architect, the inspector):
   name, trade, phone, which stages, availability; who was on site comes from the diary. No
   accounts, no logins: a person is a row, not a user.
10. **Documents** — files attached to the work, a stage, a decision, an entry or a payment:
    photos, quotes, drawings, permits, receipts. Files are **copied into the work's folder**,
    never linked to somewhere that may move; images get thumbnails; a file's hash is kept.
11. **Replanning** — the plan changes; the change is not silent. Editing an approved plan asks for
    a **reason** and keeps the previous baseline; any two baselines compare (dates moved, stages
    added or removed, money changed), and the reasons are listed between them.
12. **Templates** — a template is a **plan**, not a list of tasks: stages with their typical
    activities, dependencies, duration **ranges**, decisions with lead times, checks and cost
    lines, from which a work is started and then made its own. The product ships a library
    (bathroom renovation, kitchen renovation, apartment refit, masonry house, roof replacement,
    electrical rewire …) that is **data in the repository**, community-editable and
    schema-tested; any work exports as a template with its numbers stripped or kept.
13. **Three lenses, one model** — the same work shown as the engineer's (work breakdown, critical
    path, S-curve, quantities), the architect's (rooms, finishes, specifications, decisions) and
    the owner's (this week, what to decide, what to pay, what is done). A lens is a vocabulary
    and an arrangement; nothing is stored per lens, and every term has its plain sentence in the
    glossary, in **English and Portuguese from F0**.
14. **The dashboard** — the informative screen the brief asked for, and the product's front door:
    readiness and what it lacks; today and this week on site; the finish date against the
    baseline and the slip in days; decisions due; stages ready, running, blocked, closed; money
    planned, committed, paid; weather days lost; the last diary entries with their photos; the
    people expected. Every figure carries its rows and opens onto them.
15. **Reports, print and export** — the weekly report (PDF) for the owner in the owner's words;
    the **diary export** (PDF and CSV) with its chain verified, for the record; the schedule
    printed; the whole work backed up as one file and restored; a work exported as JSON for
    anybody else's tool.

### Deliberately not in 1.0.0

Accounts, sync and sharing between people · a phone app or web app · BIM, IFC and CAD import ·
bills of quantities and price databases · invoicing and tax · resource levelling · earned-value
management beyond the S-curve · weather from the network · macOS, Linux, tablets · plugins ·
auto-update · AI.

> **Nothing enters 1.0.0 without something leaving it.** The plan, its readiness, the schedule,
> the decisions, the diary and the dashboard are the product; everything else waits for a
> release that earns it.

### The release train

| Release   | Theme               | Contents                                                                                                                                                          |
| --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The plan            | the list above                                                                                                                                                    |
| 1.1.0     | The site            | the diary from a phone: a companion build of the same Tauri app for Android, writing entries and photos into the same work folder over the file system or a share |
| 1.2.0     | The crew            | the work shared between the owner, the engineer and the contractors: file-based sync with conflict rules, a read-only owner view, the weekly report sent          |
| 2.0       | Only if it earns it | quantities from drawings · price databases per region · IFC import · resource levelling · the network                                                             |

## 3. Architecture

```
src-tauri/  (Rust — only what needs the operating system, or must not trust the webview)
  db/        migrations · the work's database (WAL, FTS5) · the DIARY (append-only: entries,
             photos, corrections — insert-only, triggers refuse update and delete, each entry
             carries the hash of the previous) · baselines (insert-only) · payments ledger
  files/     the work folder: copy-in of documents and photos, thumbnails, hashes, caps
  export/    backup (one file, restore round-trips) · JSON export · CSV with formula-injection
             neutralised · the PDF reports (rendered from the same domain rows the screen shows)
  commands/  #[tauri::command] — the typed boundary; the plan has no command that sets progress
src/  (TypeScript)
  data/      command client + TanStack Query — the only layer that knows @tauri-apps
  domain/    the plan (stages, activities, rooms, quantities) · the schedule (calendar, dependencies,
             critical path, slip, baselines and their comparison) · decisions and their computed
             deadlines · READINESS (what the plan does not know, as rows and as a figure) · the
             diary (entries, the chain, progress derived) · checks (start and close gates) · money
             (planned/committed/paid and every figure) · templates (a plan, not tasks) · the
             lenses (vocabulary projection) · reports — PURE
  i18n/      strings as data, English and Portuguese, the glossary with plain sentences
  ui/        design system: the siblings' tokens and canonical primitives
  features/  one directory per module (dashboard, plan, schedule, decisions, diary, checks,
             money, people, documents, templates, reports, settings, diagnostics, about)
  app/       composition, routes, shortcuts, window lifecycle
```

**The boundary rule** (ADR-003 lineage): `src/domain/` never imports `data/`, `ui/`, `features/`,
`react` or `@tauri-apps/*`, and performs no I/O. Enforced by ESLint and by an architecture test.

**The plan is intent; the diary is fact** (ADR-PROPOSED): progress, actual dates, people on site
and weather days are **derived** from diary entries. There is no command that writes progress
into a stage; the fastest way to mark something done is a one-tap entry that says it was. A
figure on the plan is always traceable to the entries that produced it.

**Readiness is a measure, not a feeling** (ADR-PROPOSED): readiness is the share of things the
plan must know that it does know, computed from the rows with an explicit rule per kind
(duration, responsible, decision, check, cost, dependency), shown as a figure that carries its
rows (ADR-024 lineage: a figure carries its rows). The rule is data in the domain and is the
first thing a template, a lens or a screen must never contradict.

**A decision's deadline is computed** (ADR-PROPOSED): the last responsible moment is the earliest
start of the first activity that needs the decision minus its lead time, on the working calendar.
It moves when the schedule moves; nobody maintains it.

**The plan is never rewritten in silence** (ADR-PROPOSED): a work has baselines; the first is
taken when the plan is approved; editing an approved plan asks for a reason and makes the next
baseline; every past baseline is readable and comparable. The diary is append-only with a hash
chain; a correction is a new entry pointing at the one it corrects.

**Three lenses, one model** (ADR-PROPOSED): a lens is a vocabulary and an arrangement of the same
rows. Nothing is stored per lens; a term shown in any lens resolves through the glossary, which
carries its plain sentence in every language the product speaks.

**Templates are plans, not tasks** (ADR-025 lineage): applying a template creates stages,
activities, dependencies, decisions, checks and cost lines with duration ranges the person then
makes their own; the template is not copied as a to-do list.

**Scheduling** (PROPOSED — KEYSTONE confirms in F2 with a benchmark): the critical-path engine is
Tessera's (`domain/criticalPath.ts`, `domain/timeline.ts`, `domain/schedule.ts`) copied literally
and extended with the working calendar, lags and baselines — one engine, proven, not a second
one.

The schema is in [`DATA_MODEL.md`](DATA_MODEL.md).

## 4. Non-functional requirements

| Requirement                                            | Target                                              | How it is measured                          |
| ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------- |
| Cold start                                             | < 1.5 s to a usable window                          | release build, timed                        |
| Schedule a work of 2 000 activities and 3 000 links    | < 100 ms; the Gantt drawn < 500 ms                  | benchmark in Vitest, **3× headroom** for CI |
| Readiness recomputed after any edit                    | < 50 ms                                             | benchmark in Vitest                         |
| A diary of 3 000 entries and 10 000 photos             | day view < 200 ms; search < 100 ms; thumbnails lazy | benchmark fixture, release build            |
| Dashboard                                              | every figure drawn < 200 ms from a cold query       | release build, timed in the e2e             |
| Installer                                              | < 10 MB                                             | release gate (`check:bundle`)               |
| **No diary entry is lost and no baseline overwritten** | **requirement one**                                 | append-only in the schema **and** the host  |

A planner that lets a plan be rewritten with no trace, or a diary whose entries can be edited
after the fact, is a notes app. Append-only is a correctness requirement, not an audit feature.

## 5. Security and privacy

This product **holds the record of somebody's home and somebody's money**, and it is **public
source**. The threat model in [`../SECURITY.md`](../SECURITY.md) is written in F0, before the
first work is created, and holds:

- **No network.** No account, no telemetry, no crash reporting, no update check, no weather
  service. The product reads and writes the work folder the person chose in a dialog, and nothing
  else.
- **Files are hostile.** A photo or document copied into the work goes through caps on size and
  image dimensions, is never executed, and is opened by the operating system's own handler only on
  the person's click. A `.jpg` that is not a JPEG is a sentence, not a crash. The corpus is in
  `cargo test`.
- **The diary and the baselines are append-only.** Insert-only tables, triggers refuse update and
  delete, no command exists to edit an entry; each entry carries the hash of the previous one and
  the export verifies the chain. This is stated plainly as tamper-evidence, **not** as a signature
  and not as legal proof — what a diary is worth in a dispute is the jurisdiction's, not the
  product's.
- **The plan has no progress command.** The only way progress changes is a diary entry.
- **Exports neutralise formula injection**; backups are one file with a manifest and a hash.
- **Fixtures are synthetic.** No real address, no real person, no real contractor, no real price
  list is committed; the template library carries ranges, not quotes.
- **Public repository hygiene.** No `.env`, no key, no secret, no personal e-mail; `CONTRIBUTING`
  says how a template enters the library and the schema test says whether it may.
- **Minimum capabilities.** Tauri capabilities declared one by one; the shell plugin is not used;
  the opener is used only for a file the person clicked.

Out of the threat model, stated plainly: an attacker with write access to the person's account
can edit the database file. It is not encrypted at rest; the folder's access control is the
operating system's.

## 6. Testing and gates

| Level         | Tool                       | Target                                                                                                                                                                                                                                                                             |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules         | Vitest over `domain/`      | **≥ 90%** — the schedule on a working calendar with every negative case; critical path; the slip; decision deadlines; readiness rule by rule; progress derived from entries; the chain; the two check gates; every money figure carries its rows; baseline comparison; the lenses  |
| Host          | `cargo test`               | triggers refuse update/delete on entries and baselines; the chain verifies and a tampered file fails it; copy-in caps and the hostile file corpus; backup → restore round-trips a full work byte for byte; CSV neutralised                                                         |
| Contract      | Vitest over `data/`        | the interface's shape matches the Rust serde shape                                                                                                                                                                                                                                 |
| End-to-end    | WebDriver + `tauri-driver` | start a work from a template → readiness names what is missing → fill it → readiness 100 % → approve (baseline 1) → a diary entry says the plaster is done with a photo → the plan moves, the slip shows, a decision is due → restart → everything still there and the chain holds |
| Architecture  | own test                   | fails if `domain/` imports React, Tauri or an outer layer; fails if a string is shown that is not in the i18n table                                                                                                                                                                |
| Library       | schema test                | every template in the library validates, has no cycle, has ranges not points, and applies to an empty work without error                                                                                                                                                           |
| Accessibility | axe-core in the e2e suite  | every screen, both themes, both languages, serious/critical = fail; keyboard-only journey from new work to first entry                                                                                                                                                             |
| Host proof    | **Alex, on a real work**   | per release: a real small work (not committed) planned from a template to readiness 100 %, run for a week through the diary, the weekly report printed and read by somebody who is not an engineer                                                                                 |

**Mandatory negative cases**: a dependency cycle; a dependency onto an activity in a closed
stage; an activity with no duration counted as not ready; a decision with a lead time longer than
the time left (overdue on creation, said so); a working calendar with no working days; a stage
closed with an unanswered check; an item answered _not applicable_ with no reason; a diary entry
dated in the future; an entry for a day that already has one (a second entry is allowed and
ordered, a replacement is not); an edit to an entry (refused; a correction is offered); an entry
that names an activity that does not exist; a payment with no stage; paid greater than committed
(allowed, flagged); an approved plan edited with no reason; a baseline compared with itself; a
template that imports itself or has a cycle; a template with point durations instead of ranges; a
lens that shows a term absent from the glossary; a photo that is not an image; a work folder
moved while open.

```
version · cargo fmt --check · cargo clippy -D warnings · cargo test
tsc --noEmit · eslint (react-hooks/rules-of-hooks = ERROR) · prettier --check · vitest
```

One script, `npm run gates`, run identically by a developer and by CI.

## 7. Vertical slices

Depth before breadth. F0 crosses Rust → SQLite → commands → domain → UI in a single feature: a
work really exists on disk, one stage with one activity is really scheduled, and **readiness
really says what is missing** — the product's thesis is on the screen on day one, in two
languages, before there is a Gantt chart. The dashboard is not a slice: it grows one figure per
slice and F10 composes it.

| #      | Slice                                        | Proof of done                                                                                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F0** | Foundation, shell, one stage, readiness      | **a work is created as a folder; one stage with one activity is scheduled on a working calendar; the readiness figure reads below 100 % and opens onto "1 activity has no responsible"; the sentence is in English and in Portuguese** · gates green · e2e against the binary · MSI in budget · `SECURITY.md` and `GLOSSARY.md` written |
| F1     | The plan                                     | stages, activities, rooms, quantities, responsibles; the work breakdown and the owner's checklist are the same rows in two arrangements; reorder by keyboard; the lens switch changes every term through the glossary and stores nothing                                                                                                |
| F2     | The schedule                                 | dependencies with lag on the working calendar; **critical path highlighted on the Gantt**; the finish date; approve = baseline 1; a slipped activity moves every dependent one and the finish date, and the slip is a figure that carries its rows; the 2 000-activity benchmark within budget                                          |
| F3     | Decisions and readiness                      | a decision belongs to a stage with a lead time; **its deadline is computed and moves with the schedule**; readiness rule by rule with its explanation; "what the plan does not know" is a list that opens onto each row; the negative battery for decisions and readiness is green                                                      |
| F4     | The diary                                    | one-tap and detailed entries with photos copied in; **entries append-only with a verified chain; an edit is refused and a correction offered**; progress on the plan derived from entries; the day view; restart and the chain still holds                                                                                              |
| F5     | Checks                                       | start and close checklists per stage; **a stage cannot close with an unanswered item**; _not applicable_ needs a reason; checks come from the template and are edited per work; the inspection is a check with a photo                                                                                                                  |
| F6     | Money                                        | planned, committed and paid per stage and trade; the payments ledger with receipts; every figure opens onto its rows; paid over committed is flagged; the S-curve of planned against paid                                                                                                                                               |
| F7     | People and documents                         | trades and contacts; who is on site from the diary; files copied into the work folder with thumbnails, hashes and caps; **the hostile file corpus is refused with a sentence**; a work folder moved is found again from a dialog                                                                                                        |
| F8     | Replanning and baselines                     | editing an approved plan asks for a reason and makes baseline N+1; **any two baselines compare** with dates moved, stages added or removed, money changed, and the reasons between them; a what-if that is not saved is not a baseline                                                                                                  |
| F9     | Templates and the library                    | the library ships as data and is schema-tested; a work starts from a template as a **plan** with ranges; a work exports as a template with numbers stripped or kept; `CONTRIBUTING` says how a template enters and the test says whether it may                                                                                         |
| F10    | The dashboard and reports                    | the front door composed from every figure the slices made, each carrying its rows; the weekly report (PDF) in the owner's words; the diary export (PDF and CSV) with the chain verified; the schedule printed; **CSV neutralised, a second reader parses the PDF**                                                                      |
| F11    | Settings, Diagnostics, About, backup, polish | both themes, both languages, every screen captured; backup is one file and restore brings a full work back byte for byte; Diagnostics lists schema, chain and folder health; axe-core clean; the keyboard reaches everything from new work to first entry                                                                               |
| F12    | Release 1.0.0                                | the installer runs on a clean machine and F0's proof passes on it; **a real work (Alex's, not committed) is planned to readiness 100 %, run for a week through the diary, and its weekly report is read by somebody who is not an engineer**                                                                                            |

## 8. Definition of done

A slice is done when **all nine** are true.

1. Gates green. No exceptions, no "I'll fix it after".
2. Tests cover the new rule, **including the negative case**.
3. Documentation synchronised with the code that actually shipped — the glossary included.
4. **Verified running** — the screen was opened in both themes and both languages and
   **captured**; the file was actually written. Done is somebody looking at the screen, not a
   green pipeline.
5. **Every figure the slice shows carries its rows and opens onto them**, and nothing the slice
   writes to the plan bypasses the diary or the baseline.
6. Design system gate: one token source, canonical primitive, the official icon set.
7. Accessibility: keyboard reachable, focus visible, contrast checked.
8. No secrets, no real address, person, contractor or price, and no personal e-mail in the
   repository; the repository is public and stays clean.
9. Conventional Commits, one concern each, staged per file; the pull request says what could not
   be verified.

## 9. Risks

| #   | Risk                                                                                     | Severity     | Mitigation                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **A diary entry is lost, or a baseline overwritten**                                     | **Critical** | append-only with triggers and a chain; no edit command exists; backup round-trip proven in Rust                                                          |
| R2  | The diary is not written, so the plan drifts from the site and every derived figure lies | High         | the one-tap entry; the dashboard says how many days have no entry; the weekly report is empty without them, visibly                                      |
| R3  | The layperson finds it too much and leaves on the first screen                           | High         | the owner's lens is the default for a new work; a template asks questions instead of showing a Gantt; readiness says the next thing to do, in a sentence |
| R4  | The engineer finds it too little and goes back to Primavera                              | Medium       | critical path, lags, calendar, baselines, S-curve, quantities and JSON export are in 1.0; levelling and earned value are named as 2.0, not denied        |
| R5  | Template durations and costs are taken as promises                                       | High         | templates carry **ranges**, are labelled as starting points, and the schema test refuses point values; no prices in the library, only cost lines         |
| R6  | The diary's chain is presented, or read, as legal proof                                  | Medium       | stated as tamper-evidence only, in the product, the README and the export header                                                                         |
| R7  | Photos fill the disk                                                                     | Medium       | copy-in with caps, thumbnails, and Diagnostics showing the folder's size; originals never resized without saying so                                      |
| R8  | Two languages double every slice                                                         | Medium       | strings as data from F0; the architecture test fails on a string outside the table; the glossary is one file                                             |
| R9  | Scope overruns — every Procore feature ever asked for                                    | High         | the release train; 1.0.0 is a closed list                                                                                                                |
| R10 | A public library accepts a template that is wrong or hostile                             | Medium       | schema test in CI; templates are data with no code; review by a maintainer before merge                                                                  |
| R11 | The name collides with a construction product the people it is for already know          | Medium       | §0 — collision evidence shown before the repository existed; recorded in ADR-001                                                                         |
