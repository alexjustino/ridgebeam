# Architecture Decision Records

Binding decisions. A record here is not a suggestion: changing one requires a new record that
supersedes it, not an edit in passing. Each entry states the context, the decision, and — the
part that matters most later — the cost we accepted.

The six decisions the specification marks **ADR-PROPOSED** (the plan is intent and the diary is
fact; readiness is a measure; a decision's deadline is computed; the plan is never rewritten in
silence; three lenses over one model; templates are plans) are recorded here by the slice that
makes each of them true, not before. Slice F0 makes two of them true in part: readiness is a
measure, for the two rules F0 has ([ADR-008](#adr-008)), and the plan has no progress command
([ADR-009](#adr-009)) — the half of "the plan is intent and the diary is fact" that can be true
before there is a diary. Slice F1 makes a third true: three lenses over one model
([ADR-014](#adr-014)). Slice F2 makes part of a fourth true: the first baseline is taken when
the plan is approved and no baseline is ever overwritten ([ADR-016](#adr-016)); slice F8
completes it: an approved plan changes only after somebody says why, every change ends in a new
baseline carrying that reason, and any two baselines compare ([ADR-027](#adr-027),
[ADR-028](#adr-028)). Slice F3 makes a fifth true: a decision's deadline is computed
([ADR-017](#adr-017)). Slice F4 completes the first: progress is derived from the diary
([ADR-020](#adr-020)), which is append-only with a hash chain ([ADR-019](#adr-019)). Slice F9
makes the sixth true: templates are plans, applied once as the work's own, with ranges and no
prices ([ADR-029](#adr-029)), and a work goes back out as a template ([ADR-030](#adr-030)). Slice
F11 gives the template its voice: a plan started from one asks what it does not yet know, one
question at a time ([ADR-034](#adr-034)).

Before its first use, the product's owner widened 1.0 with four differentiators, set out with their
cost in [ADR-036](#adr-036). The first, slice D1, gives the finish as a probability as well as a
date, from the ranges a person gives and without touching the plan's own dates
([ADR-035](#adr-035)). The second, slice D2, ties each payment to the work it pays for: a
commitment's milestones are earned only by facts of the work, and a payment that would put the owner
ahead of the work is warned about before it is saved, never refused ([ADR-037](#adr-037)). The
third, slice D3, writes the work's record for its owner — one PDF with the photos of the work
hidden behind walls and floors, which a check can now require before it is answered yes
([ADR-038](#adr-038)). The fourth, slice D4, writes the work as it stands for the owner to read on
a phone — one HTML file with no script and nothing loaded from anywhere, which the person sends
themselves ([ADR-039](#adr-039)).

Before the owner's first real work, slice U1 takes away the friction a first week meets: a file
dropped on the window is taken in as if it had been chosen in the dialog, the diary offers the same
people as last time, and the dashboard reminds — quietly — when the work has not been backed up,
while the product still never backs one up on its own ([ADR-040](#adr-040)).

After U1, the owner asked for a second wave: four slices, one for each of the four ways a small
work fails, admitted with the first of them in [ADR-041](#adr-041). The first, slice E1, puts every
change to an approved plan on record — who asked, what changes, what it costs and what it does to
the finish, computed by the schedule before anybody decides — and an approval opens the replanning
with the change already in the plan, while a standing tally says how much the work has grown
([ADR-041](#adr-041)). The second, slice E2, asks whether the money will last: the funds the
owner expects are plan, the money received is a ledger of facts, and a projection reads them week by
week against what the schedule and the payment plans will ask for, naming the week the money runs
short, if it does ([ADR-042](#adr-042)). The third, slice E3, says when the work will finish as
things stand — a forecast read forward from what the diary says happened, beside the plan's own
date and never in its place — and why it is late: every working day of the difference from the
baseline attributed to a cause the record names, and the days it cannot attribute said in words
([ADR-043](#adr-043)). The fourth, slice E4, completes the wave: what is found wrong near the end is
a snag, raised with a photo, put on the person who must fix it and closed only with a photo of it
fixed — or withdrawn with a reason, never deleted — and a commitment's last part can be held back as
retention, earned only when its stage is closed and that person's snags are ([ADR-044](#adr-044)).

| #               | Decision                                                                                                              | Status                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [001](#adr-001) | The product is named Ridgebeam                                                                                        | Accepted — 2026-09-24, by Alex |
| [002](#adr-002) | Tauri 2 with a deliberately thin Rust host                                                                            | Accepted — 2026-09-25          |
| [003](#adr-003) | The domain layer is pure TypeScript                                                                                   | Accepted — 2026-09-25          |
| [004](#adr-004) | A work is a folder, and the application keeps a small database of its own                                             | Accepted — 2026-09-25          |
| [005](#adr-005) | Fluent is the visual language, with one icon set                                                                      | Accepted — 2026-09-25          |
| [006](#adr-006) | No network, no telemetry                                                                                              | Accepted — 2026-09-25          |
| [007](#adr-007) | Strings are data in two languages, and the glossary is data too                                                       | Accepted — 2026-09-25          |
| [008](#adr-008) | Readiness is a measure, not a feeling                                                                                 | Accepted — 2026-09-25          |
| [009](#adr-009) | The plan has no progress command                                                                                      | Accepted — 2026-09-25          |
| [010](#adr-010) | End-to-end tests drive the real binary                                                                                | Accepted — 2026-09-25          |
| [011](#adr-011) | Accessibility is gated, not reviewed                                                                                  | Accepted — 2026-09-25          |
| [012](#adr-012) | Installers are not code-signed in 1.0.0                                                                               | Accepted — 2026-09-25          |
| [013](#adr-013) | Settings are a closed list of keys the host owns                                                                      | Accepted — 2026-09-25          |
| [014](#adr-014) | A lens is a vocabulary table over the glossary, and an arrangement; nothing is stored per lens                        | Accepted — 2026-09-25          |
| [015](#adr-015) | One scheduling engine: Tessera's, copied literally and extended with the working calendar, lags and baselines         | Accepted — 2026-09-25          |
| [016](#adr-016) | Baselines are insert-only from the first one                                                                          | Accepted — 2026-09-25          |
| [017](#adr-017) | A decision's deadline is computed, never stored                                                                       | Accepted — 2026-09-25          |
| [018](#adr-018) | Readiness is explained rule by rule, and the rules sum to the figure                                                  | Accepted — 2026-09-25          |
| [019](#adr-019) | The diary is append-only with a hash chain, and a correction is a new entry                                           | Accepted — 2026-09-25          |
| [020](#adr-020) | Progress is derived from the diary, in states, never as an invented number                                            | Accepted — 2026-09-25          |
| [021](#adr-021) | Photos are copied by the host under caps and shown as data URLs                                                       | Accepted — 2026-09-25          |
| [022](#adr-022) | A stage's gates are answered facts, and a closed stage is closed                                                      | Accepted — 2026-09-27          |
| [023](#adr-023) | Money is three facts with three sources, in minor units, and the ledger is append-only                                | Accepted — 2026-09-27          |
| [024](#adr-024) | Every money figure carries its rows, and paid over committed is flagged, not refused                                  | Accepted — 2026-09-27          |
| [025](#adr-025) | A document is a file the work owns, typed by its bytes, deduplicated by its hash, and never parsed                    | Accepted — 2026-09-27          |
| [026](#adr-026) | A person is a contact with stages, and presence comes from the diary                                                  | Accepted — 2026-09-27          |
| [027](#adr-027) | An approved plan is locked until somebody says why: a replanning is a row, closed only by the next baseline           | Accepted — 2026-09-28          |
| [028](#adr-028) | Any two baselines compare in the domain; a what-if is never written                                                   | Accepted — 2026-09-28          |
| [029](#adr-029) | A template is data, applied once as the work's own plan, with ranges and no prices                                    | Accepted — 2026-09-28          |
| [030](#adr-030) | A work exports as a template with its numbers stripped or kept                                                        | Accepted — 2026-09-28          |
| [031](#adr-031) | A report is a document the interface composes and the host renders, in standard fonts, and a second reader checks it  | Accepted — 2026-09-28          |
| [032](#adr-032) | The diary export verifies the chain when it is written, and a CSV never carries a formula                             | Accepted — 2026-09-28          |
| [033](#adr-033) | A backup is one ZIP with a manifest; restore makes a new folder and proves it byte for byte                           | Accepted — 2026-09-28          |
| [034](#adr-034) | The plan asks one question at a time                                                                                  | Accepted — 2026-09-28          |
| [035](#adr-035) | The finish is also a probability: ranges, a seeded simulation, natural frequencies, and the plan's own date untouched | Accepted — 2026-09-29          |
| [036](#adr-036) | The owner widened 1.0 before first use                                                                                | Accepted — 2026-09-29, by Alex |
| [037](#adr-037) | A payment plan is earned by facts, and paying ahead is warned, not refused                                            | Accepted — 2026-09-29          |
| [038](#adr-038) | The handover book: the work's record for its owner, photos of hidden work required where it matters                   | Accepted — 2026-10-01          |
| [039](#adr-039) | The owner's snapshot: one file with no script, rendered by the host, sent by the person                               | Accepted — 2026-10-02          |
| [040](#adr-040) | Before the first real work: a drop is a choice, and the product reminds but never backs up on its own                 | Accepted — 2026-10-02          |
| [041](#adr-041) | Change orders: nothing changes without a price and a date                                                             | Accepted — 2026-10-02          |
| [042](#adr-042) | Will the money last? Funding as plan, receipts as facts, a weekly projection                                          | Accepted — 2026-10-02          |
| [043](#adr-043) | As things stand: a forecast from the diary, and a ledger of why it is late                                            | Accepted — 2026-10-04          |
| [044](#adr-044) | A work that ends well: snags closed with a photo, and retention held until they are                                   | Accepted — 2026-10-04          |

---

## ADR-001 — The product is named Ridgebeam {#adr-001}

**Status.** Accepted — 2026-09-24, decided by Alex.

**Context.** The specification's §0 required the name to be chosen by a person, before the
repository existed, from three finalists brought with collision evidence: GitHub repositories and
handles, the package registries, the Microsoft Store, the `.app`/`.dev`/`.com`/`.io` domains,
USPTO and INPI, and a plain web search for the name with "construction" and "app". The name had
to be one English word or a plain compound, pronounceable in English and Portuguese, sayable on a
site and in a kitchen, carrying a real essence of building, and not sound like an enterprise
suite. The incumbents (Procore, Buildertrend, Fieldwire, Autodesk Build, PlanGrid, CoConstruct,
Houzz Pro, Buildbook, Levelset, Primavera, Project, Sienge, Obra Prima, Mobuss) were taken and
were not references.

One round ran on 2026-09-24. The specification's seven starting references (Plumbline, Topout,
Groundwork, Sitebook, Plinth, Underpin, Lintel) and twenty-one more from the same families — a
part of the building, a tool of the trade, a moment of the build, the book kept on site — went
through the same battery. What fell, and the evidence:

- **Plumbline** — the specification's first hypothesis, crowded: npm, crates.io and PyPI packages
  taken; `.app`, `.dev` and `.com` taken; a "PlumbLine" spirit-level app on Google Play; 20 US
  marks containing the word (Plumbline Services, class 37, registered; Treace Medical, filed 2024)
  and 16 more for "plumb line"; a GitHub organisation with the name.
- **Topout** — `topout.build` is a construction software suite (Closeout Compass, Runway, Permit
  Tracker), and TopOut CM is a construction management firm.
- **Lintel** — `uselintel.com`, AI plan review for construction. **Chalkline** — VisiSpecs, a
  construction specification suite. **Stringline** — three construction apps (a calculator, a
  field tool, a quoting platform). **Sitebook** — `sitebook.com.au`, construction management with
  iOS and Android apps. **Setout** — `setoutapp.com`, practice management for architecture with
  stages, decisions and timelines: the same audience. **Housebook** — a construction documentation
  app. **Brickbook** — `brickbook.eu`, a B2B platform where contractors find subcontractors.
  **Trysquare** — `trysquare.app` is a live assessment product. **Plinth** — a foundation
  calculator, a UK charity platform and three more apps. **Groundwork**, **Underpin**,
  **Formwork**, **Corbel**, **Trowel**, **Tiebeam**, **Kingpost**, **Levelbook**, **Sawhorse**,
  **Eaves** — multiple products or companies each.

Three finalists survived. **Firstbrick** — the first brick, the one essence a layperson needs no
sentence for — but `firstbrick.app` has been parked "Coming Soon" since 2020 and renewed to 2027,
`firstbrick.com` has been held since 2010, and INPI holds **FIRST BRICK TOYS** as a registration
in force (classes 16 and 28, 2024) beside an archived "PROJETO FIRST BRICK". **Ridgepole** — the
same piece of the roof in its older word — collides with the 1 100-star Ruby schema tool
`ridgepole/ridgepole`, its RubyGems name and GitHub organisation, and three US marks (housewares,
registered 2022; cosmetics, one registered and one abandoned).

**Decision.** The product is **Ridgebeam**: the beam at the very top of a pitched roof, where
the rafters meet — the highest piece of a house's frame and the last structural one to go up; in
Brazil the _cumeeira_, whose day is a celebration because from it the house has its shape.
Pronounced RIJ-beem in English and "rídj-bim" in Portuguese. The sentence a layperson is told:
"It is the beam at the top of the roof. When it goes up the house has its shape — and it only
goes up because everything under it was planned first." That is the product's thesis in one
object.

**Evidence for Ridgebeam.** GitHub: five repositories with the word, none above one star, and a
user "Ridgebeam" with two tiny repositories; the repository `alexjustino/ridgebeam` was free.
npm, crates.io, PyPI and RubyGems: free. Microsoft Store: no product with the name (the search
returns beam-calculation apps). Domains: `ridgebeam.app`, `.dev` and `.io` free (RDAP 404);
`.com` registered 2011, answering 404, held by Ridgebeam Building Company, a timber-framing
contractor. USPTO, queried through the search system's own index: zero marks containing
"ridgebeam"; one "RIDGE BEAM" (class 27, floor mats, an individual in China, filed 2022). INPI,
radical search: no result. TMview, offices US and BR: no rows. Web: Ridgebeam Construction, a
kitchen-and-bathroom remodeler in San Francisco since 1997, and the timber framer above — small
contractors, no software.

**What was not verified, stated plainly.** The USPTO's public search page returned "no results"
for every query in the session, including a control that has seventy-three marks; the counts
above came from the same system's search index, queried directly, with the control passing.
The INPI control query did not run: the anonymous session expired after the four searches — the
internal control is that the same session returned three processes for "firstbrick" and none for
the others. The Microsoft Store search is fuzzy and was read from the results page, not from a
catalogue. Google Play and the App Store were covered by web search only. Before the name is
used outside this repository — a store listing, a domain — a person with a session at TSDR and
at INPI closes these gaps; the product is free and the repository is public, so this is a
documented risk (spec R11), not a blocker.

**Cost accepted.** Two small Californian contractors trade under the word and one holds `.com`;
a person searching "ridgebeam construction" will find them first for a while. One US mark reads
"RIDGE BEAM" in an unrelated class. The word is two syllables of trade vocabulary that a
first-time owner has to be told once, where Firstbrick would have needed no telling; the
one-sentence essence is therefore part of the product's voice — on the About screen, in the
README and in the glossary — not an afterthought. The name is always one word, capitalised,
never "Ridge Beam" and never "RB". Firstbrick and Ridgepole stay in the record as the runners-up.

**Re-checked for 1.0.0 — 2026-09-28** (`docs/RELEASE.md` step 7). What changed since the decision:
the GitHub user "Ridgebeam" now holds four small repositories (tools for an online game), up from
two; nothing else found moved. npm, crates.io, PyPI and RubyGems: still free. Domains: `.com`
still registered, `.app`, `.dev`, `.io` and `.com.br` still free (RDAP 404). USPTO, through the
same search index with the same control passing (73 marks for "procore"): still no mark containing
"ridgebeam", still the one "RIDGE BEAM" in class 27. **Not re-checked this time**, stated plainly:
TMview, the INPI radical search and the Microsoft Store — the built-in browser did not load
TMview within five minutes, and the INPI and Store checks need a browser session. They stand as
they were on 2026-09-24.

**Re-checked for the recut of 1.0.0 — 2026-10-02.** Nothing moved since 2026-09-28. The GitHub user
"Ridgebeam" still holds four small repositories. npm, crates.io, PyPI and RubyGems are still free.
`.com` is still registered; `.app`, `.dev`, `.io` and `.com.br` are still free (RDAP 404). USPTO,
with the control again at 73 marks for "procore": no mark containing "ridgebeam", and the one "RIDGE
BEAM" in class 27. Two of the three left out last time were done: **TMview** has no active mark for
"ridgebeam" (its control, "procore", returns 271), and the **Microsoft Store** has no app of the name
— its search answers with unrelated popular apps. **Not re-checked**, stated plainly: the INPI radical
search, which needs a session the built-in browser did not keep; it stands as it was on 2026-09-24.

**Re-checked for the second recut — 2026-10-04.** Nothing moved since 2026-10-02: the GitHub user
"Ridgebeam" still holds four repositories; npm, crates.io, PyPI and RubyGems are still free; `.com`
is still registered and `.app`, `.dev`, `.io` and `.com.br` still free; USPTO, with its control at 73,
still has no mark containing "ridgebeam" and the one "RIDGE BEAM". TMview, the Microsoft Store and
INPI were not re-checked this time; they stand as on 2026-10-02 (TMview, the Store) and 2026-09-24
(INPI).

## ADR-002 — Tauri 2 with a deliberately thin Rust host {#adr-002}

**Status.** Accepted — 2026-09-25.

**Context.** The product must feel native on Windows 11 — Mica, the system accent, the system's
own folder dialog — and ship as an installer under 10 MB (SPEC §4). It holds the record of
somebody's home and money in a database on their disk, which the webview must not be trusted to
open, migrate or close. And its hard parts are not the operating system's: they are the rules —
what a working day is, where an activity falls on the calendar, what the plan does not yet know.
The sibling products are built on the same stack and it has already been through three releases.

**Decision.** Tauri 2. The Rust side holds only what needs the operating system or must not
trust the webview: the two databases and their migrations ([ADR-004](#adr-004)); the work folder
— create it, open it, find that it has gone, checkpoint and close it; the settings list
([ADR-013](#adr-013)); the Windows accent and the application data folder; and the typed
`#[tauri::command]` boundary, `snake_case` commands with `camelCase` serde shapes. Every error
crosses that boundary as `{ kind, message }`, with the kind from a closed list, so the interface
can decide what to say without parsing an English sentence. The product's **rules** — the
calendar, the placement of activities, readiness and its sentence — stay in TypeScript
([ADR-003](#adr-003)). The host is where bytes and files are handled; the domain is where
decisions are made.

**Why not Electron.** A binary of a few megabytes against a hundred and fifty, and WebView2 is
already on every Windows 11 machine. **Why not WinUI.** Three lenses over one model, two
languages from the first day and a figure that opens onto its rows are far cheaper to build well
in the web stack, and the planning rules are far cheaper to test as pure functions than as
anything else.

**Cost accepted.** Rust is a second language in the build, and the WebView is not identical
across Windows versions. Every shape exists twice — a serde struct and a TypeScript type — and
only a contract test and the end-to-end suite hold them together. Where the host must not trust
what the webview sends (a calendar with no working day, a folder that is not empty), it checks
again what the domain already refused: the same rule twice, on purpose, at the boundary.

## ADR-003 — The domain layer is pure TypeScript {#adr-003}

**Status.** Accepted — 2026-09-25.

**Context.** A planner goes wrong in its rules, quietly: a holiday counted as a working day, a
duration counted in calendar days, an activity placed on a Saturday, a readiness figure computed
from a different set of rows than the list under it shows. None of those is visible in a
screenshot, and all of them are cheap to find with a test that can call the rule directly.

**Decision.** `src/domain/` holds the working calendar (working days, holidays, adding working
days, refusing a calendar with no working day), the placement of activities on it, readiness —
its rules, its figure, its rows and the counts its sentence is built from — and the figure shape
every later number will share. It imports no React, no `@tauri-apps/*`, no outer layer
(`data/`, `ui/`, `features/`, `app/`), and performs no I/O. Later slices add the critical path,
decisions and their computed deadlines, the diary's derived progress, checks, money, baselines
and the lenses — here, under the same rule.

**Why.** Purity makes every rule testable against known answers without mounting a component or
opening a window, and it is what lets SPEC §4 hold the recompute budgets (readiness under 50 ms,
a 2 000-activity schedule under 100 ms) as benchmarks in Vitest. It is also what keeps the three
lenses honest: a lens is an arrangement of the domain's rows, and a rule that lived in a
component would be a rule one lens has and another does not.

**Enforcement.** Twice, deliberately: ESLint `no-restricted-imports` while editing, and
`src/domain/boundary.test.ts` in the gates, where it cannot be silenced with a disable comment.

**Cost accepted.** The domain cannot ask the host for anything; it is handed a snapshot of the
work and returns what follows from it. At F0's scale — one work, a handful of stages — the whole
plan crosses the boundary on every change. The 2 000-activity benchmark in F2 is where that is
measured, and if it fails the answer is a narrower snapshot, not a rule moved into Rust.

## ADR-004 — A work is a folder, and the application keeps a small database of its own {#adr-004}

**Status.** Accepted — 2026-09-25.

**Context.** A work belongs to the person paying for it. SPEC §2.1 asks for it to be a folder on
disk holding its database, its photos and its documents, self-contained and movable: something a
person can see, copy to a drive, hand to the next engineer, and keep after they stop using the
product. From F4 that database holds the diary, which is append-only and is requirement one: no
entry is ever lost. Separately, a person has preferences — a language, a theme, a lens — and a
list of the works they opened recently, none of which belongs to any one work.

**Decision.** Two databases, both `rusqlite` with the bundled SQLite so the build does not depend
on a system library.

- **A work is a folder.** The person chooses it in a dialog; the host creates `work.sqlite3` in
  it. Creating refuses a folder that is not empty; opening refuses a folder without
  `work.sqlite3`. The work carries its own identity, a UUID v7, across renames and moves. The
  database is opened with `journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON`,
  `recursive_triggers = ON` and `busy_timeout = 5000`, and is **checkpointed and closed** when
  the work is closed, so that a closed work folder holds one database file and no journal.
- **The application keeps `ridgebeam.sqlite3`** in its application data folder
  (`%APPDATA%/io.github.alexjustino.ridgebeam/`): the settings ([ADR-013](#adr-013)) and the
  recent works with their folders. Nothing about the content of a work is kept there.
- **A moved folder is found again from a dialog.** The recent list remembers where each work was
  last seen; a row whose folder is gone says so and offers to find it, rather than disappearing
  (`DESIGN_SYSTEM.md` §8). A folder that disappears while the work is open is detected by every
  command that touches the work, and refused with the kind `work_moved` — a mandatory negative
  case (SPEC §6).
- **A folder synchronised by another program while the work is open is not supported in 1.0.**
  A synchroniser sees the database, its `-wal` and its `-shm` as three files changing at three
  moments; it can upload a state that never existed, or bring an older copy back over a newer
  one. A closed work is one file and may be copied or synchronised like any other. Sharing a
  work between people, with conflict rules, is release 1.2 — not a folder in somebody's cloud
  drive in 1.0.

**Why `FULL` and not `NORMAL`.** `NORMAL` in WAL mode is durable across an application crash and
can lose the last transactions on sudden power loss. For a product whose files are its output
that is a fair trade; for this one the database _is_ the record, and a diary entry lost to a
power cut on site is exactly the loss requirement one forbids. `FULL` costs a sync per commit,
which at the rate a person types is not something anybody will notice. **Why WAL.** Readers do
not block the writer, and it survives a hard kill far better than the rollback journal.

**Cost accepted.** Two databases and two sets of migrations. The synchronised-folder limit is
real — many people keep everything in a cloud-synchronised folder — and it is stated in the
documentation rather than half-supported. The work database is not encrypted at rest; the
folder's access control is the operating system's ([`SECURITY.md`](../../SECURITY.md)).

## ADR-005 — Fluent is the visual language, with one icon set {#adr-005}

**Status.** Accepted — 2026-09-25.

**Context.** The person this product must not lose is the one who has never used a planner. Every
control that looks unfamiliar is one more thing between them and the sentence that says what
their plan is missing.

**Decision.** Fluent 2 as Windows 11 draws it: Mica as the window backdrop, the system accent
ramp read from the host, Segoe UI Variable, Windows 11 geometry, four elevation steps, and
**Fluent UI System Icons** as the only icon family. The contract is
[`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md); the token layer is `src/styles/tokens.css`; the
primitives are `src/ui/`, carried over from the sibling products rather than reinvented.

**Why.** The product should look like it belongs on the desktop it runs on, not like a web page
in a frame, and the controls a person already knows from Windows are the ones they do not have to
learn. One token source and one icon set are what keep a product looking like one product.

**Cost accepted.** No off-the-shelf component library; the primitives are ours, built once and
reused. The look is Windows' — which is the only platform 1.0.0 ships on. Native capability that
is unavailable degrades **visibly**: Mica falls back to a solid token surface, a missing accent
to the default, and the interface says so rather than pretending.

## ADR-006 — No network, no telemetry {#adr-006}

**Status.** Accepted — 2026-09-25.

**Context.** The product holds the plan of somebody's home, what happened on site, the photos,
the people and the money (SPEC §5). A planner that sends any of that anywhere — to a sync
service, an analytics endpoint, a weather API with the work's address in the query — has made a
promise about somebody else's server on the person's behalf.

**Decision.** The application makes no outbound request, ever. No account, no login, no sync, no
analytics, no crash reporting, no update check, no weather service, no map, no font or script
loaded from anywhere. The place a person types for a work is kept as they wrote it and never
geocoded. The Tauri capabilities are declared one by one and include no HTTP, no shell and no
filesystem plugin; the content security policy admits no external origin.

**Why.** Privacy is a property of this product, stated in the README and on About, not an
omission. It is also what makes the security posture simple enough to be true: a product with no
socket has no exfiltration path to argue about, and a reader of the source can confirm it in
`src-tauri/capabilities/`.

**Cost accepted.** No automatic updates in 1.0.0; releases are downloaded from GitHub, and the
product cannot say that a newer one exists. Weather days are written in the diary by the person
who was there, not filled in from a service (SPEC §2, "weather from the network" is 2.0 at the
earliest). There is no map of the work.

## ADR-007 — Strings are data in two languages, and the glossary is data too {#adr-007}

**Status.** Accepted — 2026-09-25.

**Context.** The product is for an engineer, an architect and a person building once, in English
and in Portuguese from the first slice (SPEC §2.13). Two languages double every slice (SPEC R8)
unless the second one is a table rather than a second pass. And the vocabulary is the product's
hardest problem: _activity_, _responsible_, _readiness_ mean something precise to an engineer and
nothing yet to an owner, so every term needs a plain sentence, in both languages, in one place.

**Decision.**

- **Every string is in the table.** `src/i18n/en.ts` and `src/i18n/pt-BR.ts` hold every word a
  person reads; the English table's keys are the type the Portuguese one must satisfy. Two tests
  hold it in the gates: the **dictionaries test** fails when a key is missing or empty in either
  language, and the **literals test** parses every component with the TypeScript compiler and
  fails on user-visible text that is not from the table. The one allowed literal is the name,
  _Ridgebeam_ ([ADR-001](#adr-001)).
- **The host writes English and names a kind.** Its errors carry a kind from a closed list
  ([ADR-002](#adr-002)); the kinds whose sentence is fixed are translated by the interface, so a
  refusal reads in the person's language even though the host does not know it.
- **The glossary is data.** `src/i18n/glossary.json` holds every term the product shows, each
  with its plain sentence in every language the product speaks. `scripts/glossary.mjs` validates
  it — every term has every language, no term or sentence empty, keys unique and camelCase — and
  generates [`docs/GLOSSARY.md`](../GLOSSARY.md); `npm run check:glossary` is a gate that fails
  when the page on disk is not byte for byte what the data generates. A term shown on a screen
  that is not in the glossary is a defect.
- **The language is a setting** — `system`, `en` or `pt-BR` ([ADR-013](#adr-013)) — and `system`
  follows Windows. **The owner's lens is the default** for a new work: the person least likely to
  know the vocabulary sees the plainest words first.

**Why.** A string outside the table is the one that ships untranslated, and nobody notices until
somebody reads it in the wrong language. A glossary kept as prose drifts from the words the
screens use; a glossary kept as data is checked by the same gates as the code.

**Cost accepted.** Every screen costs its words twice, and a layout is judged in Portuguese,
which is longer. The literals test is a parser with rules, and a rule that is too broad will
occasionally need a considered exception. Host sentences that carry the specifics of one refusal
stay in English until they are given kinds of their own — a known gap, visible, not hidden.

## ADR-008 — Readiness is a measure, not a feeling {#adr-008}

**Status.** Accepted — 2026-09-25.

**Context.** The specification marks "readiness is a measure, not a feeling" as ADR-PROPOSED and
makes it the product's thesis on screen from the first slice: F0's proof is a readiness figure
below 100 % that opens onto "1 activity has no responsible", in English and in Portuguese. The
incumbents show a percentage _complete_ — progress — and nothing that says how much of the plan
is still unknown, which is the thing a person building once needs to hear on the first evening.

**Decision.** Readiness is **the share of what the plan must know that it does know**, computed
from the rows every time and never stored.

- **Rules are data.** `src/domain/readiness/rules.ts` is a table: each rule names the kind of row
  it applies to, the test a row passes, and the i18n key of its sentence. F0 has two, made true
  here: **an activity must have a duration** (a whole number of working days, greater than zero),
  and **an activity must have a responsible**. Each rule contributes one _must-know_ per row it
  applies to and one _missing_ row per row that fails it. Later slices add rules — a stage's
  decisions, checks and money; declared dependencies — without changing the shape.
- **The figure carries its rows.** Readiness is a figure — an identifier, a unit, a value and the
  rows it was computed from — and on screen it opens onto them: each missing row names the
  activity, its stage and what it lacks (`DESIGN_SYSTEM.md` §8). The same shape is the one every
  later figure uses.
- **The sentence comes from counts.** "1 activity has no responsible." is built from the count of
  missing rows per rule through a pluralised i18n key, in the person's language — never from words
  concatenated in code.
- **100 % is a claim that nothing is missing.** The figure is never rounded up to 100 %, and a
  plan with nothing in it is not ready: it does not yet know anything it must.

**Why.** A feeling of readiness is what a person already had before they bought the tile the day
the tiler arrived. A number that can be opened onto its rows is one they can check, and a
sentence that names the next missing thing is one they can act on. Keeping the rules as data is
what lets a template, a lens or a screen be checked against them rather than re-deciding them.

**Cost accepted.** The figure goes **down** when a person adds an activity, because they have
added something the plan does not yet know — which can read as a punishment for planning more.
The sentence is the answer: it always says what to fill in next. Every rule weighs the same; a
missing responsible counts as much as a missing duration. That is crude, it is stated, and
weighting is a later record if it earns one.

## ADR-009 — The plan has no progress command {#adr-009}

**Status.** Accepted — 2026-09-25.

**Context.** "The plan is intent and the diary is fact" is the first of the specification's
ADR-PROPOSED decisions. Its full form — progress, actual dates, people on site and weather days
derived from diary entries — needs the diary, which is slice F4. But the half that forbids the
alternative can be true from the first slice, and it is cheapest to make true before anything is
built on top of a progress field.

**Decision.** There is no command that sets progress, no progress column in any table
([`DATA_MODEL.md`](../DATA_MODEL.md): "there is no progress column, and there never will be"),
and no control on any screen that sets it — no slider, no percentage, no "done" checkbox on an
activity (`DESIGN_SYSTEM.md` §8). From F4, progress is derived from diary entries and shown as a
figure that opens onto the entries it came from. **F0 ships no way to type it and shows no
progress at all.** The pull request template asks the question on every change.

**Why.** A progress field that exists will be used, and a plan whose progress was typed is a plan
whose every derived figure — the slip, the decision now due, the money now owed — rests on a
number nobody saw happen. It is a security rule as much as a product rule
([`SECURITY.md`](../../SECURITY.md)): a plan that can be rewritten with no trace is a notes app.

**Cost accepted.** Until F4, the product cannot say how far along a work is, and a person who
wants to tick an activity off cannot. From F4 the fastest way to mark something done is a one-tap
diary entry that says it was — one tap more than a checkbox, and the only one that leaves a
record.

## ADR-010 — End-to-end tests drive the real binary {#adr-010}

**Status.** Accepted — 2026-09-25.

**Context.** Unit tests prove rules; they cannot see the seams. The defects that survive green
unit suites live between two correct components — a command whose serde shape drifted from its
TypeScript type, a work that is written and then reopens slightly different, a sentence
translated in one language and not the other, a folder that is created but never checkpointed.

**Decision.** The end-to-end suite (`e2e/`, `npm run e2e`) launches the debug binary through
`tauri-driver` and Microsoft Edge WebDriver (`msedgedriver`, matched to the installed WebView2
runtime; its path in `RIDGEBEAM_E2E_EDGEDRIVER`). The client is a small W3C WebDriver
implementation kept in the repository, not a framework. `RIDGEBEAM_DATA_DIR` relocates the
application data folder to an empty temporary one — **in debug builds only**; a release build
ignores it, so it cannot be used to point somebody's installed product elsewhere. The operating
system's folder dialog cannot be driven by WebDriver, so **in debug builds the Start screen's
folder field accepts a typed path**; the dialog button is still there, and the typed path is
documented in the test as the one door that exists for it. F0's journey: a new work in a
temporary folder, a stage and an activity with a duration, readiness below 100 % opened onto
"1 activity has no responsible", the sentence in English and then in Portuguese, a responsible
added, readiness 100 %, a restart, and everything still there — with axe-core on every
destination ([ADR-011](#adr-011)).

**Why.** Only a test through the real host, the real page and the real file can find the seams.
The relocated data folder makes the suite safe to run on a machine that has real works, and every
session starts from nothing, which makes it a migration test too.

**Cost accepted.** The suite needs a built binary and a driver matched to the WebView2 runtime, so
it is not in the pull-request gate — `npm run gates` stays fast and hermetic. It runs on a
developer machine before a release and from a manually dispatched or weekly workflow, and hosted
runners may not start WebView2 at all; its verdict comes from a real desktop until they do. The
folder dialog itself is proved by a person, per release.

## ADR-011 — Accessibility is gated, not reviewed {#adr-011}

**Status.** Accepted — 2026-09-25.

**Context.** The people this product is for include somebody who has never planned a build, on
whatever machine and with whatever eyesight they have. An accessibility review remembers the week
it is discussed.

**Decision.** Three gates hold `DESIGN_SYSTEM.md` §7: a unit test that parses the token file and
checks every text-on-surface pair in both themes against WCAG AA; an axe-core audit run by the
end-to-end suite on every destination in **both themes and both languages**, failing on any
serious or critical violation; and a keyboard-only journey in the same suite — in F0, from a new
work to readiness 100 %, and by F11 to the first diary entry.

**Why.** A gate remembers it on every pull request. Running the audit in both languages matters
here: the Portuguese screen is a different layout, with longer labels and a different `lang`,
and it is the one a first-time owner in Brazil will see.

**Cost accepted.** axe-core is a development dependency injected into the page by the suite,
never shipped. The audit cannot judge how a screen reader _sounds_ — whether a Portuguese term is
pronounced as Portuguese — and that stays a person's job, written down as such.

## ADR-012 — Installers are not code-signed in 1.0.0 {#adr-012}

**Status.** Accepted — 2026-09-25.

**Context.** Windows SmartScreen warns on an unsigned installer the first time it runs. Signing
removes the warning, at a recurring cost and through an identity process.

**Decision.** The MSI and NSIS installers ship unsigned. The README and the release notes say so,
and tell the person to verify that the download came from this repository's Releases page and
that its SHA-256 matches the one the release workflow wrote into the notes.

**Why.** A code-signing certificate changes the first-run experience, not the security
properties of the software, and neither its cost nor its process is justified before the product
has users. The mitigation is transparency, not pretence.

**Cost accepted.** A worse first run, stated rather than hidden — and a real one for exactly the
person least used to clicking through a warning. Reversible at any release.

## ADR-013 — Settings are a closed list of keys the host owns {#adr-013}

**Status.** Accepted — 2026-09-25.

**Context.** F0 has three choices a person makes once and expects to find again: the language,
the theme and the lens. They are the person's, not a work's — a work opened on another machine
should appear in that person's language, not the last one it was edited in — so they live in the
application database ([ADR-004](#adr-004)), not in the work. The shape chosen now is the one every
later preference arrives into.

**Decision.** One table of key and value in the application database, and **the list of keys is
closed, in the host.** `language` takes `system`, `en` or `pt-BR`; `theme` takes `system`,
`light` or `dark`; `lens` takes `owner`, `architect` or `engineer`, and is `owner` until the
person chooses otherwise ([ADR-007](#adr-007)). A key outside the list is refused with the kind
`settings_key`, and a value outside its key's set is refused with a sentence that names what the
key accepts. A test holds the list: a key the interface writes and the host does not keep is a
red test, not a preference that silently never comes back.

**Why not a column per setting.** Every preference would be a migration, and migrations are
forward-only history ([`DATA_MODEL.md`](../DATA_MODEL.md)) — a preference later dropped would
leave a column behind forever. **Why not one JSON blob.** It has to be read, parsed and written
whole to change one word, and it puts a shape the host cannot check inside a column SQLite cannot
check. **Why not a free key/value table.** With nothing governing the key it becomes a junk
drawer — the place where state that should have had a shape is stashed — and nobody can say what
the application keeps by reading the schema.

**Cost accepted.** A new setting is a change to the host and to its test, not just to the
screen. The lens is a person's setting, so two people sharing one Windows account share it — a
lens stores nothing about the work, so the cost is a word choice, not data.

## ADR-014 — A lens is a vocabulary table over the glossary, and an arrangement; nothing is stored per lens {#adr-014}

**Status.** Accepted — 2026-09-25.

**Context.** "Three lenses, one model" is one of the specification's ADR-PROPOSED decisions, and
slice F1 is the one that makes it true: the lens switch changes every term through the glossary
and stores nothing, and the work breakdown and the owner's checklist are the same rows in two
arrangements (SPEC §7). The engineer calls a piece of work an _activity_ and reads it in a
numbered breakdown; the architect calls it a _work item_ and reads it by room; the owner calls it
a _job_ and reads it as a list of what is to be done. The easy way to build that — three screens,
three sets of labels written into three sets of components, perhaps a column saying which lens a
row belongs to — is three products that disagree with each other within a week.

**Decision.** A lens is two things and nothing else: **a vocabulary** and **an arrangement**.

- **The vocabulary is a table over the glossary.** A term in
  [`src/i18n/glossary.json`](../../src/i18n/glossary.json) may carry, per language, a `lenses`
  object — `{ "engineer": "…", "architect": "…", "owner": "…" }` — with the word that lens uses;
  a lens with no word of its own shows the term. The sentence that explains a term never varies
  by lens: a person switching lenses meets new words for the same things, not new definitions.
  The interface reads every domain noun through one lookup that resolves the language and the
  current lens together, so no screen can show one lens's word beside another's.
  `scripts/glossary.mjs` validates the table — lens names from the closed list, no empty word —
  and [`docs/GLOSSARY.md`](../GLOSSARY.md) shows it, for the terms that vary, beside the rest.
- **The arrangement is a pure function of the same rows.** The Plan shows the work three ways —
  the **breakdown** (numbered stages and activities, where editing lives), **by room** (each room
  with the activities that touch it) and the **checklist** (one line per activity in placement
  order) — each computed in `src/domain/` from the one snapshot of the work. A test holds the
  invariant that matters: the three arrangements contain exactly the same activities. The tab
  that opens first follows the lens — engineer, breakdown; architect, by room; owner, checklist
  — and any lens can open any tab.
- **Nothing is stored per lens.** The current lens is a setting of the person's
  ([ADR-013](#adr-013)), `owner` until they choose otherwise. The work database has no lens
  column and never will; switching the lens changes words and order on the screen and writes
  nothing to the work. The domain knows nothing about lenses: vocabulary is data in `src/i18n/`,
  and an arrangement takes no lens as input.
- **The checklist sets nothing.** Its box is a mark of the list, not a control: done arrives
  from the diary in F4 ([ADR-009](#adr-009)).

**Why.** One model with three vocabularies is the product's answer to the incumbents, who each
chose one reader. Keeping the vocabulary as data means a new term, or a better word for the
owner, is a change to one file that a gate checks — not a hunt through components. Keeping the
arrangements pure and computed from the same snapshot means they cannot drift: an activity
edited in the breakdown is the same row in the checklist on the next render, because there is no
second copy of it to update.

**Cost accepted.** Some words fit one lens badly in one language and well in the other —
Portuguese uses _serviço_ for both the architect's and the owner's word for an activity — and the
table has to say so term by term rather than by rule. Three arrangements are three layouts to
keep accessible in two languages and two themes. And because a lens is the person's setting, not
the work's, an engineer and an owner who share one machine account share one lens; since the
lens stores nothing, what they share is a word choice, never data.

## ADR-015 — One scheduling engine: Tessera's, copied literally and extended with the working calendar, lags and baselines {#adr-015}

**Status.** Accepted — 2026-09-25.

**Context.** The specification left the scheduling engine **PROPOSED** (SPEC §3): the critical
path of a sibling product, Tessera — `graph.ts` and `criticalPath.ts` — copied literally and
extended, rather than a second engine written from nothing, with KEYSTONE to confirm the choice in
F2 by a benchmark. The budget it has to meet is SPEC §4's: a work of 2 000 activities and 3 000
links scheduled in under 100 ms, and its Gantt drawn in under 500 ms, with three times that as
headroom in CI. Tessera's engine is the classical two-pass method — forward for the earliest
start, backward for the latest finish, slack as the difference, zero slack as critical — already
tested, but written for tasks measured in minutes, with no calendar, no lag and no notion of a
stage.

**Decision.** One engine, taken in two steps that stay visible in the history.

1. **Copied literally.** `src/domain/schedule/graph.ts` and `criticalPath.ts`, with their tests,
   are Tessera's files at commit `bdbfc4a`, byte for byte below a header that says where they came
   from. The copy is its own commit, so what was taken and what was changed can be read apart.
2. **Extended.** The unit becomes **working days**: whole numbers, offsets from day 0, the first
   working day on or after the work's start date; `toDates` maps offsets to ISO dates through the
   working calendar's `addWorkingDays`, so a weekend or a holiday is never a working day of any
   activity. Edges are **finish-to-start with a lag** of zero or more working days. The adjacency
   maps are built once per plan — no scan of a list of blockers inside a pass — and the
   topological order breaks ties through a position map, never by searching an array. The
   minutes helpers Tessera needed are removed; milestones stay in the shape and unused.
3. **Stages are endpoints, expanded before planning.** A dependency joins two activities, two
   stages, or one of each. Before the engine runs, a stage endpoint becomes every activity of the
   stage: _stage S before X_ is every activity of S before X, and the reverse. A dependency onto
   an empty stage expands to nothing and is **reported as inert**, never dropped in silence.
4. **Nothing constrains it, so it starts on day 0.** An activity with no dependency starts on the
   first working day — parallel work is the honest reading of an unlinked plan — and readiness
   gains a rule that says so (`activity.linked`, [ADR-008](#adr-008)): in a plan of two or more
   activities, one linked to nothing is not ready. Rules now say when they apply — a rule that
   does not apply to a row is neither known nor missing — so a plan of one activity has nothing
   to link, and still reads 1 of 2 on the two rules that do. The schedule replaces F0's placement in
   sequence entirely.
5. **A cycle is refused twice** — by the domain, which names the loop before the host is asked,
   and by the host, which refuses the dependency with the kind `dependency_cycle` and the chain of
   names. A stored plan that holds a cycle anyway (a file edited by hand) is planned as _cyclic_,
   and the screen says so instead of drawing a schedule that cannot exist.

**KEYSTONE's confirmation — the benchmark.** `src/domain/schedule/schedule.bench.test.ts`
builds a seeded work of 2 000 activities in 40 stages with 3 000 links and measures, over five
runs each, `schedule()` — expanding the stage endpoints, planning, and mapping offsets to dates —
and `ganttLayout()`. The medians are printed and asserted against the budget with CI's threefold
headroom: under 300 ms and under 1 500 ms, three times the specification's 100 ms and 500 ms.

| Measured (median of 5, seeded)                              | Median | Under coverage | Budget | Asserted   |
| ----------------------------------------------------------- | ------ | -------------- | ------ | ---------- |
| `schedule()` — 2 000 activities, 3 000 links                | 5.3 ms | 8.6 ms         | 100 ms | < 300 ms   |
| `ganttLayout()` — 2 040 rows, 919 day columns, 3 000 arrows | 5.4 ms | 6.2 ms         | 500 ms | < 1 500 ms |

On the development machine: Windows 11, Node 24, Vitest 4. Both are well under a tenth of their
budget; the copied engine's shape survives a work a hundred times larger than the ones it was
written for, and the choice is confirmed. The numbers are one machine's, not a promise about
every one — the assertion with headroom is what CI holds.

**Why one engine.** Two engines in two sibling products are two sets of bugs about the same
arithmetic. The copied one arrives with its tests, and the benchmark decides whether its shape
survives a work a hundred times larger than the ones it was written for — rather than a belief
that a rewrite would be faster.

**Cost accepted.** **Finish-to-start only**: start-to-start and finish-to-finish, which an
engineer will ask for, are not in 1.0, and a lag is waiting, never overlap. **No milestones.**
**No resource levelling**: two activities for the same person are scheduled side by side if
nothing links them; levelling is named as 2.0, not denied (SPEC R4). **Parallel by default**: an
unlinked plan finishes early on paper, which is why `activity.linked` makes it visible in
readiness instead of hiding it. And the copy is a fork: a fix in Tessera's engine is not a fix
here until somebody carries it over.

## ADR-016 — Baselines are insert-only from the first one {#adr-016}

**Status.** Accepted — 2026-09-25.

**Context.** "The plan is never rewritten in silence" is one of the specification's ADR-PROPOSED
decisions, and "no baseline overwritten" is half of requirement one (SPEC §4). A baseline is what
the plan said on the day it was approved: the slip is measured against it, and in a dispute it is
the record of what was agreed. F2 takes the first baseline; F8 asks for a reason on every change
after approval and compares any two. The question for F2 is whether the first baseline can be
written in a way F8 would have to tighten later — and the answer has to be no, because a row that
was ever updatable cannot be shown never to have been updated.

**Decision.** Baselines are **insert-only from the first one**, enforced in two places, as
[`SECURITY.md`](../../SECURITY.md) requires of every record.

- **In the schema** (migration 003). `baseline` and `baseline_activity` refuse `UPDATE` and
  `DELETE` with triggers. `INSERT OR REPLACE` would remove a row without firing a delete
  trigger when `recursive_triggers` is off, so each table also refuses an insert whose key is
  already there, before conflict resolution. Rows may be added only to the latest baseline, and
  `work.approved_at` cannot change once set. Every trigger raises `baseline: append-only`, so no
  code path — not the product's, not a script's through the database — can change or remove a
  row.
- **In the host.** The Rust module that writes baselines contains no `UPDATE` or `DELETE`
  statement, by rule. `baseline_take` receives the rows the domain computed — the schedule is the
  domain's ([ADR-003](#adr-003)) — checks that they name every activity of the work exactly once
  and nothing else, numbers the baseline one more than the last, and writes it in one
  transaction; the first also sets `work.approved_at`. Approving the plan is taking baseline 1.
- **A baseline holds a copy, not a reference**: each activity's name, its stage's name, its
  duration, and its start and finish on the day it was taken — so renaming or removing an
  activity later changes the plan and never the record of what the plan was.
- **What F2 does not do**, said plainly: the `reason` column exists and is empty; editing an
  approved plan does not yet ask for one; only the latest baseline is shown, and the slip is
  measured against it. F8 adds the reason, the next baselines and the comparison of any two.

**Why.** A table that starts insert-only needs no migration to become trustworthy later, and no
argument about what happened to its rows before it did.

**Cost accepted.** A baseline taken by mistake is there for good: it can be followed by another,
never withdrawn. Every baseline copies every activity row, so a work approved many times carries
many copies — cheap at this scale, and the price of a record that does not depend on rows that can
change. And between F2 and F8 an approved plan can be edited with no reason asked: the slip shows
that it moved, not why.

## ADR-017 — A decision's deadline is computed, never stored {#adr-017}

**Status.** Accepted — 2026-09-25.

**Context.** "A decision's deadline is computed" is one of the specification's ADR-PROPOSED
decisions (SPEC §3): the last responsible moment to decide is the earliest start of what needs
the decision, minus its lead time, on the working calendar — and it moves when the schedule
moves, with nobody maintaining it. Slice F3 makes it true. The tile chosen the day the tiler
arrived is the product's first example of a build going wrong (SPEC §1): the tile had a lead
time, nobody counted it backwards from the tiling, and no date in anybody's notes moved when
the tiling did. A deadline typed by hand is exactly that note.

**Decision.**

- **A decision belongs to a stage** and holds a name ("Which tile"), a **lead time** in working
  days (0 to 3650 — how long between deciding and having what was decided on site), its order in
  the stage, and, once made, when (`made_at`) and an optional answer. Nothing else is stored
  (migration 004): **no deadline column, and no overdue column**. An answer belongs to the
  making — a decision that is not made has none, and reopening clears both.
- **The deadline is computed** by the domain every time: the earliest scheduled start among the
  stage's activities, from the F2 schedule ([ADR-015](#adr-015)), minus the lead time, counted
  backwards in working days on the work's calendar — a lead time of 0 is the earliest start
  itself. A stage with nothing scheduled — no durations yet, or a plan with a cycle — gives
  **no deadline**, and the decision says so in words ("not yet known — nothing in this stage is
  scheduled") instead of showing a date nobody can stand behind. Add a lag before the stage, and
  the deadline moves by the same working days.
- **Today is an input.** The domain never reads the clock. The interface computes the local
  calendar day in one place and passes it in; the tests pass whatever day they are about. A
  decision is **made**, **overdue** (its deadline is before today), **due** (with the working
  days left, 0 meaning today) or **unknown** (no deadline). A made decision is never overdue,
  whatever its deadline was.
- **Overdue on creation is said, not refused.** A lead time longer than the time left makes a
  decision overdue the moment it is added. The plan must be able to say that truth, so the
  decision is kept and the row says, at once, how late it already is — refusing it would teach a
  person to type a shorter lead time than the real one.

**Why.** A deadline that is computed cannot be stale: it is recomputed from the schedule and the
calendar every time it is shown, so the tiling slipping a week moves "Which tile" a week with
it. A deadline that is typed is right on the day it is typed. And a domain that takes today as
an input is one whose every date rule — overdue, due in three days, due today on a weekend — can
be tested on any day of the year.

**Cost accepted.** In 1.0 **a decision is needed by its whole stage**: its deadline counts from
the stage's earliest start, not from the one activity that actually needs it. A tile decision in
a stage whose first activity is removing the old tile is due earlier than it has to be. Tying a
decision to one activity is a later record if it earns one. A decision in a stage with nothing
scheduled has no deadline, and counts against readiness until the stage is scheduled
([ADR-018](#adr-018)). And because today is the machine's local day, two people looking at the
same work on either side of midnight can see a decision as due and as overdue — which is true.

## ADR-018 — Readiness is explained rule by rule, and the rules sum to the figure {#adr-018}

**Status.** Accepted — 2026-09-25.

**Context.** Slice F3's proof is "readiness rule by rule with its explanation; what the plan
does not know is a list that opens onto each row" (SPEC §7). [ADR-008](#adr-008) made readiness
a figure computed from rules that are data. With five rules — three about activities, two about
decisions — a single percentage no longer says enough: _62 %_ could be every duration missing or
every decision late, and those are different evenings for the person reading it. And F2 showed
that a rule does not always have a question to ask: a plan of one activity has nothing to link.

**Decision.**

- **A rule says when it applies, and a rule that does not apply is neither known nor missing.**
  Each rule in `src/domain/readiness/rules.ts` has `applies` and `holds`. Where it does not apply
  it is not counted at all, so it cannot move the figure: one activity with a duration and no
  responsible still reads 1 of 2, not 1 of 3. The five rules and when each applies are in
  [`DATA_MODEL.md`](../DATA_MODEL.md), in words.
- **The rules sum to the figure.** `readinessByRule` returns one summary per rule, in the rules'
  order — its known, its must-know and its missing rows — and each is a figure of its own that
  opens onto its rows. A test holds that the rules' known and must-know add up exactly to the
  whole figure's: there is no row the figure counts and no rule explains, and none the other
  way round.
- **Every rule has an explanation**: one sentence, in both languages, that says why the plan must
  know it — "Without a duration nothing can be scheduled." — shown under the rule when it is
  opened. The rule's count says _what_ is missing; the explanation says _why it matters_.
- **The dashboard shows both readings.** Under the readiness figure, one line per rule — "Durations
  · 4 of 4", "Decisions in time · 0 of 1" — each a button that opens onto that rule's rows with
  its explanation; and "what the plan does not know" stays the flat list of every missing row,
  grouped under the rule it fails. Two readings of one fact, computed from the same rows in the
  same call (`DESIGN_SYSTEM.md` §2).
- **Two rules about decisions arrive** ([ADR-017](#adr-017)): every decision must have a
  deadline — its stage has something scheduled; and every decision whose deadline is known must
  be made, or not yet overdue.

**Why.** A figure that can be opened is a fact the reader checked (ADR-008); a figure that can be
opened rule by rule is one they can act on in order. The sum is what keeps the two readings
honest: a per-rule list that did not add up to the headline would be a second opinion about the
same plan.

**Cost accepted.** Every rule still weighs the same, per row ([ADR-008](#adr-008)): one overdue
decision counts as much as one missing duration, although it may cost more. A decision in a
stage with nothing scheduled is counted once, as missing its deadline, and is not asked whether
it is in time until the stage is scheduled — so a decision that will be late the day its stage
is scheduled does not say so before. The rule-by-rule list is where that is visible: the
decision is under "no deadline yet", with the reason, not absent. That is why the explanation exists.

## ADR-019 — The diary is append-only with a hash chain, and a correction is a new entry {#adr-019}

**Status.** Accepted — 2026-09-25.

**Context.** Requirement one of the specification is that no diary entry is lost (SPEC §4), and
the diary is the half of the thesis that is fact: the plan is intent, the diary is what happened
(SPEC §1). A diary that can be edited after the fact is a notes app; a diary that cannot be
corrected is one people stop writing, because a wrong entry would stand forever. And a person in
a dispute with a contractor will want to know whether the record has been touched since it was
written — which the product can show, and must not overstate.

**Decision.**

- **An entry is a fact about one day.** It carries the day (never in the future — refused by the
  domain against today and by the host against its own clock), what was done, who was there, the
  weather, hours, deliveries, incidents, visitors, a note, and its photos, written with its
  children in one transaction. A second entry on a day that already has one is allowed and
  ordered; a replacement is not, because there is no way to replace.
- **Append-only, twice** ([`SECURITY.md`](../../SECURITY.md)). In the schema, triggers refuse
  `UPDATE`, `DELETE` and `REPLACE` on the four diary tables; a guard before insert refuses a
  sequence number that exists, so `INSERT OR REPLACE` cannot reach a row whatever
  `recursive_triggers` is set to; and the chain trigger refuses an entry that is not the next in
  sequence or does not carry the previous entry's hash. In the host, the Rust module that writes
  the diary holds no `UPDATE`, `DELETE` or `REPLACE`, and a test reads its source to prove it.
  There is no edit command.
- **A correction is a new entry.** It names the entry it corrects, restates the whole day — what
  was done, who was there, the photos, which it may re-attach by hash without copying anything
  twice — and says what was wrong in a required note. For everything derived from the diary, an
  entry that has been corrected contributes nothing and its latest correction contributes
  instead; a correction may itself be corrected. The day view shows the original struck through,
  "corrected by #N", beside the correction. The interface offers _Correct…_ where an edit would
  be expected, and says why.
- **Each entry carries the hash of the one before.** The hash is SHA-256 over a canonical,
  deterministic serialisation of the entry and its children (in
  [`DATA_MODEL.md`](../DATA_MODEL.md)), computed by the host before the insert. `diary_verify`
  recomputes every hash and every link and answers "N entries, chain intact" or "broken at #k"
  with the reason; Diagnostics runs it on demand. `cargo test` tampers with a work file through a
  second, plain connection — triggers dropped, a note rewritten, a photo hash moved, a row
  deleted — and shows the verification fails at that entry.
- **The author is the Windows account's name.** The product has no accounts and no login
  ([ADR-006](#adr-006)); the host reads the display name of the account that is running it and
  writes it on each entry. It is what the machine says, not an identity the product vouches for.

**What the chain is, said plainly.** It is **tamper-evidence**: it shows whether the record has
been altered since it was written. It is not a signature, it does not prove who wrote an entry,
and it is not legal proof — somebody with the file can rewrite every entry and recompute every
hash. Nor can it see entries removed from the _end_ of the diary: the last entry has no
successor to point at it, and the export (F10) records the count and the last hash so that a
copy kept elsewhere can. What a diary is worth in a dispute is the jurisdiction's to decide.
The product says this in Diagnostics, in the export header (F10) and here, and never claims
more (SPEC R6).

**Why.** A record that can only grow is one a person can trust with a disagreement; a correction
that stands beside what it corrects is more honest than an edit that erases it. Enforcing it in
the schema as well as the host means no code path — the product's, a script's, a future bug's —
can quietly change the past.

**Cost accepted.** A wrong entry is there for good, struck through. A day with three corrections
shows four entries. Every entry costs a hash computed over its children, and every verification
reads the whole diary — cheap at SPEC §4's 3 000 entries, and measured there. The author name is
whatever Windows says, so two people sharing one account are one author. And the chain proves
less than a person may hope, which is exactly why the product says what it proves.

## ADR-020 — Progress is derived from the diary, in states, never as an invented number {#adr-020}

**Status.** Accepted — 2026-09-25.

**Context.** "The plan is intent and the diary is fact" is the first of the specification's
ADR-PROPOSED decisions. [ADR-009](#adr-009) made half of it true in F0: there is no command,
column or control that sets progress. F4 makes the other half true: progress, actual dates and
the people on site are derived from diary entries. The temptation is a percentage on every bar —
"60 % done" — and a percentage the site never measured is precisely the number ADR-009 exists to
refuse.

**Decision.** Progress is computed by the domain from the effective entries (corrections
applied, [ADR-019](#adr-019)) every time, and never stored.

- **An activity is in one of three states**: _not started_, _started_ (the diary says somebody
  worked on it) or _finished_ (the diary says it was finished), with the day it started and the
  day it finished taken from the first entries that say so.
- **A share only when the site measured one.** When an activity has a planned quantity and the
  diary records done quantities, the share is their ratio — held at most 99 % until the diary says
  _finished_, and 100 % only then. Otherwise there is **no number**: the state is the whole
  answer, and no screen shows a percentage the diary did not produce.
- **A stage's progress is counts**: how many of its activities are finished, started and not
  started. The work's _Done_ figure on the dashboard is the same counts, opening onto the
  activities.
- **Where it shows.** The owner's checklist ticks a line when the diary says finished; the Gantt
  fills a bar by state — solid when finished, marked when started — with the planned bar kept and
  the actual start and finish drawn as a thin line; the dashboard adds days without an entry and
  weather days lost. The slip still compares the plan with its baseline ([ADR-016](#adr-016));
  comparing actuals with the baseline is F8's and F10's.

**Why.** A state is a fact the diary can support; a percentage without a measurement is a guess
shown as a fact, and every figure derived from it would inherit the guess. Keeping progress
derived is what makes the Gantt, the checklist and the dashboard agree with each other and with
the site: they read the same entries.

**Cost accepted.** An engineer used to "percent complete" gets three states and, only where a
quantity was measured, a share. An activity half done but not measured reads _started_ for as
long as it takes. Nothing is progress until somebody writes an entry — a site that keeps no
diary shows no progress at all, and the dashboard counts the days without an entry so that the
silence is visible (SPEC R2).

## ADR-021 — Photos are copied by the host under caps and shown as data URLs {#adr-021}

**Status.** Accepted — 2026-09-25.

**Context.** Photos are the first files from somebody else that the product keeps: from a phone,
a messaging app, a download. [`SECURITY.md`](../../SECURITY.md) says every one is hostile until
measured. They have to be kept with the work — a folder that is moved takes them with it
([ADR-004](#adr-004)) — and shown on screen, which for a Tauri application usually means
granting the webview a file-system permission or the asset protocol, so that it can read files
off the disk by path.

**Decision.**

- **The host copies; the webview never touches a file.** An entry names the files the person
  chose in the dialog or typed; the host reads each one, and refuses it with a sentence naming
  the file and the reason if it is over **25 MiB**, if its **magic bytes** are not JPEG, PNG,
  WebP, GIF or BMP (HEIC is refused by name — 1.0 does not decode it), or if its **dimensions**,
  read from the header without decoding, exceed **12 000 × 12 000**. It then hashes the bytes
  (SHA-256) and copies them to `documents/<hash>.<ext>` inside the work folder, the extension
  from the detected type and never from the name. A photo already there is referenced by its
  hash, never copied twice.
- **Thumbnails under limits.** A 320 px JPEG thumbnail is rendered to `thumbnails/<hash>.jpg` by
  the `image` crate with its decoding limits set — width, height and at most 256 MiB of
  allocation. A photo whose thumbnail cannot be made is kept, marked, and says so on screen.
- **One entry, one transaction.** A refused photo refuses the whole entry, and any file already
  copied for it is removed: nothing is half-written.
- **Shown as data URLs.** `photo_thumbnail(hash)` returns the thumbnail as a `data:image/jpeg`
  URL, which the content security policy already allows. There is **no asset protocol and no
  file-system permission** in the capabilities: the webview cannot read any path at all.
- **Opened by the operating system, from Rust.** `photo_open(hash)` opens the original with the
  system's own handler, on the person's click, through the opener plugin used as a Rust
  dependency only — no JavaScript permission is granted for it.
- **The corpus is in `cargo test`.** A text file named `.jpg`, a PNG header that claims 100 000
  pixels, a truncated JPEG, an empty file and a 26 MiB file are each refused with a sentence, and
  nothing is written.

**Why.** The copy is what keeps a work self-contained. Measuring before decoding is what keeps a
crafted file from costing more than its size. And a webview that can read no path cannot be
talked into reading the wrong one: every byte it shows passed through a command that checked it.

**Cost accepted.** A data URL is larger than the file it carries and passes through the command
boundary; it is sized for thumbnails, and the original is never shown inside the product — it is
opened by the system's viewer. HEIC, the default on many phones, is refused in 1.0 with a
sentence that says so. Documents other than photos — quotes, drawings, permits — are F7's, under
the same rules.

## ADR-022 — A stage's gates are answered facts, and a closed stage is closed {#adr-022}

**Status.** Accepted — 2026-09-27.

**Context.** The electrician who came before the wall was closed and had to come back is the
specification's second example of a build going wrong (SPEC §1). Every stage has things that
must be true before it starts — the previous stage closed, the material on site, the area
protected — and things that must be true before it closes — the work inspected, the photos taken,
the owner walked it (SPEC §2.7). Slice F5's proof is that a stage cannot close with an
unanswered item, that _not applicable_ needs a reason, and that the inspection is a check with a
photo. Three questions had to be answered: what a stage's state is, what an answer is, and what
"closed" forbids.

**Decision.**

- **A stage has a lifecycle the person decides** — _planned_, _started_, _closed_ — stored as
  `stage.started_at` and `stage.closed_at`, both empty while it is planned. It is **intent**, not
  progress: progress still comes only from the diary ([ADR-020](#adr-020)). Starting a stage
  needs its **start gate** passed; closing it needs its **close gate** passed, and a stage that
  has not started cannot close.
- **Starting cannot be undone; closing can.** A stage started by mistake is a fact of the record,
  and the confirmation says so before it happens; a trigger keeps `started_at` from changing once
  set. A closed stage may be **reopened** — people
  close things too early, and the diary keeps what actually happened — which clears
  `closed_at` and nothing else.
- **A check is a question at one gate**: a name, a gate (_start_ or _close_) and an order, edited
  per work in the breakdown. A check that has been answered cannot be removed — its answers are
  facts — though it can be renamed; and so a stage whose checks were answered cannot be removed.
  The table is `stage_check`, because CHECK is a word SQL keeps for itself.
- **An answer is a fact — append-only, not chained.** _Yes_, _no_ or _not applicable_, with a
  reason (required for _not applicable_), an optional photo, the account's name and the moment.
  Answers are insert-only with the same battery of triggers as the diary
  ([ADR-019](#adr-019)); answering again appends, and the latest answer counts. There is **no
  hash chain**: the chain is the diary's, where the record is the day; a gate's history is short,
  local to one check, and already protected against edits by the schema and the host.
- **A gate is passed when every check at it has a latest answer of yes or not applicable.** An
  unanswered item or a _no_ holds it. The domain computes which items hold a gate, and the
  interface says so, naming them, instead of asking the host and being refused; the host refuses
  too (`stage_gate_open`), naming the items, as the second guard.
- **The inspection is a check with a photo.** An answer may carry a photo, copied by the host
  exactly as a diary photo is — the same caps, the same folder, the same thumbnail, the same
  corpus ([ADR-021](#adr-021)). Nothing new enters the photo pipeline.
- **A closed stage is closed.** Its activities cannot be added, changed, moved or removed, its
  rows cannot be renamed, and no dependency may make one of its activities wait for something
  else — each refused by the domain and by the host (`stage_closed`) with a sentence that says to
  reopen it first. What a closed stage's activities _blocked_ may still depend on them. The diary
  may still write about them: an entry is a fact about a day, not an edit of the plan.
- **The usual checks, until templates.** "Checks come from the template" (SPEC §7) — and
  templates are F9's. Until then, a stage offers **the usual checks**, a small list in the domain
  (four at each gate), inserted by a button as ordinary checks in the person's language. F9
  replaces the list with the template's checks; the shape does not change.
- **Readiness asks for them.** A sixth rule, `stage.checks`: every stage has at least one check
  on each gate — the specification's "every stage has … its checks defined" (§2.5).

**Why.** A gate that is a list of answered questions, each with who answered and when, is one a
person can check and argue from; a gate that is a switch is one somebody flipped. Keeping the
lifecycle as intent keeps the plan and the diary from contradicting each other: the stage says
what the person decided, the diary says what happened. And a closed stage that can still be
edited is not closed.

**Cost accepted.** A wrong answer stays in the history, superseded by the next one; a check that
was answered cannot be removed, only renamed, and a stage with answered checks cannot be removed. A started stage cannot be un-started, so a
mis-click is permanent — which is why the confirmation says so. Reopening is allowed, so
"closed" is a decision that can be revisited, not a seal; the answers that closed it stay. The
usual checks are generic until templates arrive, and a person who needs other questions writes
them. And answers carry no chain: tampering with a gate's history through the file, with the
triggers dropped, is not detected the way the diary's is.

## ADR-023 — Money is three facts with three sources, in minor units, and the ledger is append-only {#adr-023}

**Status.** Accepted — 2026-09-27.

**Context.** "The money ran out in the stage nobody had priced" is the specification's third
example of a build going wrong (SPEC §1). Slice F6's proof is planned, committed and paid per
stage and per trade, a payments ledger with receipts, every figure opening onto its rows, paid
over committed flagged, and an S-curve of planned against paid (SPEC §2.8, §7). The easy model —
one "amount" column per stage, edited as the work goes — cannot say what was agreed, what was
paid, or when either changed; and a ledger that can be edited is not a ledger.

**Decision.**

- **Three amounts, three sources, never one column edited three ways.**
  - **Planned** is what the plan expects to spend: **cost lines**, typed on a stage or on one of
    its activities — a label and an amount, several per row. A stage's planned amount is its own
    lines plus its activities'. Cost lines are plan, and are edited like plan.
  - **Committed** is what somebody agreed to: **commitments** — a quote or a contract accepted,
    with its stage, the person or trade, a label, an amount, the day it was agreed and optionally
    the quote itself. A commitment can be changed or removed only while nothing has been paid
    against it; after that it is part of the record.
  - **Paid** is what left somebody's account: the **payments ledger** — the day, the stage, the
    person, the commitment it pays if any, the amount, what it was for, a receipt, the account's
    name and the moment.
- **Amounts are whole numbers of minor units** — cents — in `INTEGER` columns, in the work's
  one currency ([ADR-004](#adr-004), `work.currency`). No amount is ever a floating-point number,
  in the schema, the host or the domain; the interface reads what a person types in major units
  and formats with the platform's own number formatting for the work's currency and the person's
  language.
- **The ledger is append-only, with reversals.** A payment is never edited or removed: the same
  battery of triggers as the diary and the gate answers ([ADR-019](#adr-019),
  [ADR-022](#adr-022)) refuses `UPDATE`, `DELETE` and `REPLACE`, and payments are numbered in
  order. A mistake is a **reversal**: a new payment with a negative amount that names the one it
  reverses, with a required note. Only a reversal may be negative, and it must be; it may not
  exceed what it reverses, may not reverse another reversal, must name the same stage, person and
  commitment as the payment it reverses, and a payment may be reversed once — each refused by a
  trigger with `money: reversal`. A stage, a person or a commitment that a payment names cannot
  be removed: nothing that was paid disappears. The domain applies reversals everywhere a paid amount
  is shown.
- **No chain.** The hash chain is the diary's, the spine of the record; the ledger is protected
  by the schema and the host, as the baselines and the gate answers are.
- **Receipts are images in F6.** A receipt goes through the photo pipeline — the same caps,
  copy, hash and thumbnail ([ADR-021](#adr-021)). A PDF receipt is a document, and documents are
  F7's; until then a receipt is an image or nothing, and the interface says so.
- **Per trade.** A person gains a trade; money per trade groups commitments and payments by the
  trade of the person they name, and people with no trade yet are grouped as such, not dropped.
- **Readiness asks for it.** A seventh rule, `stage.money`: every stage has at least one cost
  line, its own or an activity's — the specification's "every stage has … its money planned"
  (§2.5). The totals of readiness move again, and the rule-by-rule list says why
  ([ADR-018](#adr-018)).

**Why.** Three sources make three questions answerable: what did we expect, what did we agree,
what did we pay — and the differences between them are the variance and the remaining, not
somebody's recollection. Integers make money add up: a sum of cents is exact, and a sum of
floating-point amounts is not. And a ledger that only grows is one both sides of an argument can
read.

**Cost accepted.** A payment typed wrongly stays, followed by its reversal: two lines where a
person expected to fix one. A commitment cannot be corrected once something was paid against it
— a new commitment says what changed. A stage or a person that a payment names can never be
removed from the work. One currency per work; a build paid in two is out of 1.0.
Payments travel in the work's snapshot, which is right for the thousands a house might have and
would need a query of its own at a scale 1.0 does not target. And the ledger carries no chain:
tampering through the file with the triggers dropped is not detected as the diary's would be.

## ADR-024 — Every money figure carries its rows, and paid over committed is flagged, not refused {#adr-024}

**Status.** Accepted — 2026-09-27.

**Context.** [ADR-008](#adr-008) made "a figure carries its rows" the product's first rule, for
readiness. Money is where a number without its rows does the most harm: a stage "12 % over
budget" is an accusation until it can be opened onto the lines that make it. And a payment
larger than what was agreed is common on a real site — extras, a change of material, a day of
work nobody quoted — and is precisely what the owner needs to see, not what the product should
stop.

**Decision.**

- **A money figure is a figure of unit `money`** — an amount in minor units and the rows it was
  added from — and it opens onto them. Its rule is exact: the value is the sum of its rows. Per
  stage, per trade and for the work, the product shows **planned** (the cost lines), **committed**
  (the commitments), **paid** (the payments, reversals applied), **remaining** — planned minus
  paid, whose rows are both sets, signed — and **variance** — committed minus planned, likewise.
  The stages sum to the work; a test holds it.
- **Paid over committed is flagged, not refused.** A payment that takes a stage or a commitment
  past what was committed — or that pays against no commitment at all — is recorded, and marked
  _over committed_ with the excess, in words and not by colour alone. The dashboard counts the
  stages paid over what was committed, opening onto them.
- **The S-curve says what it cannot place.** Planned money is spread over time by the schedule:
  each cost line evenly over its activity's scheduled working days, a stage's line over the
  stage's span. A line with nothing scheduled to spread it over is placed at the work's start and
  the chart says so. Paid money is placed on each payment's day. The chart is a picture; a table
  beneath it, by week, is the reading a screen reader and a careful person use.

**Why.** A money figure a person can open is one they can check against their own papers. A
refusal would push an honest extra payment out of the product and into a notebook, and the
ledger would stop being the record; a flag keeps it in, and says what it means.

**Cost accepted.** Over committed is a mark the person has to read, not a stop — somebody who
pays twice by mistake is told, not prevented; the reversal is the way back. The S-curve's
planned line is only as good as the schedule under it, and an unscheduled plan front-loads its
money at the start, visibly.

## ADR-025 — A document is a file the work owns, typed by its bytes, deduplicated by its hash, and never parsed {#adr-025}

**Status.** Accepted — 2026-09-27.

**Context.** A build runs on paper: the quote, the drawing, the permit, the receipt, the
contract, and a phone full of photos (SPEC §2.10). F4 made photos safe to keep ([ADR-021](#adr-021));
F7's proof is that any file attached to the work is copied in with its hash and caps, that **the
hostile file corpus is refused with a sentence**, and that a moved work folder is found again.
The formats a person will try to attach are endless, and every one the product decodes is code
that reads somebody else's bytes. And F4 stated a gap plainly: `diary_verify` checks the rows,
not the files on disk.

**Decision.**

- **A document is a file the work owns.** It is copied by the host into
  `documents/<sha-256>.<ext>` inside the work folder, and recorded as a row — its hash, the name it
  arrived with, its type, its size, its dimensions if it is an image, a **kind** (_photo_, _quote_,
  _drawing_, _permit_, _receipt_, _contract_, _other_), an editable title, the day, the account's
  name. It is **attached** to the work, a stage, an activity, a decision, a diary entry, a
  commitment or a payment by links, any number of each. The original location is never kept.
- **Typed by its bytes, never by its name.** The type table is short on purpose: **JPEG, PNG,
  WebP, GIF and BMP** are images, measured and thumbnailed exactly as in F4; **PDF**, recognised
  by `%PDF-` at the start, is a document. **Everything else is refused** with a sentence naming
  the file — a Word file, a spreadsheet, an archive, an executable, HEIC. The extension on disk
  comes from the type the bytes are; a PNG named `.pdf` is kept, as the PNG it is, under its own
  name. The cap is 25 MiB for every file.
- **A PDF is never parsed and never rendered** in 1.0. The product reads its first bytes, its
  size and its hash, and nothing else; on screen it is a mark and a name, and it opens in the
  system's own viewer on the person's click. A PDF parser is a large attack surface, and the
  product has no need to look inside a quote to keep it.
- **SVG is refused.** An SVG is a document that can carry scripts and references to other files;
  the product does not keep one in 1.0, and says why.
- **Deduplicated by hash.** A file already in the folder is linked again, never copied twice.
  Removing a document removes its row and its links; **the file is deleted only when nothing else
  names its hash** — no other document, diary photo, answer photo, receipt or commitment — and
  otherwise stays, with a sentence that says so. The diary's rows are never touched.
- **Photos are documents.** From F7 on, every photo, receipt and quote copied in is also a
  `document` row; migration 008 creates one for every file an earlier slice copied, linked to where
  it came from. Diary and answer photos still accept images only: a PDF is not a photo.
- **Each file is its own transaction.** Adding ten files where one is refused keeps the nine and
  names the one, with its reason. A batch of documents is not a diary entry
  ([ADR-019](#adr-019)), which is refused whole.
- **The corpus is the gate.** A generator in `cargo test` builds the hostile files — a text file
  named `.jpg`, a PNG that claims 100 000 pixels, a truncated JPEG, an empty file, a 26 MiB image,
  a 26 MiB PDF, an executable named `.pdf`, a zero-width PNG, a WebP with a lying size, a HEIC, an
  SVG, a zip bomb named `.pdf` — and every one must be refused with a sentence and nothing
  written; a thirteenth, a PNG named `.pdf`, must be kept as the PNG it is. The files are never committed; their SHA-256 manifest is, under
  `fixtures/hostile/MANIFEST.json`, and a test fails when the generator drifts from it (an ignored
  _bless_ test rewrites it deliberately).
- **The bytes are verified too.** Diagnostics' _Folder health_ reads every file in `documents/`
  and compares it with its row's hash (`documents_verify`), lists rows whose file is missing, and
  lists files no row names — **orphans, listed and never deleted by the product**. This closes the
  gap F4 stated: the chain vouches for the diary's rows, and now the bytes they name are checked.
- **A moved folder is found again.** A recent work whose folder is gone offers _Find it…_; the
  host opens the chosen folder, checks that its `work.sqlite3` carries the same work identity, and
  updates the recent list — a folder holding a different work is refused, naming both.

**Why.** Every format the product decodes is a decoder an attacker can reach with a file. Keeping
two families — images, which the product must show, and PDFs, which it never opens — keeps that
surface to the image decoders F4 already bounded. Deduplication by hash makes a file one fact
however many places it is attached; keeping orphans rather than deleting them means the product
never destroys a file it cannot account for.

**Cost accepted.** No Word, spreadsheet, CAD or DWG file, no SVG and no HEIC: a person converts to
PDF or JPEG first, and the sentence says so. A PDF shows as a mark, not a preview. Orphan files
stay until a person removes them by hand. A document kept for another link stays on disk after
it is removed from the library, which surprises somebody who expected it gone — the sentence is
the answer.

## ADR-026 — A person is a contact with stages, and presence comes from the diary {#adr-026}

**Status.** Accepted — 2026-09-27.

**Context.** People are the tiler, the electrician, the architect, the inspector (SPEC §2.9):
somebody to call, on the stages they are expected on, with what they are owed. The spec is
explicit that there are no accounts and no logins — a person is a row, not a user — and that who
was on site comes from the diary.

**Decision.**

- **A person is a contact**: a name, a trade (F6), a phone, an e-mail, a note and their
  availability as the person writes it ("mornings only", "from October"), and the **stages** they
  are expected on. A phone and an e-mail are text somebody typed: the product never dials, sends
  or looks anything up — it has no network ([ADR-006](#adr-006)) — and checks only their length.
- **Presence comes from the diary.** The days a person was on site, and the last one, are derived
  from the effective diary entries that name them ([ADR-019](#adr-019), [ADR-020](#adr-020)) —
  never typed on the person. What they are owed comes from money ([ADR-023](#adr-023)).
- **Where people live.** No new destination: the breakdown's People card is where they are
  edited, and a **People** tab on the Plan lists everyone with their stages, their days on site,
  their last day and what they are owed.
- **Readiness is unchanged.** The specification names no readiness rule for contacts or
  documents, and none is invented.

**Why.** A contact list that knows the stages and the diary answers the questions a site asks —
who is due, who came, who is owed — without a second record to keep in step.

**Cost accepted.** A person's days on site are only as good as the diary: somebody who came and
was not written down did not come, as far as the product knows. There are no accounts, so a
person cannot see or confirm their own record. And contact details are stored in the work file
like everything else — not encrypted at rest ([`SECURITY.md`](../../SECURITY.md)).

## ADR-027 — An approved plan is locked until somebody says why: a replanning is a row, closed only by the next baseline {#adr-027}

**Status.** Accepted — 2026-09-28.

**Context.** "The plan is never rewritten in silence" is the half of requirement one still open
(SPEC §2.11, §4). F2 made baselines insert-only and took the first one on approval
([ADR-016](#adr-016)), and named its own cost plainly: from then until F8, an approved plan could
be edited with no reason asked, and the slip showed that it moved, never why. Slice F8's proof is
that editing an approved plan asks for a reason and makes baseline N+1. Three ways of asking were
weighed. A reason at **every edit** turns one change of mind — the tiles arrive two weeks late,
so three durations and a link move — into three prompts and three reasons, and people answer the
third with "same". A reason asked only **when the next baseline is taken** leaves every edit
before it silent, which is what F2 already had. A **replanning mode** in the interface is the
interface's word, not the file's: it is gone at a restart, and the host could not refuse an edit
it cannot see.

**Decision.**

- **An approved plan is locked.** Once `work.approved_at` is set, every command that changes what
  a baseline records is refused by the host with a new error kind, `plan_approved` — "The plan is
  approved. To change it, replan it with a reason first." — unless a replanning is open. The
  locked commands are the stages (add, rename, remove, move), the activities (add, remove, move,
  and a change of name or duration), the dependencies (add, change, remove), the calendar
  (working days, hours, holidays), the work's start date, and the cost lines (add, change,
  remove), because money is compared between baselines ([ADR-028](#adr-028)).
- **Facts stay free.** The diary, gate answers, starting, closing and reopening a stage,
  payments, commitments, decisions, people, rooms and documents are never locked, and neither is
  what a baseline does not record: an activity's responsible, its rooms and its quantity, and the
  work's name, place and currency. A lock on a fact would push the fact out of the product.
- **A replanning is a row, not a mode.** `replanning` holds the reason (1–2 000 characters, not
  blank), when it was opened, the account's name, and — once it is over — when it closed and the
  number of the baseline that closed it. At most one is open, held by a unique index over the
  open rows. `replan_open(reason)` requires an approved plan, no replanning already open and a
  reason that is not blank, and refuses each with a sentence; it survives a restart because it is
  in the file. The row is **written once**: triggers refuse its removal, a replacement, and every
  change but its one closing, each with `replanning: written once`.
- **Only the next baseline closes it.** `baseline_take` for baseline 2 and after **requires an
  open replanning** — without one it is refused with `plan_approved`, "A second baseline needs the
  reason the plan changed" — copies the replanning's reason into `baseline.reason`, and closes the
  replanning, in one transaction. Baseline 1 is the approval and keeps `reason` empty. There is
  **no abandon and no discard**: an edit made while a replanning is open is already in the file,
  and the only honest way out of it is a baseline that records it.
- **Refused by the host, said by the interface.** The domain knows the lock (`isLocked`: approved
  and no replanning open) so the interface can say it before anything is tried: the breakdown
  shows the sentence with a **Replan…** button, and the Schedule's baseline card becomes the
  control — **Replan…** when none is open; "Replanning since …" with the reason and **Take
  baseline N+1** when one is. No control is disabled for the lock: an edit tried anyway is
  refused by the host, and its sentence appears where the edit was tried, as a closed stage's
  does ([ADR-022](#adr-022)).

**Why.** One reason per change of mind is what a person can actually give, and it lands where it
is read later: on the baseline the change produced, next to what moved. A row that the host
checks cannot be walked around by a screen, and a replanning that survives a restart is one
nobody loses between the edit and the baseline.

**Cost accepted.** There is no abandon: somebody who opens a replanning and regrets it takes the
next baseline anyway — identical to the last if they put everything back — with a reason that
says "reverted", and the record keeps that they thought about it. A typo in an activity's name
after approval needs a replanning, because the name is in the baseline. The lock is exactly as
wide as its list: a command added later that changes what a baseline records must join it, and
the host's tests hold the list, not the principle. And `replanning` is not an append-only table:
the baseline that closes it writes its end into the row, once. It is guarded as written once
rather than as part of requirement one, because the record it exists for — the reason — is copied
into the baseline, which is insert-only ([`SECURITY.md`](../../SECURITY.md)).

## ADR-028 — Any two baselines compare in the domain; a what-if is never written {#adr-028}

**Status.** Accepted — 2026-09-28.

**Context.** Once a plan has more than one baseline, the question a dispute asks is not "what does
the plan say" but "what changed between what we agreed then and what we agreed later, and why"
(SPEC §2.11). F8's proof is that **any two baselines compare** with dates moved, stages added or
removed, money changed and the reasons between them, and that a what-if that is not saved is not
a baseline. F2's baselines copied each activity and nothing else: a stage with no activities, and
the money planned, were not in them.

**Decision.**

- **Baselines learn stages and money** (migration 009, with migration 003's insert-only battery).
  `baseline_stage` copies each stage — its id, position and name — with its planned money;
  `baseline_activity` and `baseline` gain the planned money of the activity and of the whole
  work, in cents. The host reads these from the file inside the baseline's transaction, as F2
  does for names: the draft the interface sends still carries only the placements the domain
  computed.
- **Old baselines say what they did not record.** Migration 009 backfills `baseline_stage` for
  every baseline taken before it, from the stage names its activity rows copied, in the order
  they first appear: the id is the stage's own while one of its activities is still in the plan,
  and otherwise an id derived from the name, the same in every baseline. Their money is `NULL`,
  which means **not recorded then** — never back-filled from today's cost lines, and a comparison
  that meets it says "not recorded", never 0.
- **The comparison is the domain's.** `compareBaselines(baselines, a, b, calendar)` is a pure
  function over two of the work's baselines, named by number: the work's finish moved and by how
  many working days; each activity whose finish moved, with its stage, both dates and its signed
  days — or placed, or unplaced, when it had no duration on one side; durations changed;
  activities added and removed; stages added and removed; the money, from and to with its
  difference, or _not recorded_; and the reasons of every baseline after the earlier one up to
  the later one, with the number of any in that range that gave none. Rows are matched **by
  id**: an activity or a stage renamed is the same row, never one removed and another added.
  Days are counted on the work's calendar as it is now. The pair is **ordered by number**
  whatever order it was chosen in, and the interface says so; a baseline compared with itself is
  refused (`same-baseline`), and so is a number the work does not have — each a result with its
  sentence, never an exception and never an empty comparison that would read as "nothing
  changed".
- **Counted figures with rows.** The result reads as counts — "3 dates moved · 1 activity added ·
  1 stage removed · money +R$ 1.200,00" — and every count opens onto the rows it counted
  ([ADR-008](#adr-008), [ADR-024](#adr-024)).
- **A what-if is pure interface.** The Schedule's **What if** card takes an activity and a
  duration, or a link and a lag, as many as wanted; the domain's `withOverrides` returns a new
  snapshot with them applied — **nothing is written** — and the finish date is shown against
  today's plan and against the latest baseline. A what-if respects what the host would refuse and
  what has already happened: an override of an activity or a link the plan does not have, a
  duration outside 1–3 650 working days or a lag outside 0–3 650, and a duration on an activity
  of a closed stage are each refused with a sentence; a second override of the same thing
  replaces the first.
  **Clear** drops it, and so does leaving the Schedule; a sentence on the card says "A what-if is
  not saved: nothing here changes the plan. To keep it, replan with a reason."
- **No apply in 1.0.** Keeping a what-if is replanning by hand: open a replanning with its reason,
  make the same edits, take the baseline.
- **Readiness and the slip are unchanged.** The slip still measures the plan against the
  **latest** baseline ([ADR-016](#adr-016)); comparing two baselines is a separate reading, and
  the dashboard gains only how many times the plan was replanned and whether a replanning is
  open.

**Why.** A comparison computed from two insert-only records, in pure code with its negative
cases, is one both sides of an argument can rerun and get the same answer from. Matching by id
is what makes a renamed stage a rename and not a loss. A what-if that writes nothing cannot
become a silent change; an "apply" button would be exactly the copy of a plan into the file with
no reason asked that [ADR-027](#adr-027) exists to prevent — or it would have to open a
replanning behind the person's back.

**Cost accepted.** Nothing a person tried in a what-if is kept: Clear, leaving the Schedule or a
restart loses it,
and keeping it means typing it again inside a replanning. Baselines taken before F8 never gain
their money — every comparison that reaches one says "not recorded" for as long as the work
exists. A stage that had no activity when one of them was taken is not in it, because nothing
recorded it; and a stage none of whose activities is left carries the id derived from its name,
so if the stage itself is still in the plan, a comparison with a baseline taken after F8 reads it
as one stage removed and another added. A baseline does not copy the calendar, so the days
between two baselines' dates are counted on the calendar as it is now: a holiday added since
counts in them. Every baseline now copies every stage as well as every activity. And what the
diary says happened is not in this comparison: it is plan against plan. [ADR-020](#adr-020)
expected actuals against the baseline from F8 and F10; F8 does not do it, and it is left to
F10's reports.

## ADR-029 — A template is data, applied once as the work's own plan, with ranges and no prices {#adr-029}

**Status.** Accepted — 2026-09-28.

**Context.** The last of the six product decisions still open is that templates are plans, not
to-do lists (SPEC §2.12, §4): stages with their typical activities, the links between them,
duration ranges, the decisions each stage needs with their lead times, the checks it must pass
and its cost lines — shipped as a library in this public repository, edited by anybody who
contributes, and applied to start a work that is then the person's own. Two risks the
specification names pull the same way: a template's durations and costs are taken as promises
(R5), and a public library accepts a template that is wrong or hostile (R10). Three shapes were
weighed. A template as **code** — a module that builds a plan — could do anything, including what
a reviewer does not see. A work **linked** to its template, so that a correction to the library
reaches every work started from it, would rewrite somebody's plan without asking, which is what
[ADR-027](#adr-027) exists to prevent. And a template with **point values** — "tiling: 4 days,
R$ 3.000,00" — reads as a quote the day it is applied, and is wrong for every site but one.

**Decision.**

- **A template is a JSON file and nothing else.** The library is `templates/<id>.json` at the root
  of the repository, one file per template, its `id` in kebab-case and equal to the file's name.
  Its fields are a closed list — the format version (`"ridgebeamTemplate": 1`), `id`, `version`,
  `title`, `summary`, `includes`, `rooms`, `stages` (each with `checks`, `costLines`, `decisions`
  and `activities`) and `links` — and **a field the validator does not name is refused**. Every
  text is `{ "en": …, "pt-BR": … }`. Nothing in a template is ever run.
- **One validator, two levels** — `validateTemplate(raw, origin, library)` in
  `src/domain/templates/validate.ts`, which returns every problem with its JSON path and a
  sentence. For **every** template: the structure; kebab-case keys unique in their scope; rooms,
  activities and link endpoints that resolve; includes that name library templates, never the
  template itself and never a cycle; links that close no loop once stage endpoints are expanded,
  judged by the schedule's own graph as the host will judge them; and the host's limits (names and
  labels 120 characters, checks 200, the summary 400, durations 1–3 650 working days, lead times
  and lags 0–3 650). For the **library** only: both languages in every text; a summary; **every
  duration and every lead time given, as a range with `min < max`** — a point is refused, because
  a template carries ranges, not promises; **no `amountCents`**, because the library has no
  prices; and no text that looks like a web address, an e-mail address or a phone number. A
  template **from a file** — somebody's own, or a work's export ([ADR-030](#adr-030)) — may carry a
  point (`min = max`), applied as that activity's duration with a note that says so, and amounts,
  which are that work's own numbers.
- **The library test is the gate.** `src/domain/templates/library.test.ts` reads every file in
  `templates/`, validates it as `library`, checks that its id is its file name, and applies it to
  an empty work; it names the file and the path that failed. It runs in `vitest`, so in
  `npm run gates` and in CI. A maintainer reviews every template before it merges (R10);
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md) is the procedure.
- **Applied once, as the work's own plan.** `applyTemplate(template, library, language)` turns a
  validated template into a `PlanDraft` in one language — its includes first, depth first and each
  once, their stages keyed `template-id:stage-key` so that two included templates may both have a
  `strip-out`, their rooms merged by key — with notes of what it did: points applied as
  durations, texts taken in the other language, templates included. The host's `plan_apply`
  writes the whole draft in **one transaction**, every row checked with the same limits as the
  command that adds one of its kind, **only into a work with no stage that is not approved** ("A
  template starts a plan: this work already has one."), and refuses a cycle with the F2 sentence.
  `work_create` may carry the plan and applies it in the same step; if the plan is refused, the
  folder the call created is removed again and nothing is left in the recent list. Every row gets
  a new id: from its first row the plan is the work's.
- **Provenance, not a tie.** The work records `template_id`, `template_version` and
  `template_title` — the title in the language it was started in — and nothing else. Nothing is
  ever read from the template again; the Dashboard says where the plan was started from.
- **Applying never invents a number.** An activity takes the range (`duration_min_days`,
  `duration_max_days`) and **no duration**: `duration_days` stays empty until a person types one,
  or presses **Use the upper end of each range** or **Use the lower end** (`ranges_take`), which
  write the duration of every activity with a range and no duration outside a closed stage — an
  explicit act, locked after approval like any duration edit ([ADR-027](#adr-027)). Readiness's
  `activity.duration` row names the range. A decision's lead time is the **upper** end of its
  range — the earlier deadline, the careful reading — and the range is kept beside it
  (`lead_min_days`, `lead_max_days`). A decision's `needs` is checked (it must name an activity of
  its stage) and not stored: in 1.0 a decision is needed by its whole stage ([ADR-017](#adr-017)).
- **A cost line from the library is a label.** `cost_line.amount_cents` becomes nullable
  (migration 010): a line with no amount is **not priced yet**, which is not 0. Planned money sums
  the priced lines and lists the unpriced ones as rows marked so, contributing nothing and saying
  it; the S-curve draws only priced lines. Readiness's `stage.money` now needs a **priced** line.
  Every line written before F9 has an amount, so no existing total and no existing readiness
  figure moves. Checks and rooms are copied as they are, and links with their lag.

**Why.** Data with a closed list of fields and a validator in pure code is something a reviewer
can read whole and a test can refuse; a file that could run could not be reviewed that way. A plan
copied once is a plan the person owns: the library can be corrected without anybody's work
changing under them, and an approved plan changes only through a replanning with its reason. A
range left as a range keeps the product honest about what a template cannot know — the site, the
crew, the weather — and readiness then says, in a sentence, that the plan does not yet know its
durations, which is the truth. A library with no prices cannot be read as a quote, and cannot be
out of date in a currency or a region it never named.

**Cost accepted.** Nothing links a work back to its template: a mistake found in the library later
is corrected there and **never reaches the works already started from it** — each person corrects
their own plan, and the provenance only says which version they started from. **Ranges must be
turned into durations by a person**: a work started from a template opens with every activity's
duration missing and readiness low, on purpose; the two buttons are blunt — every range at once,
at one end — and the alternative is typing each duration. **The library has no prices**: every
stage of a new work has `stage.money` unmet until somebody writes an amount, and there is no price
table to fall back on, by decision (price databases are not in 1.0). A lead range collapses to its
upper end, which may put a deadline earlier than the person would. A decision's `needs` is
validated and then dropped, because a decision belongs to its whole stage. Included templates'
stages come **first** in the breakdown, in the order of `includes`, so an apartment refit lists its
bathroom and kitchen stages before its own protection stage even though its links schedule that
stage first. The library speaks two languages, and a template in only one cannot enter it. And
the text checks are a heuristic: they catch a web address, an e-mail address or seven digits in a
row, not a brand, a supplier or a real place — a maintainer's review is what catches those.

## ADR-030 — A work exports as a template with its numbers stripped or kept {#adr-030}

**Status.** Accepted — 2026-09-28.

**Context.** A person who has planned a work well has made something worth starting the next one
from, and something another person could use (SPEC §2.12: "any work exports as a template with its
numbers stripped or kept"). The numbers are the problem. A plan's durations, lead times, lags and
amounts are that site's: shared, they read as promises for somebody else's (R5); kept, they are
exactly what the same person wants for the next work like it. One export with no choice would be
wrong for one of the two.

**Decision.**

- **One pure function, one choice** — `exportTemplate(snapshot, { numbers, language, id, title })`
  in `src/domain/templates/export.ts`, with `numbers` either `strip` or `keep`. It always exports
  the rooms, the stages and their activities in plan order, the links, both gates' checks, the
  decisions and the cost lines' labels, **in the work's language only**. Keys are made from the
  names — kebab-case, accents folded, unique in their scope — so the same plan exported twice is
  the same file. A work's includes are not recorded: an export is flat.
- **Strip** is the default — something to share. An activity carries the range it took from its
  template, if any, and otherwise no duration at all; no lead time, no lag, no amount.
- **Keep** is the work's own numbers, to start the next one like it. An activity with a
  duration exports it as a point (`min` = `max`), and one still waiting for a person to pick keeps
  its range; a decision exports its lead time as a point; every lag; the amount of every priced
  line. A point applies as that number, so the next work starts where this one settled.
- **Never exported, whichever the choice:** people and who is responsible, quantities, the
  diary, gate answers, commitments, payments, documents, baselines, replannings, and whether a
  decision was made. A template is a plan's shape, not its record.
- **It validates as a file by construction.** An export passes `validateTemplate` with origin
  `file`, and a test holds that export → validate → apply → export gives the same template back.
  It is **not** a library template: one language, no summary, and — kept — points and amounts. To
  enter the library it goes through [`CONTRIBUTING.md`](../../CONTRIBUTING.md) like any other.
- **The host writes it whole or not at all.** `template_write(path, text)` takes `.json` only and
  1 MiB at most, writes a temporary file in the same folder, flushes it and renames it over the
  name, and replaces an existing file only when the person chose it in the save dialog, which
  asked. The Plan's header offers **Export as a template…**; its dialog asks strip or keep (strip
  first) and where, and announces the path it wrote.

**Why.** Two honest defaults for two honest purposes, chosen by the person at the moment they know
which one they mean. Stripping back to the template's own ranges gives back what the library gave
and nothing the site taught; keeping carries the numbers this work settled on, so the next work does
not have to pick them again. A pure function with a round-trip test is what makes "the
same plan gives the same file" a fact rather than a hope.

**Cost accepted.** A stripped export of a plan that did not come from a template has **no
durations at all**: the durations a person typed are the site's numbers, and strip drops them. A
kept export of a work's own durations is a file of points — valid as a file, refused by the
library — and anybody who applies it gets that work's numbers as durations, with a note saying so
and nothing more. The export is in one language, so a library template made from a work needs its
second language written by hand. Keys made from names change when a name changes, so two exports
of a plan renamed in between do not line up key for key. And nothing records that a file was
exported, or from which baseline: it is a snapshot of the plan as it stood.

## ADR-031 — A report is a document the interface composes and the host renders, in standard fonts, and a second reader checks it {#adr-031}

**Status.** Accepted — 2026-09-28.

**Context.** The specification asks for four files a person takes out of the product (SPEC §2.15):
the weekly report in the owner's words, the diary for the record, the schedule on paper, and the
whole work as JSON for anybody else's tool (R4). Every one of them must say what the screen says:
a report whose numbers come from a second calculation will one day disagree with the dashboard,
and a person holding the paper will believe the paper. Three ways of making a PDF were weighed.
**Printing the webview** gives whatever the screen's layout and the machine's print engine make
of it — different on every machine, impossible to hold in `cargo test`, and with the dark theme,
the rail and the buttons to take out again. **A PDF library in the webview** would need to write
files, which the webview cannot do by design ([ADR-002](#adr-002)), and would ship a large bundle
to do what the host does in a few hundred lines. **A document the interface composes, rendered by
the host** keeps the words where the words already are — the two dictionaries — and the writing
of files where it already is, in Rust. Fonts were the second choice: embedding a font file is
heavier, needs a subsetter and a licence for the font, and counts against the 10 MB installer
(SPEC §4); the standard PDF fonts cost nothing, and every PDF reader has them.

**Decision.**

- **One document model.** A report is a `ReportDocument` —
  `{ kind: 'weekly' | 'diary' | 'schedule', title, subtitle, pageSize: 'a4' | 'a4-landscape', language, blocks }`
  — and a block is one of seven: a **heading** (level 1 or 2), a **paragraph** (normal, muted or
  strong), a **figure** with its value and **the rows it counts listed under it**, a **table**
  (up to 16 columns, each with its alignment and its share of the width), a **gantt**, a **rule**
  and a **page break**. It is words, not data: the interface sends it already translated, and the
  host adds nothing to what it says but the footer's "page N of M" and the diary's verification
  block ([ADR-032](#adr-032)), both in the document's language.
- **The interface composes it from the rows the screen shows.** The domain selects
  (`src/domain/reports/` — `weekly`, `diary`, `schedule` — pure, keys and parameters and no
  strings, and reading the very figures the dashboard shows from `src/domain/dashboard/`); pure
  functions in `src/features/reports/compose/` turn a selection into blocks through the same `t()`
  the screens use, in the language on screen. The weekly report is always in the **owner's** lens
  vocabulary, whatever lens is on — it is the owner's report; the diary and the schedule are in the
  lens on screen.
- **The host lays it out and writes it** — `src-tauri/src/report/`: `model.rs` (the document, its
  serde shape and its limits), `winansi.rs` (the encoder and the font widths), `layout.rs` (pure:
  blocks in, positioned marks per page out, tested without a PDF), `pdf.rs` (the marks written).
  A4 portrait or landscape, 20 mm margins, text wrapped by the real width of each glyph, a table
  that runs past a page breaking there and repeating its header, and a footer on every page —
  "Ridgebeam · {title} · page N of M", or "página N de M". The metadata carries the title, the
  producer "Ridgebeam {version}" and the language; **no author and no e-mail address**; and the
  creation date the interface passes in, so the same document gives the same file in a test. Page
  streams are deflated. The writer is `pdf-writer` 0.15, the one a sibling product already ships;
  it writes and cannot read.
- **Standard fonts, WinAnsi, nothing embedded.** Helvetica and Helvetica-Bold with
  `WinAnsiEncoding`, and their published metrics: a 256-entry width table per face, the `WX`
  values of Adobe's Core 14 AFM files, with their notice carried beside them and in
  [`NOTICE`](../../NOTICE). WinAnsi is the printable ASCII, the Latin-1 supplement and the 27
  characters Windows-1252 adds — English and Portuguese as the product writes them (á ã â à ç é ê
  í ó õ ô ú, – — … • ‘ ’ “ ” € ° ² º ª ×). **Three characters outside it are printed as documented
  stand-ins** — → as `->`, ≥ as `>=`, ≤ as `<=` — the spaces and the minus sign `Intl` writes into
  numbers and dates are folded onto the ones the faces have, and anything else prints as `?`. **A
  test composes every report in both languages and fails on a character that would print as
  `?`**, so what the screen says the page says.
- **A second reader parses every PDF.** `cargo test` reads what `pdf-writer` wrote with `lopdf`
  0.45, a development dependency of another lineage that is never shipped: every block type, both
  page sizes, a table long enough to cross pages, the stand-ins, Portuguese text — extracting the
  text and finding each block's words, counting the pages, reading the metadata. The end-to-end
  suite checks the written file on disk as well: it starts with `%PDF-`, ends with `%%EOF`, and the
  words it expects are in its inflated content streams.
- **The weekly report**, for the Monday-to-Sunday week of the day chosen, this week by default; a
  week that has not begun is refused. Its first lines are the diary's week: every day with what the
  diary says of it, and **the working days that are over with nothing written, listed** — a week
  with no entry says so on its first line, in strong type, and the rest is still printed (SPEC R2).
  Then what was worked on and finished, who was on site, the weather days lost, readiness and the
  first three things it lacks, the finish date against the latest baseline and the slip, the
  decisions overdue or due in the next 14 calendar days, money planned, committed and paid and
  paid this week, and the stages planned, ready, started, closed and held at a gate. Every figure
  is printed with its rows. The decisions, the money and the stages are the work **as it stands
  the day the report is written**, and the page says so; only the diary's part is about the week
  asked for. A note in a row is shortened; the diary's own PDF prints it whole.
- **The schedule** is landscape: the screen's Gantt, not a second geometry — one column per
  calendar day, weekends and holidays included, from the first day anything is drawn; a bar per
  activity, the critical ones filled dark and the others outlined, the latest baseline a thin bar
  beneath — and then a table of **every** activity: number, name, stage, start, finish, duration,
  float and responsible, an activity the schedule could not place listed with its reason. The day
  grid always fits the page's width, however many days it runs over (up to 3 660): the longer the
  plan, the narrower each day, and the day labels are thinned to every Nth so that none touch. A
  plan with more activities than a page holds breaks across pages with its day header repeated.
  When nothing can be drawn — a loop, a calendar that cannot be counted on, no duration — the page
  says why and the table is still printed.
- **One path writes every file** (`files::save`, which F9's template export now shares). The four
  writing commands — `report_pdf_write`, `diary_export_pdf`, `diary_export_csv` and
  `work_export_json` — take a full path ending in `.pdf`, `.csv` or `.json` by kind; write a
  temporary file in the same folder, flush it and rename it over the name, so a file is whole or
  absent; replace an existing file only with `overwrite`, which the interface sends only when the
  save dialog chose the path and asked; and refuse a file over 256 MiB. A document is checked whole
  before anything is laid out and refused with a sentence past a limit: 5 000 blocks, 20 000 rows
  (tables, figures and Gantt bars together), 2 000 characters in any string. The work as JSON is
  written by the host from the database, in the format [`DATA_MODEL.md`](../DATA_MODEL.md) fixes
  (`"ridgebeamWork": 1`). After writing, **Open** hands the file to the operating system's own
  viewer through `report_open`, which opens only a path a report command wrote in this session.
- **Where it lives.** A new destination, **Reports**, after Documents: one card for each of the
  four files, each saying in one line what the file holds and what it does not. The rail has
  eleven destinations, eight of them needing a work.

**Why.** A report composed from the rows the screen shows cannot disagree with the screen, and a
report whose words come from the two dictionaries is in the product's language and vocabulary,
held by the same literals and dictionaries tests. Rendering in the host keeps the webview without
file access and the layout pure, so pagination, wrapping and the footer are facts `cargo test`
holds rather than things a person checks by eye. A second reader of another lineage is what makes
"the PDF is valid" a claim somebody other than its writer has checked. The standard fonts are the
smallest thing that prints the two languages the product speaks.

**Cost accepted.** **No glyph outside WinAnsi and the three stand-ins**: a name typed in Greek,
Cyrillic, Chinese or with an emoji prints with `?` in its place, and an arrow prints as `->` — the
screen and the page agree only for what the product's two languages write. The fonts are not
embedded, so each reader draws them with its own Helvetica or the nearest it has, and the page
looks a little different from one viewer to another; for the same reason the file is not PDF/A.
**Photos are not in the PDF in 1.0**: the reports count an entry's photos and say they are in the
work's folder. **The schedule PDF does not shade non-working days in 1.0**: the screen's Gantt
does; on paper every day column looks alike, so a weekend is told from a working day only by its
date. A long plan is drawn narrower, not across several pages side by side, and past a few
hundred days its bars are thin. The weekly report of a past week reads the decisions, the money
and the stages as they are today, not as they were that week, and it compares the plan with its
latest baseline — it does not put actual dates beside baseline dates. A report is a snapshot of
the moment it was written, and nothing in the work records that it was. And **Open** works only
in the session that wrote the file: after a restart the file is still on disk, and the product
will not open it.

## ADR-032 — The diary export verifies the chain when it is written, and a CSV never carries a formula {#adr-032}

**Status.** Accepted — 2026-09-28.

**Context.** The diary is the record ([ADR-019](#adr-019)), and its export is the moment the record
leaves the product — for the owner's files, for a contractor, for a dispute. Three things can go
wrong there. A file can say the chain is intact when nobody checked, or when the interface did the
checking and could be wrong. A file can be read as more than it is — a signature, legal proof —
which the specification names as a risk (R6). And a CSV opened in a spreadsheet is a program's
input: a note or a name typed as `=HYPERLINK(…)` or `@SUM(…)` becomes a formula on somebody else's
machine — the injection OWASP calls CSV injection.

**Decision.**

- **The host verifies before it writes.** `diary_export_pdf` and `diary_export_csv` read every
  entry and verify the chain over the very rows they are about to write, inside the host and while
  the work is held, so no entry is appended in between. If it does not verify, **nothing is
  written** — no temporary file, no file replaced — and the refusal names the entry where it broke:
  "The diary was not exported, because its chain does not verify." and the reason. The Reports
  page runs the same verification before offering to write, and says "N entries, chain verified
  just now" or where it does not hold.
- **The PDF's first block is the host's, not the interface's.** The interface composes the
  entries — every one as it was written, in order, a correction beside what it corrects and marked
  as what now counts for the day, with its author, weather, what was worked on and finished, who
  was present, the note whole and how many photos. The host puts its own block **in front** of
  them, in the document's language, which the interface can neither write nor change:

  > Chain verified on {date}: {N} entries, head {the first 16 hex digits of the last entry's
  > hash}.
  > This is tamper-evidence: it shows whether the file was changed outside Ridgebeam.
  > It is not a signature and not legal proof.

  and in Portuguese, _"Cadeia verificada em {data}: {N} entradas, impressão digital da última
  {hash}. Isto é evidência de adulteração: mostra se o arquivo foi alterado fora do Ridgebeam. Não
  é uma assinatura e não é prova legal."_ An empty diary has no head, and the block says only the
  count. The count and the head are what [ADR-019](#adr-019) said the export would record: a copy
  kept elsewhere can show entries removed from the end, which the chain alone cannot. A document of
  any other kind sent to the diary export is refused, and a diary document sent to the plain report
  command is refused too — the diary is never printed without the verification.

- **The CSV is written by the host from the database**, never from anything the interface sends,
  so it is the record and not a rendering of it. One row per entry in the chain's order, thirteen
  columns — `seq`, `day`, `created_at`, `author`, `weather`, `done`, `finished`, `present`, `note`,
  `corrects_seq`, `photos`, `entry_hash`, `previous_hash` (E3 appends two at the end, `lost_cause`
  and `lost_party` — [ADR-043](#adr-043)). `done`, `finished` and `present` name
  the activities and people as the plan names them now, joined by `; `, an activity with the
  quantity said (`Tiling (12 m²)`), and one since removed from the plan by its id; `weather` is the
  stored word (`rain`, `sun` …); `photos` are the photos' SHA-256 hashes joined by a space. UTF-8
  with a byte-order mark, lines ending in CR LF, quoted as RFC 4180 says, with `,` or `;` as the
  separator — the interface passes `;` in Portuguese and `,` in English, what each language's
  spreadsheet expects.
- **A CSV never carries a formula.** Every cell whose first character is `=`, `+`, `-`, `@`, a tab
  or a carriage return is written with a `'` before it (OWASP's advice), whichever column it is in
  — notes, names, authors, what was done. A cell that starts with anything else is written as it
  is. `cargo test` holds each of the six characters in a name and in a note, and a safe cell
  untouched.

**Why.** Verification belongs to whoever can be held to it: the host holds the database, runs the
check and writes the file in one call, so the sentence at the top of the page is true of the diary
under it. Writing the CSV from the database means a spreadsheet gets every entry as the chain
covers it, hashes included. The block says what the chain is in the words the product uses
everywhere else — Diagnostics, the glossary, this record — and says what it is not in the place a
person reading the record away from the product will see it. Neutralising every risky cell costs a
character and closes a whole class of attack on whoever opens the file.

**Cost accepted.** **A CSV opened in a spreadsheet shows a leading apostrophe on a neutralised
cell**: `'=HYPERLINK("x")` reads as that text, apostrophe included, and so does a note that simply
began with a dash, as a list does — the spreadsheet cannot tell a list from a formula, and neither
does the export. The verification is true of the work's diary when the file was written, not of the
file afterwards: a PDF or a CSV can be edited like any other file, and only its head, compared with
the work, says whether a copy still matches. The date in the block is the moment the interface says
the report was made. A diary whose chain is broken **cannot be exported at all** until the cause is
found — the product will not print a record it cannot vouch for, even to show the damage. The
separator follows the product's language, not Windows' list separator, so a person using the
product in English with a spreadsheet that expects `;` sees each row in one column until they
import it by hand. Names in the CSV are the plan's names today, not the ones it had on the day.
Photos travel as their hashes, not as pictures. And the chain proves what [ADR-019](#adr-019) says
it proves, no more: somebody who rewrites every entry and recomputes every hash gets an export that
says the chain is verified.

## ADR-033 — A backup is one ZIP with a manifest; restore makes a new folder and proves it byte for byte {#adr-033}

**Status.** Accepted — 2026-09-28. Its cost that the product "never reminds" is amended by
[ADR-040](#adr-040): the dashboard now reminds, and the product still never backs up on its own.

**Context.** The specification's first risk is critical: a diary entry lost, or a baseline
overwritten (R1). Append-only tables and a chain ([ADR-016](#adr-016), [ADR-019](#adr-019)) keep the
record from being rewritten inside the product; they do nothing for a disk that fails, a laptop that
is stolen, or a folder deleted by mistake. A work is a folder ([ADR-004](#adr-004)), so a person can
copy it — but only while it is closed, and only if they know that the database, `documents/` and
`thumbnails/` travel together, and a copy made while the work is open can catch the database between
its file and its write-ahead log. The specification asks for more: **the whole work as one file,
restored byte for byte** (SPEC §7, F11), proven in `cargo test` rather than claimed. Three shapes
were weighed. **A copy of the folder** is not one file, and says nothing about whether it is whole.
**A format of the product's own** could be opened by nobody but the product. **A ZIP** is one file
that Windows opens by itself — a person can see what their backup holds without Ridgebeam — and the
product can still refuse any ZIP that is not exactly the one it wrote.

**Decision.**

- **One file, `<name>.ridgebeam`, a plain ZIP**, holding in this order and nothing else:
  `manifest.json`; `work.sqlite3`; every file of `documents/` and then of `thumbnails/`, by name;
  and last, `manifest.sha256`. The format is in [`DATA_MODEL.md`](../DATA_MODEL.md).
- **The manifest says what the backup holds** — the format's version (`"ridgebeamBackup": 1`), when
  it was written, the build that wrote it, the work's id, name and schema version, and every file
  with its size and SHA-256 — and **its own hash is the last entry**, in the form `sha256sum -c`
  reads, so a manifest changed after it was written is found before a word of it is believed.
- **The database is a snapshot, not a copy.** `VACUUM INTO`, on the connection the work is open on,
  in one read transaction: every committed row, the write-ahead log folded in, taken while the work
  stays open. It is rebuilt page by page, so the free pages of the live file — where the bytes of a
  deleted row may linger — do not travel in a file a person hands to somebody else; SQLite's online
  backup API copies pages as they are, free ones included. The snapshot is put in WAL mode, as
  every closed work is, so that opening the restored work changes none of its bytes. It is
  deflated; documents and thumbnails are stored as they are, already compressed (a BMP, the one
  kept format that is not, is deflated).
- **The ZIP is written and read by hand** (`src-tauri/src/files/archive.rs`): local headers with
  their sizes and CRC in place, stored or deflated, a central directory, the end record — no
  ZIP64, no encryption, no extra field, no data descriptor, no comment, no directory entry, ASCII
  names. The `zip` crate was measured and not taken: its reader parses what this product must
  refuse anyway, its writer refuses a duplicate name — so the hostile corpus would need a hand
  writer regardless — and the guarantee that matters, sizes enforced while inflating, would be
  this product's code either way. Deflate and CRC-32 are `flate2`, already in the binary. **No
  crate is added.** The second reader is Windows' own `tar.exe`, which reads every backup a test
  writes.
- **Where it lives.** **Back up this work** in a new **This work** section of Settings, shown only
  while a work is open: a path chosen in the save dialog, written whole or not at all through the
  same path every report takes ([ADR-031](#adr-031)), an existing file replaced only when the
  dialog chose it, and never inside the work's own folder, where it would be lost with the work.
  The answer names the path, the size and how many files it holds. **The day of the last backup**
  is kept in the application's database, per work — not in the work, which cannot hold the moment
  it was itself copied — and shown in Settings and in Diagnostics' folder health — the day, or
  that it was never backed up on this machine.
- **Restore makes a new folder; it never overwrites one.** **Restore a backup…** on the Start
  screen: the file, then a folder that does not exist yet or is empty; a folder that holds
  anything is refused. Before restoring, the dialog shows what the manifest says — the work, when
  it was backed up, by which build, how many files. The file is **hostile input**
  ([`SECURITY.md`](../../SECURITY.md)): the shape this product writes and no other, 4 GiB at most,
  every name from a closed allow-list and none twice, the manifest's hash checked first, every
  file's size equal to the manifest's and under its cap **while it inflates**, every SHA-256
  checked, and the database opened read-only and found to be a Ridgebeam work — the work the
  manifest names, at a schema this build knows. Everything is written into a temporary folder
  beside the target, opened there — **an older schema migrates forward** as any old work does —
  and renamed into place only when every check has passed. On any refusal, a sentence says why,
  and nothing is left.
- **Then it proves itself.** The restored work is opened, its diary's chain is verified and every
  document re-hashed, and the Start screen says so: "Restored: N entries, chain verified, N
  documents as recorded". If the recent list already knew that work at another folder, the row
  moves to the restored folder and the sentence says **the old folder was left as it was**.
- **"Byte for byte" is a test, not a claim.** `cargo test` builds a full work — stages, activities,
  links, baselines 1 and 2 with a replanning between them, decisions, checks with answers and a
  photo, a diary with a correction and photos, documents including a PDF, cost lines, commitments,
  payments with a reversal, a template's provenance — backs it up, restores it into a new folder,
  and holds that the restored `work.sqlite3` is byte-identical to the snapshot the archive holds,
  every document and thumbnail byte-identical to the original, **every table's rows equal to the
  original's**, compared table by table through `PRAGMA table_info` so a column added later cannot
  be forgotten, the chain verifying and every document as recorded. A corpus of thirty-two hostile
  archives, generated in the test and committed nowhere, is refused one by one with nothing written.

**Why.** One file is something a person can copy to a USB stick, a second disk or a cloud folder
of their own choosing without understanding what a work folder holds. A ZIP is the one archive
Windows opens by itself, so a backup is never a black box — and writing the ZIP by hand keeps the
reader as narrow as the writer: the only archive it accepts is the one it would have written. A
manifest with its own hash turns "the backup is whole" into something checked before anything is
written. Restoring into a new folder means a restore can never destroy the work it was meant to
save, and staging it beside the target means a refused restore leaves no half-work for somebody
to open by mistake. Proving the round trip table by table is what lets R1's mitigation say "backup
round-trip proven in Rust" and mean it.

**Cost accepted.** **A backup is not encrypted.** It holds everything the work holds — the diary,
the payments, people's phone numbers and e-mail addresses, every photo and document, the Windows
account name on each entry — in a ZIP anybody can open; it must be kept as carefully as the work
folder, and the product says so. **A restore makes a new folder and leaves the old one**: the
person has two copies of the work until they remove one, and the product never removes either;
the recent list follows the restored one. **A full copy every time**: no incremental backup, so a
work with a gigabyte of photos makes a backup of about a gigabyte each time, and nothing is kept
of which backups were made or where — only the day of the last one, on this machine. The product
never backs up on its own and never reminds; "never" in Settings is the only nudge. A backup made
on another machine, or restored here from one, reads "never" until one is written here. The plain
ZIP format caps a backup at 4 GiB and 65 535 files, and a document at the intake's own 25 MiB; a
work past a cap is refused with a sentence, not split. A file in `documents/` or `thumbnails/`
whose name a backup never holds — something put there by hand — is left out and named. And the
backup proves only what it holds: a work whose chain was already broken is backed up as it is, and
restoring it says the chain does not verify.

## ADR-034 — The plan asks one question at a time {#adr-034}

**Status.** Accepted — 2026-09-28.

**Context.** The specification names the risk that decides whether the product is used at all: the
person building once finds it too much and leaves on the first screen (R3). Its answer is three
things — the owner's lens by default ([ADR-014](#adr-014)), readiness saying the next thing to do in
a sentence ([ADR-018](#adr-018)), and **a template that asks questions instead of showing a
Gantt**. The first two were true from F1 and F3. The third was not: a work started from a template
([ADR-029](#adr-029)) opened on a plan with every duration a range, nobody responsible, every cost
line a label and the decisions unanswered — all counted by readiness, all listed, and all to be
found and filled in on a breakdown of twenty or thirty rows by somebody who does not know what a
breakdown is. Three shapes were weighed. A **wizard** that runs when the work is created asks
everything before the person has seen their plan, cannot be left halfway without losing its
place, and is a second editor with rules of its own. A **list of every open question** is the
readiness list again, in a different order — the same wall of rows. **One question at a time**, on
the screen the person already lands on, asks the next thing and nothing else.

**Decision.**

- **The domain chooses the question** — `src/domain/questions.ts`, pure, with `today` passed in:
  `openQuestions` returns every open question in the order it is asked, with the count, and
  `nextQuestion` the first one not skipped this session. Four kinds, in this order: an activity with
  a **range and no duration** ("How many working days will _Remove the tiles_ take? Most take 1 to
  2."); an activity with **nobody responsible**, or somebody no longer in the plan; a **cost line
  not priced yet**; and a **decision not made that is overdue, or due within 14 calendar days**,
  most urgent first. Inside a kind, plan order — stage by stage, by position. Each question carries
  a stable key (`duration:<activity id>` …), the message key and parameters of its sentence, and
  **what its answer writes**: the existing command (`activity_update`, `cost_line_update`,
  `decision_make`), the row and the one field — so the screen never works it out again.
- **On the dashboard, first, in every lens.** While there is a question, the dashboard's first card
  is **Next question**: the sentence, the one control that answers it — a number of working days,
  a person (with a link to add one on the Plan), an amount, what was decided — and **Keep** and
  **Skip for now**. It says how many of the plan's questions are answered — "3 of 22 answered".
- **An answer is an edit like any other.** It goes through the command the breakdown uses, and is
  refused, with the host's sentence, exactly where an edit there would be. **Nothing is asked
  while the plan is locked** — approved, with no replanning open ([ADR-027](#adr-027)) — and
  nothing of an activity or a cost line of a **closed stage** ([ADR-022](#adr-022)): the host would
  refuse the answer, so the card does not ask.
- **Skip is for this session and records nothing.** A skipped question stays open and stays in the
  count; the card moves to the next, and when every question left was skipped it says so and
  offers **Ask the skipped ones again**. Nothing about questions is stored — not asked, not skipped,
  not answered: an answered question is simply one whose row now holds the fact.
- **The count is over the plan as it is**: every activity with a range, every activity's
  responsible and every cost line, of the stages still open; every decision made, and every open
  one being asked now. A decision whose deadline is further away is not asked yet, so it is neither
  answered nor open.
- **The breakdown stays.** The card is a way in, not the only way: every question it asks can be
  answered where it always could be, and the engineer who would rather type thirty durations into
  the breakdown does.

**Why.** One question with one control is something a person who has never planned a build can
answer, and each answer moves readiness in front of them. Choosing the question in the domain keeps
it pure and tested, and keeps the order a fact rather than a screen's opinion. Sending the answer
through the existing commands means the card cannot write what the breakdown could not — there is
one set of rules for changing a plan, and a locked plan is locked here too. Storing nothing keeps
the work's data what it was: a question is a view over the rows, as a lens is.

**Cost accepted.** **One question at a time can feel slow** to an engineer who knows the plan and
would rather fill in the breakdown in one pass — which is why the breakdown stays, unchanged, and
the card is only the dashboard's first card. **A skip is forgotten on restart**: the skipped
question comes back the next session, by design, because a question nobody answered is still
open. The order is fixed — durations before people before prices before decisions — and a person
cannot reorder it; a decision falling due tomorrow waits behind every unanswered duration, though
readiness and the Decisions list show it as overdue or due all the same. A decision is asked only
within 14 calendar days of its deadline, so the count grows as deadlines come near. And the card
asks what readiness already counts; it adds no rule and no figure of its own.

## ADR-035 — The finish is also a probability: ranges, a seeded simulation, natural frequencies, and the plan's own date untouched {#adr-035}

**Status.** Accepted — 2026-09-29.

**Context.** The plan's finish date is one number, computed from one duration per activity
([ADR-015](#adr-015)). A site is not one number: the tiler who says three days means two to five,
and every person who has built once knows that the date on the plan is the date on which nothing
goes wrong. The product already held the raw material of an honest answer — a template brings every
duration as a **range** ([ADR-029](#adr-029)) — and set it aside the moment a person typed a
number. The question an owner actually asks, "when will it really finish?", had no answer but the
plan's date, and the question an engineer asks, "how sure is that?", had none at all. Three shapes
were weighed. **PERT's three-point formula** gives a mean and a spread along one path, and is wrong
exactly where it matters: when two paths are close, the finish is the later of the two, which the
formula cannot see. **A buffer** added to the finish is a number the product would invent. **A
simulation** of the same schedule, run many times with durations drawn from the ranges the person
gave, sees every path, and can say what it assumed.

**Decision.**

- **Ranges are the input, and any activity can have one.** `duration_min_days` and
  `duration_max_days` (F9's columns, [`DATA_MODEL.md`](../DATA_MODEL.md)) are edited on every
  activity in the breakdown, as **Optimistic** and **Pessimistic** working days beside the duration,
  through `activity_update`: both or neither, whole, 1 to 3 650, the optimistic not above the
  pessimistic — both ends equal is a range of one number. A change that would leave the duration
  outside the range — a duration typed outside it, or a range that does not hold it — is refused
  with a sentence naming the range; nothing widens or clears a range on its own. **A range is not
  locked by approval**: a baseline does not record it, and it is an estimate of how uncertain the
  plan is, not the plan. The lock's list ([ADR-027](#adr-027)) is explicit and does not gain it; a
  duration stays locked as before, and an activity of a closed stage takes no change at all.
- **The model** (`activityModel`). An activity with a range and a duration is a triangular
  distribution — the optimistic end, the duration as the most likely, the pessimistic end. With a
  range and no duration, the most likely is the middle of the range, inside the simulation only:
  nothing is written, and the breakdown still shows no duration
  ([`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) §8). A duration that lies outside its range — only a
  plan from before D1 can hold one, a template's 2 to 4 with a 5 typed later — **widens the range to
  take it in**, 2 to 5 peaking at 5, inside the simulation only: both are things somebody said, and
  the file keeps them as they are. Everything else is **certain** — the same duration in every run:
  a duration with no range, and a range of one number. With neither a duration nor a range,
  an activity is not placed, as the schedule already does, and the result counts it. Lags are
  certain. A drawn duration is rounded to the nearest whole working day, a half up, never below one.
  **Nothing invents uncertainty**: no activity gains a range the person did not give, and the page
  says how many activities are counted as certain.
- **What has happened is not drawn.** An activity the diary says is finished is certain at the
  working days it really took, its first entry to its finish, both counted. An activity of a closed
  stage is certain at its duration. An activity the diary says is started keeps only what is left
  of its range: it has already taken the working days from its first entry to its last, so the
  triangle is cut there and no run gives it fewer; one already past its pessimistic end is certain
  at what it has taken. The diary's own rules say what started and finished mean.
- **The engine is the schedule's.** `src/domain/schedule/probability.ts`, pure, takes the network
  the schedule computes over — the same edges and the same topological order, extracted from the
  critical-path engine as `network()` and now used by both, so the two cannot disagree about what
  comes first — and then, run by run, draws the durations, passes forward to the finish and
  backward to the activities with no float in that run, exactly as the schedule's own passes do.
  The working-day offsets become dates on the calendar once, at the end. The existing schedule
  tests pass unchanged.
- **Seeded, so the same plan gives the same numbers.** The draws come from `mulberry32`, a small
  seeded generator in the domain, and the seed is an FNV-1a hash of what the runs depend on: the
  start date, the working days, the holidays, every activity's model and every link with its lag.
  Opening the work again, on any machine, gives the same numbers; changing any of those gives new
  ones. There is no "run again" that would let a person shop for a better answer.
- **Runs.** `PROBABILITY_RUNS`, 2 000. Each run passes over every activity and every link twice,
  forward and back, and one simulation may pass over 40 million in all (`PROBABILITY_WORK_BUDGET`):
  a plan of up to 10 000 activities and links together gets every run, and a larger one gets as many
  as fit, rounded down to a hundred and never fewer than 200 (`runsFor`) — and the page says it was
  capped. The budget was set from the benchmark's work of 2 000 activities, 400 of them ranged, and
  3 000 links, which gets all 2 000 runs; the largest plan that still does stays near 300 ms on the
  development machine. The number of runs is always on the page, with the method.
- **What it answers.** The chance of finishing by any date (`chanceBy`); the first dates by which
  half, eight tenths and nine tenths of the runs had finished (P50, P80, P90); the chance of the
  plan's own finish date, and of the latest baseline's; each activity's **criticality index** — the
  share of runs in which it had no float; and the **drivers** — the activities with a range whose
  drawn duration moves the finish most, by Spearman's rank correlation over the runs, five at most,
  and only those above 0.1 and above three standard errors of a correlation of nothing
  (3 / √(runs − 1)), so that noise is never named. Nothing is simulated — and the page says why —
  when the calendar or the start date cannot be counted on, the links hold a loop, or no activity
  has a duration or a range.
- **A chance is a figure with its rows, of a new kind.** The figure contract gains the unit
  `chance`: `hits` of `runs`, its value exactly `hits / runs`. A probability is not a sum, so its
  rows are not its parts: they are **what it depends on**, each with its role — the drivers, with
  their rank correlation, then the activities counted as certain. The P80, the plan's date and the
  baseline's date carry those rows; the criticality figure's rows are every activity simulated,
  each with its index. `traceable` holds all of it.
- **Said in natural frequencies, in words.** The headline is the P80 date and the chance of
  finishing by it — "8 in 10 chances of finishing by 14 November 2026" — in whole tenths, in every
  lens; the engineer also sees P80 and the percentage. **Tenths are floored, never rounded**: a
  chance of 0.79 is "7 in 10", so the words never promise more than the runs showed, and "10 in 10"
  is said only when every run finished by then. Below a tenth and above nothing is "fewer than 1 in
  10"; no run at all is never "impossible", because runs cannot prove never. The percentage is
  floored the same way, so the two never disagree. When nothing has a range, the card says that
  every activity is counted as certain, so the finish is the plan's date, and how to give a range.
  A method line is always there — how many runs, from which ranges, seeded — with what the runs
  leave out.
- **Where it shows, and what it never touches.** A card on the Schedule, **When will it really
  finish?**, after the finish and the baseline: the headline, the P50 and P90, the plan's and the
  baseline's chances, a chart of the chance of having finished by each day with a table of weekly
  rows as its reading, the drivers, the counts and the method. On the Gantt, whenever a range makes
  the runs differ, every bar's accessible name ends "critical in N of 10 runs", and **Shade each bar
  by how often it is critical** shades it — a choice for the visit, stored nowhere. One line on the
  dashboard's finish card; one figure in the weekly report, in the owner's words, with no
  percentage. And, after every other question, an optional one: "What is the most it could take?"
  of a critical activity with a duration and no range — outside the count, and answered as a range
  from its duration to the answer, so it can only run late. **Nothing about the simulation is
  stored** — not a run, not a seed, not a result — and it changes none of the plan's dates: the
  Gantt's bars, the slip, the deadlines and the baselines are the plan's, as they were.

**Why.** A range is what a person can honestly say about a duration, and a simulation is the one
way to combine ranges over a network in which the finish is the latest of several paths. Seeding it
makes the answer a fact about the plan rather than a roll of dice: two people looking at the same
work see the same chance. Natural frequencies — "8 in 10" — are what a person with no training in
statistics reads correctly; a bare "80 %" is read as a promise, and "P80" as jargon. Keeping the
result out of the file keeps the plan the one thing a person changes on purpose.

**Cost accepted.** **The triangle is a choice, not a truth**: real durations can run longer on the
right than a triangle allows, and a person who chose another shape would get other numbers. **A
range is a person's guess**, and the simulation is exactly as good as the guesses; it says so, and
never makes one up. **Activities are drawn independently of each other**: a rainy month slows every
outdoor activity at once, a late delivery holds three trades, and the simulation does not know it —
when causes are shared, the real spread is wider than the one shown. **Runs are capped** on a
plan of more than 10 000 activities and links, so the tails there are rougher. **Flooring says less
than it could**: a chance of 0.79 reads "7 in 10", never "8 in 10" — a careful answer, and sometimes
a pessimistic one. Ranges are not in the baseline, so the chance a plan had on the day it was
approved cannot be read back later, and a range changed after approval is recorded nowhere. And the
plan's own date keeps its place on every screen: a person who reads only the Gantt never learns
that the date has a chance.

## ADR-036 — The owner widened 1.0 before first use {#adr-036}

**Status.** Accepted — 2026-09-29, by Alex.

**Context.** The specification closes 1.0.0 with a rule: nothing enters it without something
leaving it (SPEC §2). Slices F0 to F11 were built to that closed list, and the release, F12, was
prepared on a branch of its own. Before using the product on a work of their own, its owner asked
what would set it apart from every other small-works tool, and the squad proposed four answers to
questions those tools leave to guesswork.

**Decision.** The rule is set aside once, by the product's owner, on 2026-09-29. 1.0.0 gains four
differentiators, each a slice gated as F0 to F11 were — gates green, the end-to-end suite on the
real binary, both themes and both languages captured, the documentation and the decisions written,
one pull request into `develop`:

1. **D1 — "When will it really finish?"** The finish as a probability from each activity's range,
   in natural frequencies ([ADR-035](#adr-035)).
2. **D2 — "Am I paying ahead of the work?"** Payment plans with milestones earned only by facts — a
   gate passed, an activity finished in the diary — and a flag when paid runs ahead of earned.
3. **D3 — The handover book.** One PDF the owner keeps: what was done room by room, every decision,
   photos of hidden work taken before it was closed, permits, warranties, receipts, who did what,
   and the maintenance notes.
4. **D4 — The owner's snapshot.** One self-contained HTML file, with no script, that opens on any
   phone or browser — sent by the person; the product still sends nothing.

The release branch is not merged: the four land in `develop` first, one slice at a time, and the
release is cut again from there. Nothing else in the specification changes — no network, no
account, no AI, one machine, every figure with its rows, the diary and the baselines append-only,
two languages, three lenses.

**Why.** The first real work is the proof the specification asks for (F12), and the owner is the
one person who can say that the product is not yet the one worth proving on it. Each of the four
answers a question an owner or an engineer asks on a real site, and that the tools they already
know leave to guesswork.

**Cost accepted.** **The first use comes later**: four slices now stand between the product and the
real work F12 was waiting for. **A larger surface to prove**: every screen, figure and file the four
add is one more thing to test, capture, translate and keep true, and the release checklist grows
with them. The specification's own rule was the guard against exactly this (R9); it is the owner
who set it aside, once and by name, and a fifth differentiator would need a record of its own.

## ADR-037 — A payment plan is earned by facts, and paying ahead is warned, not refused {#adr-037}

**Status.** Accepted — 2026-09-29. Its closed list of triggers gains a fifth, `retention`, in
[ADR-044](#adr-044): earned only when the stage is closed and its person's snags are.

**Context.** Slice F6 answers what was planned, what was agreed and what was paid, and flags a
payment that goes past what was agreed ([ADR-023](#adr-023), [ADR-024](#adr-024)). It does not see
the mistake an owner makes most often on a small work, which is not paying too much but paying too
soon: half of the tiler's quote before a tile is laid, then a quarter more "for material", and three
quarters of the job paid while a fifth of it is done. Paid is still under committed, so nothing is
flagged, and the owner has lost the one thing that keeps a contractor coming back. The tools an
owner already knows attach a **date** to each instalment; a date says when money is expected, not
whether the work it pays for is there. The product already records the facts that say so — a stage's
start and close gates ([ADR-022](#adr-022)) and an activity finished in the diary
([ADR-020](#adr-020)) — and set them beside the money without joining the two.

**Decision.**

- **A commitment carries a payment plan of milestones.** A **milestone** is a label, a share of the
  commitment's amount in **basis points** — whole hundredths of a percent, so "30 %" is 3 000 and
  "12.5 %" is 1 250 — and the fact that earns it, in an order the person sets (`payment_milestone`,
  migration 011, [`DATA_MODEL.md`](../DATA_MODEL.md)). The shares of one commitment sum to **at
  most** 100 %; what is left is said on the screen as not in the plan yet, never assumed.
- **A milestone is earned by a fact, never by a date or a tick.** Four triggers, a closed list:
  **advance** — earned the day the commitment was agreed, before any work; **stage started** — the
  commitment's stage passed its start gate; **activity finished** — an effective diary entry
  finished that activity, corrections applied, and the activity must belong to the commitment's
  stage; **stage closed** — the stage passed its close gate. A milestone is earned **on** the day of
  its fact, and the screen says since when. It follows the fact both ways: a stage reopened un-earns
  its "stage closed", and a correction that takes back a finish un-earns its "activity finished".
  There is no control that marks a milestone earned, as there is none that sets progress
  ([ADR-009](#adr-009)). An activity a milestone is earned by cannot be removed while the milestone
  names it: the host refuses with a sentence, and the foreign key refuses it after.
- **Four figures per commitment, each with its rows** (`src/domain/milestones.ts`, pure, in cents,
  [ADR-024](#adr-024)). **Earned** — the milestones reached, each a row with its fact and its day;
  **paid** — F6's payments on the commitment, reversals applied; **due now** — earned minus paid
  when that is positive; **ahead of the work** — paid minus earned when that is positive. Per stage
  and for the work they are the sums, with a row per commitment, and the dashboard counts the
  commitments paid ahead. **Due and ahead are never netted across commitments**: a commitment paid
  ahead does not pay what another has earned, so a stage can show money due and money paid ahead at
  once, each with its own rows. A milestone's amount is its share of the commitment's cents, rounded
  half up in exact integer arithmetic (`milestoneCents`); in a plan of exactly 100 % the last
  milestone takes the remainder, so the plan adds up to the commitment's amount to the cent. A fact
  dated after today is not a fact yet: an advance on a commitment agreed for next week is not earned
  this week.
- **A commitment with no plan is not evaluated.** It is neither earned nor unearned: it is counted
  and listed as having no payment plan, and nothing is assumed about it; what was paid on it is
  still shown, and a payment on it is never warned about. A payment that names no commitment is
  outside the question altogether, and a line says how many there are.
- **The warning comes before the payment.** The Ledger's payment form shows, as the person types,
  what the commitment has earned so far, what has been paid, and what would be paid, due and ahead
  after this payment (`paymentPreview`). When the payment would put the owner ahead of the work, a
  caution says so before **Record the payment** is pressed, with the amount, the commitment and the
  next milestone not yet earned. **The button is not disabled**: money paid is a fact, and the
  decision is the person's. A reversal is never warned about.
- **The plan is locked once money has moved.** From the first payment that names a commitment — a
  reversal included — its milestones cannot be added, changed, moved or removed; the host refuses
  with `invalid_input` and a sentence, as it refuses a change to the commitment itself
  ([ADR-023](#adr-023)), and triggers in the schema refuse it again (`money: payment plan locked`);
  the screen shows the plan as it is, with the sentence that says why and no control that would
  change it. This is not the approved plan's lock ([ADR-027](#adr-027)): a payment plan is an
  agreement, not something a baseline records, so no replanning opens it, and a closed stage does
  not refuse it — money is not a plan edit.
- **A usual plan, offered, not advised.** On a commitment with no milestones, **Add the usual plan**
  fills three — 30 % when the stage starts, 40 % when the stage's last activity is finished, 30 %
  when the stage closes — with labels in the person's language, each editable, and the screen says
  it is a common split, not advice. It is refused, with a sentence, on a commitment that already has
  a plan, and — since the middle one names the stage's last activity by position — on a stage with
  no activity yet. The split is data in the host (`USUAL_SPLIT`) and the domain, not a rule.
- **Where it shows.** On Money, by stage: each commitment's **Payment plan**, its earned and due
  figures, and a mark in words when it is paid ahead or has money due. On the Ledger, the preview
  and the warning. On the dashboard's money card, how many commitments are paid ahead and how much
  is earned and not paid, with a sentence under them for the commitments with no plan and the
  payments on no commitment. In the weekly report, the same two figures in the owner's words. And,
  last and optional, the **Next question** asks how a commitment with no plan is to be paid — only
  while no money has moved on it, since after that its plan can no longer be written — and answers
  by opening that commitment's plan, not inline ([ADR-034](#adr-034)). **Nothing is stored but the
  milestones**: earned, due and ahead are computed from the snapshot every time. Readiness does not
  change.

**Why.** A fact of the work is the only thing both sides of a payment can check: the diary and the
gates are the record the product already keeps, and tying money to them makes "is the work there?"
a question with an answer rather than an argument. A warning that arrives with the payment form, not
in a report the week after, is the only one that can change what happens. And refusing the payment
would push an agreed advance, or an honest favour to a good contractor, out of the ledger and into a
notebook — the reason F6 flags and never refuses ([ADR-024](#adr-024)).

**Cost accepted.** **A fact can be recorded late, and the milestone is earned late**: the product
knows the work only through the diary and the gates, so a payment made the day the tiles were laid,
with the diary written on Friday, reads as ahead until then. **An advance is money before work**, by
definition; the product says so plainly on every advance and counts what it earns, rather than
forbidding what many contracts require. **The plan locks after the first payment**: a renegotiated
split cannot be written over the old one, so a renegotiation is a new commitment, and the old one
keeps its amount and its record as they were paid. **Payments on no commitment are not evaluated**:
money paid outside a commitment is counted and said, but nobody can say whether it was ahead of
anything. A commitment with no plan is likewise not judged. **An activity a paid commitment's
milestone names can never be removed**: the milestone is locked, and it holds the activity with it —
the plan keeps the fact it was paid against. A milestone is earned whole or not at all — a share of
an activity's quantities in the diary does not earn a share of its milestone. And a share rounded to
the cent is not always the share a person's calculator gives: in a 100 % plan the last milestone
takes the remainder, and may differ from its own share by up to half a cent for each milestone
before it.

## ADR-038 — The handover book: the work's record for its owner, photos of hidden work required where it matters {#adr-038}

**Status.** Accepted — 2026-10-01. Amended by [ADR-044](#adr-044): each open snag is a gap of its
own, and each fixed snag is printed with both photos, before and after.

**Context.** The third differentiator ([ADR-036](#adr-036)). At the end of a work the owner is left
with a folder of receipts, a phone full of photos and what the builder remembers to say on the way
out. Years later somebody drills into a wall to hang a shelf and finds the pipe nobody photographed,
or a shower leaks under a tile and nobody knows whether the floor was waterproofed, who did it or
whether it is still under warranty. Everything that would have answered those questions passed
through the product — the diary, the gates, the decisions, the documents, the people — but F10's
reports are about a week or about the record, and none of them carries a photo: they count an
entry's photos and say they are in the work's folder ([ADR-031](#adr-031)). A gate can already ask
"were photos taken before the walls were closed?", and a "yes" with no photo answered it.

**Decision.**

- **One PDF for the owner: the handover book.** Written from **Reports**, in the owner's words
  whatever lens is on, in the language on screen. Its content is selected by the domain
  (`src/domain/reports/handover.ts`, pure, keys and no strings) and composed into blocks by the
  interface (`src/features/reports/compose/handover.ts`), as every report is. A **first page** —
  "Written while the work was in progress" first, in strong type, while any stage is open; the
  place, the start, the day the last stage closed or that the work is in progress, the template it
  started from, what the book holds and what it does not, **what it still lacks** with its rows,
  and the people by trade. Then **one section per room**, in room order — or one per stage when the
  work has no rooms, and, when it has rooms, a last section for what touches none, so nothing done
  is left out — with what was done and when (the finished activities and the day the diary says
  they finished), the decisions made with their answers and days, **the photos of hidden work**,
  every one, full width, captioned with the check, its stage and the day; the diary's other photos
  of the section's activities, two to a row, at most six per section, the latest per activity
  first, and how many more are in the work's folder; and the care notes. Then the **documents** by
  kind — permits, warranties, manuals, contracts, receipts — each by its title and file name, the
  day it was added and what it is attached to; **who did what** — everyone in the plan with their
  trade, phone and e-mail, the stages the diary saw them on and their days on site; the care notes
  for the whole work, and any whose room or stage is gone, said so; and last, **the record**: how
  many entries the diary holds, from which day to which, that its chain is verified whenever the
  diary is written out as a PDF, and the day the book was written. The book does not claim a
  verification it did not make: the diary's own export carries that block ([ADR-032](#adr-032)).
  It holds no money and no schedule — they have their own reports.
- **Photos in a PDF.** The report model gains an **image** block — a hash, a caption, and a size,
  `full` or `half`; two half-size images in a row sit side by side. The interface names a photo
  **only by its hash**, 64 lowercase hexadecimal digits; anything else is refused before a file is
  looked for. The host (`src-tauri/src/report/images.rs`) accepts a hash only when a `document` row
  of the open work names it, and only an image — a PDF among the documents is listed by name and
  never embedded, and an image block naming one is refused; reads the original from the work's own
  `documents/` and nowhere else, under the documents' caps (25 MiB, 12 000 × 12 000), and checks
  that its bytes still hash to the name — a file changed outside Ridgebeam is refused; decodes it
  under the `image` crate's limits, turns it the way the camera said, lays any transparency on
  white, scales it to at most **1 600 pixels** on its long edge and embeds it as JPEG at quality 82.
  A JPEG that is already what the page needs — at most 1 600 pixels, 8 bits, grey or colour, not
  turned, at most 4 MiB, and decoding like any other — is embedded **as it is**, byte for byte. A
  document holds at most **400 image blocks and 150 MiB of image data** (each distinct photo counted
  once), and the host refuses one past either with a sentence; the composer never sends more than
  400 — past that, the photos that come later in the book are left out and the book says how many,
  in words. An image block whose hash the work does not hold is refused, not skipped. The second
  reader counts the embedded images in `cargo test`, and checks their size and filter.
- **Hidden work needs its photo.** A gate check can **need a photo** (`stage_check.needs_photo`,
  migration 012): a "yes" on it without a photo is refused by the host — _"This check needs a photo
  of the work before it is closed."_ — and "no" or "not applicable, with a reason" are not. The
  Gates tab turns it on or off for each check while the stage is not closed, and a check that needs
  a photo shows its photo field open. The usual checks and the library's templates gain one
  close-gate check that needs a photo on each stage that closes a wall or a floor over pipes,
  wiring or waterproofing, and the template format gains an optional `"photo": true` on a check.
- **Two more kinds of document**: `warranty` and `manual`, so the book can list them under their own
  headings. Migration 012 rebuilds `document` to widen its `CHECK`, keeping every row with its id,
  every link and the index, and setting the links aside first so that dropping the old table does
  not cascade into them.
- **Care notes.** A sentence of up to 1 000 characters on the work, a room or a stage — _"Reseal the
  shower grout once a year"_, _"The stopcock is under the sink"_ — in an order the person sets
  (`care_note`, migration 012). They are editable at any time, approved plan or not: they are not
  the plan. A room or a stage removed takes its notes with it.
- **The book says what it still lacks.** Before writing, the Reports card shows a counted figure
  with its rows ([ADR-024](#adr-024)) of what the book would be missing: checks that need a photo
  and were answered without one (only an answer from before this slice can be), checks that need a
  photo and are not answered, stages not closed, rooms with no photo, no warranty or manual at all,
  no care note. **Writing is allowed anyway**: an owner may want the book halfway through. When any
  stage is still open, the book's first page says it was written while the work was in progress.
- **Where it lives.** The Plan gains a **Handover** tab — the care notes of the work, each room and
  each stage, and every check that needs a photo with its state and its photo; Reports gains the
  card **The handover book**. The dashboard says nothing new: the book is for the end.

**Why.** The owner keeps the work for decades and the people who built it are gone in weeks; the
book is the part of the record that has to outlive both the product and the builder, so it is a
PDF that opens anywhere and carries the photos itself, not a pointer into a folder. A photo of a
pipe is worth something only if it was taken before the wall was closed, and the gate is the one
moment the product knows the wall is about to be closed — so that is where the photo is asked for,
and a "yes" without one is not a yes. Resolving an image only by hash, inside the open work, keeps
the report command from becoming a way to read any file on the machine into a PDF.

**Cost accepted.** **Photos make a large PDF**: a book with a few hundred photos runs to tens of
megabytes, even scaled to 1 600 pixels — the caps are there so it stays a file a person can keep and
copy, and nothing past them is dropped without a word: photos past 400 are counted and said to be in
the work's folder, and a book past 150 MiB of photos is refused with a sentence. **A photo required
for a "yes" can be taken after the wall is closed, and the product cannot tell**: it checks that a
photo is attached, not what it shows or when it was taken; the book prints the day the check was
answered under the photo, and the honesty of the photo is the person's. **A photo's metadata is
left behind, and so is its colour profile**: a book is handed to other people, so a JPEG embedded as
it is loses its EXIF (which may say where it was taken), XMP and comments, keeping only what decoding
needs, and a re-encoded image carries none; the cost is that a photo with a wide colour profile
prints a little less true. The original in the work folder keeps everything. **Care notes are the person's words, not advice**:
the product prints what was typed and vouches for none of it, and a wrong note — the wrong stopcock
— is printed as faithfully as a right one. **A book written mid-work is incomplete and says so** on
its first page, and its gaps are listed before it is written; a person may still print it and file
it as if it were final. A PDF document — a warranty scanned as PDF, a manual — is listed by name,
never reproduced: the book points to it, and the work's folder keeps it.

## ADR-039 — The owner's snapshot: one file with no script, rendered by the host, sent by the person {#adr-039}

**Status.** Accepted — 2026-10-02. Two details of its lookahead — gates with no checks, and the
decisions' window — are amended by [ADR-040](#adr-040).

**Context.** The fourth differentiator ([ADR-036](#adr-036)). The owner of a small work is rarely
where the product runs: they are at their own job, and at the end of the day they ask, by message,
how the work is going. The answer they get is a sentence from memory, a screenshot of one number with
none of its rows, or the weekly PDF, which a phone shows as a page to pinch and drag. The product
already holds everything the answer needs — readiness, the finish and its chance, what comes next,
the diary and its photos, the money — but it makes no network request ([ADR-006](#adr-006)) and has
no account, so it cannot be the one that sends anything, and a phone app or a web app is outside 1.0
(SPEC §2). An HTML file is the one format every phone opens in the browser it already has. It is
also the one format that can carry a script, load an image from a server that logs who opened it,
or post a form somewhere — whatever the product lets into it.

**Decision.**

- **One HTML file: the owner's snapshot.** Written from **Reports**, on a card of its own, **The
  owner's snapshot**, which says what the file holds and what it does not, and that sending it is
  the person's; the dashboard's header gains **Owner's snapshot…**, which goes to that card with the
  focus on its path. The
  file is saved to the `.html` path the person chose in the save dialog, through F10's write path —
  whole or not at all, over an existing file only when the dialog asked ([ADR-031](#adr-031)) — and
  **Open** shows it in the system's own browser, under F10's rule: only a file a report command
  wrote in this session.
- **The same document model, a second renderer.** The interface composes a report document of kind
  `snapshot` (`src/features/reports/compose/snapshot.ts`) from the same domain selections and the
  same dictionaries as every report; the host renders it to HTML (`src-tauri/src/report/html.rs`)
  where it renders the others to PDF. A heading is a heading and a paragraph keeps its tone; a
  **figure** is `<details><summary>label — value</summary>` with its rows in a list under it, so
  every figure still opens onto its rows with no script, and a figure with no rows is the same line
  opening onto nothing; a table is a `<table>` that scrolls
  sideways on a narrow screen; a rule is a rule; a page break is ignored; a **Gantt** is an inline
  SVG of bars with their text labels and a `<title>` on each bar; an **image** is a JPEG inside the
  file as a `data:` URL. Nothing on the page comes from a second calculation.
- **What it holds, in the owner's words** whatever lens is on, in the language on screen. Its title
  is the glossary's term, _Owner's snapshot_ (_Retrato da obra_), and under it the work's name and
  the day — _"as it stands on {day}"_. **Today**: the place; readiness as a figure, opening onto
  what the plan still lacks, with the dashboard's own sentence under it; the finish date; and D1's
  headline with what moves the finish most, or the sentence that every activity is counted as
  certain ([ADR-035](#adr-035)). **The next two weeks** (below). **Lately on site**: the last five
  effective diary entries, corrections applied, newest first, each with its note whole, what was
  done, who was there by name, and at most two of its photos, captioned with the day and the
  photo's file name, with how many more the day has. **Money**: planned, committed and paid, each
  opening onto its lines, the commitments paid ahead of the work, and what is earned and not paid
  now ([ADR-037](#adr-037)), with what those leave out. And a last line: _"Written by Ridgebeam on
  {day}. A snapshot: it does not change when the work does."_ **Nothing else**: no person's phone
  number or e-mail address and not the Windows account that wrote an entry — the handover book is
  where contacts belong — no document, no baseline, no diary chain.
- **The next two weeks** (`src/domain/reports/lookahead.ts`, pure, keys and no strings): the 14
  calendar days from today, today included, read off the schedule as of today. A closed stage is
  done and contributes nothing, and an activity the diary says is finished is neither starting nor
  running. **Starting** — the activities whose scheduled start is in the window; **running** — those
  that started before it and finish in it or after it, never the same activity twice; each with its
  responsible and its stage. **People** — by the dashboard's own rule for the week (F10), applied to
  the window: whoever answers for an activity starting or running, and whoever is put on a stage
  that has started. **Decisions** — open ones that are overdue or whose deadline falls in the
  window, most urgent first, each with its lead time and the day its stage needs it, so the page can
  say _"to order by 12 Oct"_ ([ADR-017](#adr-017)). **Gates** — the start gate of a stage not yet
  started whose first activity is scheduled in the window, and the close gate of a stage not closed
  whose last activity is scheduled to finish in it, each with the items that hold it, unanswered or
  answered no; a gate that would already pass is listed with none ([ADR-022](#adr-022)).
  **Payments** — what falls due: each milestone not yet earned whose fact the schedule expects in
  the window (an activity's scheduled finish, the stage's first start or last finish, the day agreed
  for an advance agreed after today), less what money already paid ahead on its commitment covers;
  and what is earned and not paid now, D2's own figure ([ADR-037](#adr-037)). Each is a figure with
  its rows. A small Gantt of the window shows every activity starting or running, cut at the
  window's edges and saying so. When the schedule places nothing at all, the figures are empty
  because there is no schedule, and the page says that rather than calling the two weeks quiet.
  Days are said as the owner says them, _"Monday 5 Oct"_.
- **Nothing in it runs, and nothing is loaded.** Every string from the work is escaped, in text and
  in attributes. The file declares its language (`<html lang="en">` or `lang="pt-BR"`), its
  character set and a viewport, and carries a Content-Security-Policy in a `<meta>` element —
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'` — so a browser that honours it
  will neither run a script nor load anything from anywhere, even if a hostile string got past the
  escaping. The style is inline, in the file: one readable column, the system's own fonts, large
  tap targets on every summary, print styles, and **light and dark following the reader's phone**
  through `prefers-color-scheme`. The escape writes the five markup characters, and also `/ : = @ (`
  and the backtick, as character references, so a hostile string can neither become markup nor
  spell an address. Then, before the bytes are written, **the host checks them and refuses the
  write** — as a bug in the product, and said so — unless the policy is there once, before what it
  governs; every `src` is a base64 `data:image/jpeg` address; what remains holds none of `<script`,
  an `on…=` attribute, `javascript:`, `vbscript:`, `http:`, `https:`, `//`, `<iframe`, `<object`,
  `<embed`, `<link`, `<base`, `<form`, `@import`, `url(`, `expression(`, any other `data:` or
  `<!--`; and the page is made only of its own elements and attributes. The rules are listed in
  [`SECURITY.md`](../../SECURITY.md). The escaping, the policy and the check are three defences,
  each tested on its own with deliberately hostile strings.
- **Photos are resolved exactly as the handover book's**: by a 64-hex-digit hash a `document` row
  of the open work names, read from its `documents/` under the documents' caps and checked against
  their hash ([ADR-038](#adr-038)). Then they are **always re-encoded** — at most 1 024 pixels on
  the long edge, JPEG at quality 78 — so no byte of the original, and none of its metadata, reaches
  the file. One snapshot places at most **60 photos and 8 MiB of image data** — counted where they
  are placed, since a page cannot reuse a photo without a script — and the file is at most
  **12 MiB**; one past a cap is refused with a sentence and nothing is written.
- **Ridgebeam writes the file; sending it is the person's act** — by WhatsApp, by e-mail, on a
  memory stick. The product sends nothing, and nothing in either database records that a snapshot
  was written.

**Why.** The question an owner asks most is "how is it going?", and it is asked away from the desk;
the answer that settles it is the dashboard's, rows and all, in their own words, on the phone in
their hand. A file is the only way to give them that without an account, a server or a network
request — the three things the product does not have. Rendering it from the same document model as
the reports means the snapshot says what the screen says, in the same words
([ADR-031](#adr-031)), and that the host, not the webview, writes the bytes another device will
open. `<details>` is the one element that lets a figure open onto its rows without a script, so no
script is needed — and a file that may be forwarded to people the person never meant to reach is
safest when it can do nothing but be read.

**Cost accepted.** **It is stale the moment the work changes**: a snapshot is the work on the day
it was written, and an owner may read Tuesday's file on Friday as if it were Friday's. It cannot
update itself — that would take a script or a server — so its last line says the day and that it
does not change, and the next one has to be written and sent again. **Photos make it a few
megabytes**: ten diary photos at 1 024 pixels come to a megabyte or two, and a messaging app may
compress or refuse a large attachment; the caps keep it to a file a phone opens. **It holds the
work's state, which the person chooses to share**: people's names, the diary's notes as they were
typed, photos of somebody's home and what was paid. It carries no contact and no document, but it
is not encrypted, has no password and does not expire, and whoever receives it can forward it; what
to send and to whom is the person's decision, and once sent the product cannot take it back. **It
is not the 1.2 "crew" sync**: nothing comes back from it — the owner cannot answer a decision,
accept a gate or write in the diary through it — and two snapshots are two copies, never merged.
**A phone's browser decides how it looks within the CSS it is given**: the system's fonts, how
`<details>` opens and how a wide table scrolls differ from one browser to another, a viewer inside a
messaging app may show it differently again, and a viewer that ignores the security policy still
gets a file with nothing in it to run. No script also means no search, no filter and no sorting on
the page: what it shows is what the composer put there.

## ADR-040 — Before the first real work: a drop is a choice, and the product reminds but never backs up on its own {#adr-040}

**Status.** Accepted — 2026-10-02.

**Context.** With D1 to D4 in `develop`, the owner's next step is the one the specification has
asked for since F12: a real work of his own, planned and run through the diary, at his acceptance
test. A first real week meets friction the end-to-end suite never feels. The day's photos are
already in a folder in Explorer, and the diary sends the person to find them again in a dialog; a
quote arrives as a PDF on the desktop, and **Documents** asks for the same. The same crew is on site
most days, and the diary asks for them to be ticked one by one, every day. The work can be backed up
as one file ([ADR-033](#adr-033)), but nothing on the screens a person uses every day says when it
last was: ADR-033 left "never" in Settings as the only nudge, and Settings is not where anybody goes
on a working day. And the owner's snapshot ([ADR-039](#adr-039)) had two details out of step with
the rest of the product: a gate with no checks at all was listed under the gates coming up, as a
gate with nothing holding it, and its decisions stopped one day short of the rule the decisions
screen and the weekly report use.

**Decision.**

- **A drop is a choice.** Files dragged from Explorer and dropped on the window are taken in exactly
  as if they had been chosen in the dialog. The webview's own drag-and-drop event gives their paths,
  and the interface hands them to the **same intake** the dialog's paths go to — no new command, and
  nothing new reaches the host. A drop takes only what that screen's dialog would offer — photos on
  the Diary, photos and PDFs on Documents — and every other name is left out and named in one
  sentence: _"Week 1 was left out: it is a folder, or not a kind of file taken here."_ The interface
  cannot tell a folder from a file, since it has no file-system access, so a folder whose name ends
  like a photo's still reaches the host, which refuses it by name. Where the files go depends on the
  screen. On the **Diary** they join the photos of the entry being written, as **Add photos…** would
  add them — **More…** opens if it was closed — and, like chosen ones, they are copied into the work
  only when the entry is saved. On **Documents** they are added at once, through the same add as the
  page's own form: with the kind the form has selected, attached to what the page is filtered on, or
  to the work when it is not filtered, and with refusals in the page's own list of files not kept.
  On any other screen, with no work open, or before the diary's form is on the screen, a sentence
  says where files can be dropped — _"Drop photos on the Diary, or files on Documents."_ — and
  nothing happens. What reaches the host is refused in the same sentences as a chosen file, because
  it is the same intake: the host types a file by its bytes and measures it whatever its name
  ([ADR-025](#adr-025)).
- **One overlay says what a drop will do.** While files are over the window, one overlay covers the
  whole window and says what will happen on this screen: that they will join the entry's photos,
  that they will be added to the work's documents, or that nothing will happen here and where to go
  instead. It has its own polite live region, it is gone when the files leave or land, and it does
  not move when the person has asked for reduced motion. After a drop that nothing took, the
  sentence stays as an information bar at the top of the content, announced, that can be closed, and
  goes at the next screen or the next drag ([`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) §8).
- **Same people as last time.** Under the list of people in the diary entry, **Same people as
  {day}** ticks exactly the people present in the latest **effective** entry that names anybody — a
  correction replaces what it corrects, as everywhere else ([ADR-019](#adr-019)), and a day nobody
  came says nothing about who comes. It adds to what is already ticked and never unticks anybody. A
  person present that day and since removed from the plan is skipped, and the form says how many:
  _"2 of them are no longer in the plan."_ If all of them are gone, the button is still there;
  pressing it ticks nobody and says so. Each press is announced. The button is not shown when no
  entry names anybody, when the plan has no people, or while a correction is being written, which
  says who was there on its own day. Who was there is still the person's answer, entry by entry
  ([ADR-026](#adr-026)); the button only saves the ticking. The rule is the domain's
  (`lastPresence`), pure and tested.
- **The product reminds; it still never backs up on its own.** The dashboard says, quietly, under
  its header, when the work **has never been backed up on this machine** and holds anything at all —
  a diary entry or an activity — or when **the last backup is more than 7 calendar days old and the
  work has changed since**: _"This work has never been backed up on this machine."_ or _"The last
  backup was 9 days ago, and the work has changed since."_ Exactly 7 days is not yet stale; 8 is.
  The rule is the domain's (`backupDue`), from the day of the last backup this machine wrote
  ([ADR-033](#adr-033)) and the latest moment the work records — an entry written, a payment, a
  check answered, a stage started or closed, a decision made, a document added, a baseline taken —
  and nothing new is stored. A change on the day of the backup counts as backed up, since the host
  keeps only the day. The line is muted and never red: a missing backup is a risk to the record, not
  a fault in the plan. Its button, **Back up now…** (_Fazer a cópia de segurança agora…_, the
  glossary's term), goes to **Settings → This work** with the focus on the backup's file field — the
  same move as **Owner's snapshot…** ([ADR-039](#adr-039)) — so the backup is written by the one
  flow that already exists, and it is still the person who chooses where and presses the button.
  Once a backup is written the line is gone. **Not now** hides it for this work until the product is
  next started, as **Skip for now** does for a question, and nothing of it is stored.
- **The snapshot follows the product's own rules.** In **The next two weeks**, a gate with no checks
  at all is neither listed nor counted under the gates coming up: it holds nothing, and readiness
  already says that a stage has no checks ([ADR-018](#adr-018)). The snapshot's decisions are chosen
  by the same predicate as the decisions screen and the weekly report — open, and overdue or due
  within the next 14 days, day 14 included — from the same function (`decisionsDueWithin`, with the
  weekly report's window), not a copy of it. This amends those two details of [ADR-039](#adr-039)
  and nothing else in it.

**Why.** The first real week is the test, and a person who meets the same small chore every evening
stops writing the diary before the week is out — and the diary is the fact the product stands on.
Dragging a file onto a window is how Windows has always taken files in; it costs nothing to honour
if a drop is only another way of choosing, and taking a drop through the dialog's intake means the
rules a file is held to cannot drift between the two ways in. A reminder is the least the product
can do about the specification's first risk, the record lost (R1), without doing the one thing it
has decided not to do: write a copy of somebody's home and money to a place they did not choose.
And two readings of one fact agree (`DESIGN_SYSTEM.md` §2): a decision listed in Friday's weekly
report and missing from Friday's snapshot is a contradiction the owner would find before we did.

**Cost accepted.** **A drop on the wrong screen does nothing, and says so**: the product does not
guess whether a photo dropped on the Schedule was meant for the diary or for the documents, so the
person goes to the right screen and drops it again. **What the interface cannot see, the host
refuses**: with no file-system access, the interface knows a dropped thing only by its name, so a
folder named like a photo goes to the host and is refused there, and a real photo whose name the
dialog would not offer is left out as the dialog would not have shown it. **A drop on Documents goes
where the page is looking**: it takes the kind the form has selected and is attached to what the
page is filtered on, so files dropped while the page shows one stage are attached to that stage; a
wrong kind or attachment is put right afterwards, as for a chosen file. **The reminder can be
ignored, and the product still never backs up on its own**: a person who presses **Not now** every
time, or never opens the dashboard, has no backup, exactly as before. The reminder knows only the
backups **this** machine wrote — a work restored from another machine, or copied by hand, reads as
never backed up until one is written here — and it cannot tell whether the file it remembers still
exists. An edit made to a row of the plan in place — a name, a duration — leaves no moment behind,
so it is not seen as a change: the reminder can come later than it might, never wrongly. ADR-033's
"never reminds" no longer holds; the rest of its cost does. **"Same people" can tick somebody who
was not there**: it is a convenience, and a person who presses it and saves without looking has
written that the tiler was on site when he was not. The person still answers for the entry — it
carries their Windows account, it is chained, and it is put right only by a correction that says
what was wrong — so the button saves taps, never the responsibility. **The snapshot's decisions now
follow the same 14-day rule as the rest**: a decision whose deadline is the fourteenth day after
today is listed, though the rest of **The next two weeks** ends the day before; one day of overlap
was judged better than two files that disagree. And a stage with no checks no longer appears under
the gates coming up, so the snapshot says nothing of that stage's gates; readiness, in its first
section, is where that gap is said.

## ADR-041 — Change orders: nothing changes without a price and a date {#adr-041}

**Status.** Accepted — 2026-10-02.

**Context.** With D1 to D4 and U1 in `develop`, the owner asked once more before his acceptance
test — not for polish, but for what would make the product a necessity for a work that is managed
and ends well. Every small work that goes wrong goes wrong in one of four ways, and each ends in a
hard conversation with nothing written down to settle it. **It grows by small changes nobody
priced** — "while you are here, put a socket there" — and the owner learns at the end that it cost
a fifth more and finished a month late, with no way to say which change did it. **The money runs
out before the work does**: the funds arrive when the bank says, and the schedule and the payment
plans ask for money when the work says. **It is late, and nobody can say on whose account** — the
weather, a decision made late, a crew that did not come, a delivery that did not arrive. **It ends
badly**: the last payment made with defects still open, and with it the only reason anybody had to
come back. The squad proposed one slice for each — **E1** change orders, **E2** funding and the
cash runway, **E3** the delay ledger, **E4** the snag list and retention — each answering with a
record that holds up in that conversation: offline, with no AI, every figure with its rows.
[ADR-036](#adr-036) said a fifth differentiator would need a record of its own; this is that record
for the second wave, and the decision for its first slice.

For the first, the product already has the parts and does not join them. A replanning asks why an
approved plan changed ([ADR-027](#adr-027)), but its reason is a sentence: it does not say who
asked, what it cost or what it did to the finish. The what-if computes what a change would do to the
finish, and is never kept ([ADR-028](#adr-028)). A cost line holds money with no reason. So "can we
add a socket?" is answered on site, in a sentence, and the plan learns of it — if ever — as an edit
inside a replanning whose reason says "changes".

**Decision.**

- **The second wave is admitted.** E1 to E4 are gated as D1 to D4 were — gates green, the
  end-to-end suite on the real binary, both themes and both languages captured, the documentation
  and the decisions written, one pull request into `develop` each. The release branch stays open,
  and the release is cut again from `develop` after them. Nothing else in the specification changes.
  E2, E3 and E4 record their own decisions when they are built.
- **A change order is a record, raised after the plan is approved.** Before approval there are no
  change orders — the plan is still being written, and a change to it is an edit — and the host and
  the schema refuse one. A change order carries a **number** — #1, #2, … in the order raised, never
  reused; the day it was raised; a title (1–200 characters) and an optional description (up to 2
  000); **who asked** — the owner, a person of the plan, or somebody else by name; the **stage** it
  lands on, which must not be closed; its **price** in cents, signed, because a change can save
  money, or _not priced_, which is not 0; and its **effects** (`change_order`, migration 013,
  [`DATA_MODEL.md`](../DATA_MODEL.md)). The person asked for is not a foreign key: a person removed
  from the plan leaves the record as it was written.
- **Effects are data the schedule can compute.** A closed list of three: **add** an activity to the
  change's stage, with a name and a duration of 1–3 650 working days, finish-to-start after an
  existing activity or after none; change an existing activity's **duration**; **remove** an
  activity, which narrows the scope. At most 50 effects; none at all is a change that is only money.
  The host validates them when the change is raised — the kinds, the ranges, that every activity
  named exists and is not in a closed stage, that a new duration lies inside the activity's range,
  that an activity a payment milestone is earned by is not removed, that no activity is named twice,
  and that the change's stage exists and is not closed — and stores them as written. **The host
  never computes a schedule.**
- **Insert-only.** A change order is never edited or removed. A mistake is withdrawn and raised
  again under a new number, and the record keeps both. The tables carry the trigger battery of the
  baselines, the diary and the ledger, and the Rust module that writes them holds no `UPDATE`,
  `DELETE` or `REPLACE`, which a test reads its source to prove.
- **The impact is the schedule's, never typed.** The domain applies a change's effects to a copy of
  the plan in memory (`withEffects`) — a new activity with its link, a duration overridden, an
  activity taken out with its links — and schedules it with the same engine and the same what-if
  delta as the Schedule's **What if** card ([ADR-028](#adr-028)): the finish before and after, the
  difference in **working days**, signed, the activities it moves as a figure with its rows, and the
  price (`changeImpact`). It is shown as the change is written, before it is saved, and again in the
  dialog that decides it. An activity added off the critical path moves the finish by no day, and
  the screen says so.
- **One decision per change, and it freezes the impact.** A change is **approved**, **declined** or
  **withdrawn**, once, on a day, with an optional note (`change_order_decision`). The decision keeps
  the finish before and after and the working days between them as the domain computed them at that
  moment, and the price copied from the change: the host stores them as the facts of that day. A
  second decision on the same change, a decision on a change the work does not have, and an approval
  before the plan is approved are refused with a sentence.
- **An approval applies the change, inside a replanning, in one transaction.** If no replanning is
  open, the approval opens one with the reason _"Change order #N — {title}"_ and the account's name,
  as a replanning is always opened; if one is open, the change joins it and its reason is not
  rewritten. The effects are applied through **the same functions the plan's own commands use** — an
  activity and its link added, a duration changed, an activity removed — so they meet the same
  refusals; if any one fails, the whole decision is refused with a sentence and nothing is written.
  A change priced at 0 or more adds a cost line on its stage labelled _"Change order #N"_; a saving
  — a negative price — adds none, because a planned amount is never negative: the person lowers the
  plan's own lines by hand in the same replanning, and the decision keeps the amount. The decision
  is recorded with the replanning it went into. A decline or a withdrawal writes the decision and
  nothing else. **The baseline is not taken**: the person reviews the plan and takes the next one as
  always ([ADR-027](#adr-027)), and its reason names the change.
- **A standing tally.** `changeTally` counts the changes approved, declined, withdrawn and waiting,
  and sums the price and the frozen working days of the approved ones, with a row per party who
  asked. Three figures carry their rows ([ADR-024](#adr-024)): **Changes approved** (money), **Days
  added by changes** (working days) and **Waiting for a decision** (a count, each row saying how
  long that change has waited). They are on the dashboard's **Changes** card, which is not shown
  before approval; in the weekly report, as the changes decided that week and those waiting; and in
  the owner's snapshot, as what waits for the owner's decision and the tally. A comparison of two
  baselines lists the change orders decided between them as rows of their own
  (`Comparison.changes`), so money and days that moved between two baselines can be read against the
  changes that moved them, not only against the reasons' sentences.
- **Readiness learns one rule.** A change order that has waited more than **7 calendar days** for a
  decision is something the plan does not know, like a decision past its deadline: its own row in
  the rule table, in the owner's words _"a change is waiting for your decision"_
  ([ADR-018](#adr-018)).
- **Where it lives.** The Plan gains a **Changes** tab: the change orders newest first — number,
  title, who asked, state, price and days — the form that raises one, and on each change waiting,
  **Approve…**, **Decline…** and **Withdraw…**, each through a confirmation that shows the impact
  again. Before approval the form is not offered, and a sentence says why. After an approval the
  screen says that the replanning is open with the change applied and that the next baseline is the
  person's to take, and offers to go to the Schedule.
- **Words.** The glossary gains _change order_ (_aditivo_). In the owner's lens a change the owner
  asked for is _a change you asked for_. Days are always working days, and the screen says so.
- **ADR-028 is not amended.** A what-if is still never written, and there is still no button that
  applies one. A change order is not a what-if kept: it carries who asked, a price and a number, it
  is recorded before it is decided, and the dialog that approves it says that approving opens the
  replanning — which the person still has to close.

**Why.** The price and the date of a change are cheapest to know before anybody says yes, and least
disputed when they were written down then. The schedule could already compute them; what was
missing was the record — who asked, on which day, for what, at what price — and a decision that
keeps what the schedule said at the moment it was made. A computed impact is one both sides can
work out again; a typed one is a claim. An approval that writes through the plan's own functions,
inside a replanning, obeys the approved plan's lock and ends in a baseline like any other change,
refused in the same sentences. And the danger of a small change is that it is small: the tally is
there because the sum is what nobody sees.

**Cost accepted.** **A change order is immutable**: a typo in a title, a wrong price or a forgotten
effect is put right by withdrawing the change and raising it again under a new number; the record
keeps both, and the numbers have gaps somebody may ask about. **The impact frozen at the decision is
that day's schedule**: the plan moves later for other reasons — a slip in the diary, another change,
a holiday added — and the days a change says it added are what the schedule said the day it was
decided, not what it cost in the end; the tally sums those days, so it is not the slip, and need not
add up to how far the finish has moved. Saying why the work is late is the delay ledger's (E3). **An
approval writes into the plan inside a replanning the person still has to close**: the plan changes
the moment the change is approved, and the baseline comes only when the person takes it. There is no
abandon ([ADR-027](#adr-027)): a change approved by mistake is undone by another change order, or by
putting the plan back inside the same replanning, and its decision stays on record. When a
replanning was already open, the change joins it and the baseline's reason does not name it; the
comparison lists it. **"Who asked" is a record, not a signature**: the product has no accounts, the
person asked signs nothing, and the decision carries the name the Windows account gives, as an entry
in the diary does. **The price is planned money, not an agreement**: an approved change's price is a
cost line, and what is agreed with the contractor for it is still a commitment on **Money**, and
what is paid a payment. **A saving is not written into the plan**: a planned amount is never
negative, so an approved change that saves money adds no line, and until the person lowers the
plan's own lines by hand the tally says the work saved money and the planned total does not. **Three
kinds of effect are not every change**: a change that moves a link, a lag or the calendar is raised
with its price and its words, its schedule is put right by hand inside the replanning, and the
impact shown before the decision did not include it. **A change left waiting lowers readiness**:
after a week, a change raised and not decided is something the plan does not know, even when it was
raised only as a note.

## ADR-042 — Will the money last? Funding as plan, receipts as facts, a weekly projection {#adr-042}

**Status.** Accepted — 2026-10-02.

**Context.** This is E2, the second slice of the second wave ([ADR-041](#adr-041)), and the second
of the four ways a small work fails: **the money runs out before the work does**. The product
already knows, in detail, what the work will ask for and when. The cost lines are the plan's money
and the commitments what was agreed ([ADR-023](#adr-023)); a payment plan says which fact of the
work earns each share of a commitment ([ADR-037](#adr-037)); the schedule says the day each of those
facts is expected; and the owner's snapshot already lists the payments falling due in the next two
weeks ([ADR-039](#adr-039)). It knows nothing about the other side. The owner's money arrives when
somebody else says — a loan released in tranches after an inspection, a client who pays by
instalments, savings set aside — and an owner who has enough money for the whole work can still
have none in the week the tiler's second milestone falls due. Nothing on the screen said so: Money
compares planned, committed and paid, and every one of them is money going out.

**Decision.**

- **Funding is plan.** A **fund** (`funding`, migration 014, [`DATA_MODEL.md`](../DATA_MODEL.md)) is
  money the work expects to receive: a label of 1–200 characters — _Savings_, _Loan tranche 2_;
  where it comes from, optionally, in up to 200; an amount in cents, greater than zero; the day it
  is expected; and an optional note — listed in the order written, with no reordering. It is changed
  like a commitment, not like the plan, amount and day included, whether or not money was received
  against it: an approved plan's lock ([ADR-027](#adr-027)) does not cover it, because funding is
  not the plan's scope and no baseline records it. A fund is removed only while nothing received
  names it; after that the host refuses with a sentence, and the schema refuses again.
- **Receipts are facts.** Money that has actually come in is a **receipt** (`funding_receipt`),
  recorded on the day it arrived — **Mark as received…** on a fund, or on no fund at all for money
  that arrived unplanned. The receipts are a ledger exactly like the payments ([ADR-023](#adr-023)):
  numbered 1, 2, 3 … in order, append-only, never edited or removed; a mistake is corrected by a
  **reversal** — a negative receipt naming the one it reverses, for the same fund, for its whole
  amount, dated on or after it, with no note, once only. Unlike a payment, a receipt is not reversed
  in part: money that arrived short is a reversal and a new receipt of what did arrive. The table
  carries the battery of migration 007, and the Rust module that writes it holds no `UPDATE`,
  `DELETE` or `REPLACE`, which a test reads its source to prove. **A receipt's day is never after
  today**: money that has not arrived is a fund, not a receipt. The host refuses a day in the future
  with a sentence; the schema cannot, because it has no clock it can trust. The commands are
  `funding_add`, `funding_update`, `funding_remove`, `funding_receipt_add` and
  `funding_receipt_reverse`, each returning the work's snapshot, which now carries the funds by
  position and the receipts by number.
- **The projection is the domain's, week by week** (`runway`). From the snapshot, the schedule, the
  diary and today, it returns one row per calendar week, Monday to Sunday, from the current week to
  the week of the finish — or eight weeks past today when the plan has no finish — and never more
  than 260 weeks. It opens with the money on hand today: **receipts to date less payments to date**,
  both ledgers with their reversals. Then, week by week:
  - **Out** is what the work will ask for that week, from what the product already holds, none of it
    typed for the purpose. A **milestone** of a payment plan not yet earned falls on the day the
    schedule expects its fact — the stage's start, an activity's finish, the stage's close — net of
    what was paid ahead on that commitment, as the snapshot's next two weeks already reckon it; the
    function that says that day (`expectedOn`) moves out of the lookahead into `milestones.ts`, so
    the snapshot and the projection read one answer. A milestone whose expected day has passed and
    that is still not earned is still owed, and falls in the current week; **money earned and not
    paid** is owed now, and falls in the current week too. The rest of a **payment plan that covers
    less than its commitment**, and the unpaid rest of a **commitment with no payment plan**, are
    spread evenly over the working days left in the stage — from today, or from the stage's start
    when that is later, to the stage's finish. **Money planned and not yet committed** — a stage's
    planned amount less its committed amount and less what was paid on the stage outside any
    commitment, when that is more than zero — is spread the same way. A **closed stage**'s money
    still owed falls in the current week. **Money the schedule cannot date** falls in the current
    week, and the projection says so in a note. A cost line not priced yet contributes nothing, and
    is counted in a row that says so.
  - **In** is what each fund still expects — its amount less what was received against it — on its
    expected day. A fund expected today counts. **A fund expected on an earlier day and not received
    is not counted**, and a note says how much: _"1 expected sum has not arrived: $5,000.00 not
    counted — money that has not come is not money."_
  - A week's **closing** is its opening plus what comes in less what goes out, and the next week
    opens with it. **Money dated after the last week** is listed, not counted.
  - The result is one of four states: the money **lasts**; it runs **short**; there is money going
    out and **no funding** recorded; or there is **nothing** to project.
- **One sentence, and figures with their rows.** The projection says, in one sentence, the first
  week whose closing is below zero and by how much — _"Money runs short in the week of 16 Nov —
  $4,200.00 short."_ — or, when no week is, what is left at the end — _"The money lasts to the end,
  with $1,800.00 to spare."_ — and beside it the late funds and the lines not priced. A short week's
  closing reads _"$700.00 short"_, never with a minus sign. Four figures carry their rows
  ([ADR-024](#adr-024)): **Money on hand today** (money), **Money runs short in the week of** (the
  week's Monday, as a day), **Money left at the end** (money) and **Money expected and late** (a
  count, each row a fund and the day it was expected). Every week is a row, and every row opens onto
  what was added up in it.
- **The chance, from D1's ranges.** `finishProbability` ([ADR-035](#adr-035)) gains an optional
  per-run hook that receives each run's activity starts and finishes; no result of D1 changes, and
  neither does its seed. `runwayChance` places each run's milestones and spread money on that run's
  days and counts the runs whose balance goes below zero in any week up to that run's own finish
  week, said as a natural frequency — _"3 in 10 chances that the money runs short before the work
  ends."_ On the 2 000-activity benchmark work it takes about 0.3 s. Where no activity has a range
  there is no chance to give, and the card says so: _"Every duration is taken as certain, so the
  weeks below are the only answer. Give activities a range to see the chance."_
- **Readiness learns one rule** (`work.funding`). A work whose priced planned money is above zero
  and that has no fund recorded does not know where its money comes from — money received with no
  fund does not answer it: its own row in the rule table, _"Where the money comes from is not
  written down yet."_ ([ADR-018](#adr-018)).
- **Where it lives.** **Money** gains a **Funding** tab: the funds, each with its source, amount,
  day and what was received against it — added, changed at any time, amount and day included, and
  removed only while nothing was received; **Mark as received…**, which asks for the amount and the
  day; and the receipts ledger, with its reversals. Money gains a card titled **Will the money
  last?**, with the sentence, the chance, a table of the weeks and a small balance chart drawn as
  the S-curve is, ending with what it is: _"A projection, not a promise: it is as good as the
  schedule, the payment plans and the dates typed here."_ The dashboard's money card shows the
  week's Monday when the money runs short, or the money left at the end when it lasts, with the
  sentence; it does not run the chance. The weekly report projects from the day it is written and
  prints the sentence, with the short week's rows, or none when the money lasts; the owner's
  snapshot carries the sentence.
- **Words.** The glossary gains _funding_ (_recursos_): money the work will receive, from where and
  when. A receipt is _money received_ (_dinheiro recebido_). There is no word for the runway: the
  sentence says it.
- **Change orders.** A change order waiting for a decision is **not** projected — nobody has decided
  it. An approved one is already in the plan, as its cost line and its activities, and is projected
  like any other planned money ([ADR-041](#adr-041)).

**Why.** The owner does not need a cash-flow statement; he needs to know, before the week comes,
whether there will be money in it. The money going out was already in the product, computed from
the schedule and the payment plans rather than typed; the money coming in is a handful of sums and
dates the owner knows. Read together, they name a week — and a week named a month ahead is a
conversation with the bank, or the contractor, held in time rather than on the day the money is not
there. Funds are plan and receipts are facts for the reason cost lines are plan and payments are
facts: the plan moves when the bank moves, and what arrived must not. Money expected and not
received is left out rather than assumed, because a projection that counts a late tranche says the
money lasts in exactly the week it does not.

**Cost accepted.** **A projection, not a promise**: it is as good as the schedule, the payment plans
and the dates the owner typed — and the card says so in those words. A schedule that slips moves the
money going out, a fund's day typed from hope moves the money coming in, and nothing checks either
against a bank. **Money that has not arrived is not counted**: a tranche a day late can make a week
short that it would have covered, and the sentence says so until the receipt is recorded or the
fund's day is moved. **Uncommitted planned money is spread evenly** over its stage's working days,
and so is the rest of a commitment with no payment plan, which a real invoice will not be: the week
it lands in can be wrong by the length of the stage, and a payment plan is what makes it exact.
**The chance uses D1's ranges and nothing else**: only the durations vary between runs — a fund that
arrives late, a price that rises or a payment made early is the same in every run. **The week is the
unit**: money that goes out on a Monday and comes in on the Friday of the same week nets out, and a
few days short inside one week are not seen. **What was paid before any money was recorded as
received counts against the money in hand**: a work whose payments are in the ledger and whose
receipts are not opens below zero, and the projection says the money has already run short until
what paid for them is recorded. **Money in is recorded, not connected**: the product holds no bank
connection and imports no statement, so a receipt is what the person typed, and reconciling it with
the account is theirs.

## ADR-043 — As things stand: a forecast from the diary, and a ledger of why it is late {#adr-043}

**Status.** Accepted — 2026-10-04.

**Context.** This is E3, the third slice of the second wave ([ADR-041](#adr-041)), for the third of
the four ways a small work fails: **it is late, and nobody can say on whose account**. Until now the
product could not even say how late. Its one measure of lateness is the slip
([ADR-016](#adr-016)): the plan's finish against its baseline's — plan against plan, which moves
only when somebody edits the plan. What the site actually did is in the diary, and progress is
derived from it, with the day each activity started and finished ([ADR-020](#adr-020)), but nothing
read those days forward to a finish. Comparing what happened with the baseline was deferred slice
after slice: ADR-020 left it to F8 and F10; a comparison of two baselines is plan against plan
([ADR-028](#adr-028)); and the weekly report compares the plan with its latest baseline and does not
put actual dates beside baseline dates ([ADR-031](#adr-031)). So a work three weeks behind on site,
whose plan nobody had touched, showed a slip of 0. And the reasons were scattered across the record
with nothing adding them up: a day marked lost said that no work was possible and not why; a
decision's deadline was computed ([ADR-017](#adr-017)) and the day it was made was recorded, and
nothing compared the two after the fact; a change order kept the working days it added, which
[ADR-041](#adr-041) says plainly are not the slip, leaving why the work is late to this slice. This
is the comparison that was deferred, and the ledger that reads it.

**Decision.**

- **The forecast is the domain's, read from the diary** (`forecast`). From the snapshot, the plan's
  schedule, the diary and today, it lays the same activities and links as the schedule
  ([ADR-015](#adr-015)) on the same working calendar, with the same lags, forward from what the
  diary says happened. A **finished** activity is pinned at its diary dates, from the day it started
  to the day it finished. A **started** one keeps the day it started, and finishes no earlier than
  its planned duration from that day and **not before today**, because it is not done. One **not
  started** starts when its links allow and **not before today**. A link into an activity that has
  started is spent: whatever was before it, it started, so the link holds nothing back in the
  forecast. With the diary empty and today on or before the start, the forecast is the schedule,
  day for day. The forecast returns each activity's start and finish, the forecast finish, the
  forecast's own critical chain, the working days between the forecast finish and the latest
  baseline's finish, signed — none before the plan is approved, because there is nothing to measure
  against — and the working days between it and the plan's own finish date. It is computed every
  time and never stored. **The plan's schedule is untouched**: `schedule()` still reads only the plan, and
  the Gantt still draws the plan.
- **ADR-016's slip is not amended.** The slip stays what it is — how far the plan's own finish has
  moved past its baseline — and stays plan against plan. The forecast is a second, different
  number: how far what happened on site has moved it. The two are shown apart, each labelled with
  what it is, and never as one number.
- **The ledger says why** (`delayLedger`). Its total is the forecast's difference from the baseline,
  in working days of the plan's calendar, signed. Each of its entries is a cause, the party the
  record names where it names one, the working days, and the rows they were counted from. **One
  cause per working day per activity**, taken in this order so that no day is counted twice:
  1. **A change order** approved after the baseline the forecast is measured against: the working
     days its decision froze ([ADR-041](#adr-041)); the party is who asked — the owner, a person of
     the plan, or somebody else by name.
  2. **A stated cause** — a day the diary marks lost and says why (below): that cause, and the
     person it names, for each working day lost while an activity of the forecast's critical chain
     was running or due to start.
  3. **Weather** — a day marked lost, or a rain or storm day with nothing done (the dashboard's rule
     for weather days lost), that states no cause, on the same condition.
  4. **A decision made late** — a decision made after its deadline in the baseline, which is the
     baseline's start of its stage less its lead time: the working days between that deadline and
     the day it was made, **capped at the working days its stage actually started late against the
     baseline**. A late decision that delayed nothing costs nothing. The party is the owner.
  5. **Absence** — a working day with an entry on which the person responsible for a running
     activity of the critical chain was not on site and nothing was done on it; the party is that
     person. **A day with no entry is not absence**: unknown is not absent.
  6. **Not explained** — the total less everything attributed, said in words whenever it is above
     zero — _"3 days the record does not explain"_ — never folded into another cause and never left
     off.

  When the forecast is on or ahead of the baseline, the ledger says so and attributes nothing: it
  does not invent causes for a delay there is not. Before the plan is approved, it says that it
  needs an approved plan. Three figures carry their rows ([ADR-024](#adr-024)) — **days late as
  things stand**, **by cause** and **by party** — each in working days, opening onto the entries,
  the decisions and the changes they were counted from.

- **A lost day can say why** (migration 015, [`DATA_MODEL.md`](../DATA_MODEL.md)). `diary_entry`
  gains two nullable columns. `lost_cause` is one of a closed list of seven — weather, waiting for a
  decision, a crew that did not come, material that did not arrive, the owner's request, no access
  to the site, other (`weather`, `decision`, `absence`, `material`, `owner`, `access`, `other`).
  `lost_party_person_id` is the person of the plan the cause names and, like every person an entry
  names, not a foreign key: a person removed from the plan leaves the entry as it was written. A
  `CHECK` allows either only on a day marked lost; the host refuses, with a sentence, a cause on a
  day not marked lost and a party who is not a person of the plan, and the domain refuses them
  before the host is asked. Nothing is back-filled: an entry written before this slice has no
  cause, and the product does not guess one after the fact.
- **The chain is extended, not rewritten.** The canonical form ([ADR-019](#adr-019)) gains one
  record after the photos — `lost` · cause · party — **written only when the entry has a cause**. An
  entry with no cause, which is every entry written before this slice and every one written after it
  without one, serialises to the same string and hashes to the same value, byte for byte: no old
  hash changes, no chain is computed again, and the migration touches no diary row. The tag stays
  `entry.v1`, because every earlier entry still verifies under it unchanged. The append-only
  triggers already cover the table, so the new columns cannot be updated; a cause is changed as
  everything in the diary is, by a **correction** that restates the day. `cargo test` hashes every
  entry of a real schema-14 work — entries, a correction and photos — before and after the
  migration and finds them equal, with the chain verifying on both sides.
- **The exports carry it.** The diary CSV gains two columns, the cause and the person, under the
  same neutralisation as every cell ([ADR-032](#adr-032)); the JSON export carries `lostCause` and
  `lostPartyPersonId` on every entry, `null` when there is none, which a reader needs to recompute
  the hash.
- **Where it lives.** In the diary entry form, when **No work was possible** is ticked, **Why?**
  offers the seven causes and — for a crew that did not come, material that did not arrive and
  anything else — **Who**, a person of the plan, optional; the entry then reads _"Lost — waiting
  for a decision"_, with the person's name when one is given. The **Schedule** gains an **As things
  stand** card beside the finish and the slip: the forecast finish, the working days against the
  baseline and against the plan's own finish date, and a sentence that says which is the plan and
  which the forecast — _"As things stand it finishes on 23 Oct — 5 working days after the baseline's
  16 Oct."_ The **Dashboard** gains **Why is it late?**: the days late as things stand, the ledger by
  cause and by party, and the row the record does not explain. The weekly report prints the
  forecast's sentence and the ledger; the owner's snapshot prints the sentence and the leading
  causes, in the owner's words.
- **Words.** The glossary gains _forecast_ (_previsão_): when the work will finish as things stand
  — the record's date, shown beside the plan's finish date and never in its place. The ledger has no
  term of its own; the titles say it — **As things stand** (_Do jeito que está_) and **Why is it
  late?** (_Por que está atrasada?_) — and the causes are said in the owner's words.

**Why.** "How late are we, and why?" is the question every late work ends on, and the answer is
usually the louder party's. The facts were already in the record — the days the diary says were
lost, who was on site, when each decision was made against when it was due, what each change added —
and none of them depends on anybody's memory; what was missing was reading them forward to a date
and adding them up against the baseline. A forecast from the diary says what the site has done to
the finish, which the slip never could. A ledger that attributes every working day of the
difference, and says in words what it cannot attribute, turns an argument about impressions into a
list of days that both sides can open and check. The order of the causes is fixed so that the same
record always gives the same ledger, and so that the most specific record wins: a change order's
frozen days first, then what the person on site said, then what the weather, the decisions and the
diary's attendance show. And a cause written into the hash is one nobody can quietly change once
the conversation has started.

**Cost accepted.** **The forecast assumes the rest goes to plan**: every activity not finished takes
its planned duration — from the day it started, and never ending before today — so a crew working
at half speed is forecast on time until its activity runs past its duration, and the forecast moves
from then on, a day at a time. It is one date, not a range; the chance is still D1's, from the plan
([ADR-035](#adr-035)). **One cause per day, by a fixed priority**: a day lost to rain while the
owner had not yet chosen the tile is counted once, under the first cause in the order, and the
other is under-counted; the ledger does not split a day. **A day with no entry is unknown, not
absence**: a crew that did not come on a day nobody wrote anything is in _not explained_, not on
the crew's account — the dashboard's count of days without an entry is where that silence shows.
**A late decision costs at most what its stage lost**: the working days between its deadline and the
day it was made are capped at how late its stage actually started against the baseline, so a
decision made late while something else was holding the stage reads as costing less than it might
have, or nothing. **The critical chain is the forecast's as it stands today**: a day lost on an
activity that was critical then and is not now is not counted under its cause, and falls into _not
explained_. **A change's days are the days its decision froze**, as [ADR-041](#adr-041) says — what
the schedule said on the day it was decided, not what it cost in the end. **A lost day written
before this slice has no cause**: it counts as any lost day with no cause stated does, and saying
why now takes a correction. **The ledger attributes; it does not judge.** It says which record a day
of delay was counted from and whom that record names. It is not a claim, not a finding of fault and
not legal evidence — a crew that did not come may have been sent elsewhere by the owner, and a
decision made late may have waited on a quote that never came — and what a day of delay is worth,
and on whose account it falls under a contract, is the contract's and the jurisdiction's to decide.
**The party is who the record names**: the person an entry names, the owner for a decision, the
person responsible for an activity they were not on site for, whoever asked for a change — not who
is to blame, and only as true as what was written. A wrong cause is put right by a correction, and
the record keeps both.

## ADR-044 — A work that ends well: snags closed with a photo, and retention held until they are {#adr-044}

**Status.** Accepted — 2026-10-04.

**Context.** This is E4, the fourth and last slice of the second wave ([ADR-041](#adr-041)), for the
last of the four ways a small work fails: **it ends badly**. Near the end every work has a list — a
cracked tile, a door that sticks, a socket with no cover plate, the paint touched up in one corner
and not the other — and the list lives on a sheet of paper, in a message thread or in the owner's
head. Meanwhile the last payment falls due: the stage closed, its payment plan said _30 % when the
stage closes_ ([ADR-037](#adr-037)), and the owner paid, because the product said it was earned.
From that day nobody has a reason to come back for the tile. The product had the parts and not the
record. A closed stage is closed ([ADR-022](#adr-022)), so what was found after it had nowhere to
go; the diary's incidents are a day's sentences, with nobody named to put them right and no way to
say they were; and the handover book ([ADR-038](#adr-038)) says what the book lacks — a photo, a
warranty, a care note — and not what the work lacks. A builder's contract calls the answer
**retention**: the last part of the price held back until the defects are put right. It is the one
protection a layperson never knows to ask for, and the product's own usual split — 30 %, 40 %, 30 %
— held none. With this slice the second wave is complete: a work that grows, runs out of money, runs
late or ends badly now has a record for each.

**Decision.**

- **A snag is a record** (`snag`, migration 016, [`DATA_MODEL.md`](../DATA_MODEL.md)). It carries a
  **number** — #1, #2, … in the order raised, never reused; the day it was **raised**; a title
  (1–200 characters) and an optional description (up to 2 000); **where it is** — a stage, required,
  and an activity, optionally; **who must fix it** — a person of the plan, or nobody yet; the day it
  is **due**, optional and never before the day it was raised; **a photo of the problem**, optional;
  and the name the Windows account gives. The stage, the activity and the person are not foreign
  keys: a person or a stage removed from the plan leaves the snag as it was written. A stage, an
  activity or a person the work does not have is refused with a sentence. **A closed stage takes
  snags** — they are found after closing, which is when they matter — and so does an approved plan:
  a snag changes nothing the plan or a baseline records, so neither the closed stage's lock
  ([ADR-022](#adr-022)) nor the approved plan's ([ADR-027](#adr-027)) covers it.
- **A snag is closed once: fixed with a photo, or withdrawn with a reason** (`snag_closure`).
  **Fixed** requires a photo of it fixed, and takes an optional note; **withdrawn** — raised by
  mistake, or not a defect after all — requires the reason, in up to 2 000 characters. Either is
  dated on or after the day the snag was raised and carries the account's name. A fixed closure with
  no photo, a withdrawal with no reason, a closure dated before its snag, a second closure and a
  closure of a snag the work does not have are refused by the host with a sentence, and again by the
  schema. **A snag found again after its fix is a new snag**, which may name the old one in its
  description; the old one stays fixed, with its photos, as it was.
- **Insert-only.** Neither row is ever edited or removed. **A snag is never deleted**: a mistake is
  withdrawn with its reason, and the record keeps both. Both tables carry the battery of migrations
  003, 007, 009 and 013 — triggers refuse `UPDATE` and `DELETE`, and a guard before insert refuses a
  key, or a snag's number, already there, so `INSERT OR REPLACE` removes nothing whether
  `recursive_triggers` is on or off — and the Rust module that writes them holds no `UPDATE`,
  `DELETE` or `REPLACE`, which a test reads its source to prove. The commands are `snag_raise` and
  `snag_close`, each returning the work's snapshot, which now carries the snags, each with its
  closure or none.
- **A photo is a document of the work, named by its hash** — D3's rule ([ADR-038](#adr-038)). The
  interface takes the photo in as a document first, through the same intake as every file
  ([ADR-025](#adr-025)) — chosen in the dialog or dropped on the window ([ADR-040](#adr-040)) — and
  the snag and its closure name it only by its 64-hex-digit hash. The host refuses a hash that names
  no image document of the open work; a photo is never read from a path and never copied twice.
- **Retention: the last part of a payment plan, held until the snags are closed** (amending
  [ADR-037](#adr-037)). A payment milestone gains a fifth trigger beside D2's four, **`retention`**,
  which names no activity. It is earned **on the day the last snag of the commitment's stage put on
  the commitment's person is closed — fixed or withdrawn — or on the day the stage closes, if that
  is later**; with no snag on that person it is earned when the stage closes, as `stage_closed` is.
  **Never while one is open**: like every milestone it follows its facts both ways, so a stage
  reopened un-earns it, and so does a snag raised on that person after it was earned. A snag on
  another person, on another stage or on nobody holds nothing, and a commitment that names no person
  is held by no snag. Earned is still never stored: the domain reads it from the gates and the snags
  every time (`src/domain/milestones.ts`). Migration 016 rebuilds `payment_milestone` to widen its
  trigger `CHECK`, the way migration 012 rebuilt `document`: every row kept with its id, the index
  and D2's triggers created again exactly as they were — so a paid commitment's plan stays locked, a
  retention is not added to it after money has moved, and a renegotiation is still a new commitment.
- **Held money is shown as held, never as due.** Until it is earned, a retention on Money's payment
  plan reads _held until …_ — its stage closed and the snags on that person closed — with how many
  are open. The projection ([ADR-042](#adr-042)) places it where it places `stage_closed`, on the
  day the schedule expects the stage to close, **while no snag holds it**; while one does, it is
  **not projected as due** in any week, but listed apart as money the owner is holding, with the
  snags that hold it, and it joins the weeks again when the last of them is closed. `expectedOn`
  learns the trigger, so the owner's snapshot and the projection still read one answer. Paying a
  retention before it is earned is paying ahead of the work, which D2's warning already says before
  the payment is saved — a warning, not a refusal.
- **Hold back as retention, offered and not advised.** The payment plan's editor offers **Hold back
  as retention** as the last part of a plan, suggested at **5 %** and editable, and says that it is
  a common practice, not advice — as D2's usual split does. It is offered while the plan has a share
  left and holds no retention yet — at 5 %, or at what is left when that is less — and on a
  commitment that names nobody it says that no snag can hold it.
- **The snag list is the domain's** (`snagRows`, `snagFigures`, pure). Each snag is **open**,
  **fixed** or **withdrawn**; an open one past its due day is **overdue**; and each says how many
  days it has waited. The figures carry their rows ([ADR-024](#adr-024)): **open**, **overdue**,
  **by person** and **by stage**. Readiness learns no rule: snags are found at the end, not planned,
  and a plan does not lack them.
- **The handover book learns the snags** (amending [ADR-038](#adr-038)). Each open snag is a gap of
  its own — **Still to fix**, with its number, its title and who must fix it — counted on the
  Reports card before the book is written and listed on its first page, first among the gaps;
  writing is still allowed. Each fixed snag is printed in its room's section, or its stage's, with
  **both photos** — the problem and the fix — half width, side by side, under the same caps and the
  same image pipeline as every photo in the book.
- **Where it lives.** The Plan gains a **Snags** tab: the form that raises one — title, stage,
  activity, who must fix it, due day and photo, chosen or dropped; the list, open first, the overdue
  marked; and on each open snag **Fix…**, which requires a photo of it fixed and takes a note, and
  **Withdraw…**, which requires the reason. There is no edit and no delete. The dashboard gains
  **Still to fix** — open, overdue, by person — not shown while the work has never had a snag.
  Money's payment plan shows a retention as held until it is earned. The weekly report and the
  owner's snapshot say what is still open and on whom, in the owner's words.
- **Words.** The glossary gains _snag_ (_pendência_): something found wrong or unfinished near the
  end, closed only with a photo of it fixed or withdrawn with a reason; and _retention_
  (_retenção_): the last part of a payment plan, held until its stage is closed and its person's
  snags are.
- **ADR-037 and ADR-038 are amended, not replaced.** D2 gains a trigger and nothing else of it
  changes: a milestone is earned by facts, never by a date or a tick; paying ahead is warned, not
  refused; the plan locks once money moves. D3 gains a kind of gap and a pair of photos, and its
  caps, its image pipeline and its rule that the book is written anyway stay as they were. Their
  Status lines point here.

**Why.** The last payment is the only lever an owner has at the end of a work, and the product was
telling him to let go of it on the day the stage closed. A retention earned by a record — snags
raised with a photo and closed with a photo — makes "is it finished?" a question with an answer, as
D2 made "is the work there?" one. The photo before and after is the one thing both sides can look at
without an argument, and the one the owner wants in the book years later, when the tile cracks
again. The list is insert-only because it is the conversation: a snag that can be quietly deleted is
a snag nobody fixed. And a retention is held by the snags on its own person, not by every snag in
the stage, because a tiler's money held for the painter's scratch is a retention nobody can earn,
and gets ignored.

**Cost accepted.** **A snag closed with a photo is closed by the record, not inspected**: the
product checks that a photo is attached, not what it shows or when it was taken, and the honesty of
the photo is the person's — as D3 says of hidden work. **Retention holds money only in the plan's
arithmetic**: Ridgebeam holds no money, is connected to no bank and cannot stop a payment; it shows
the money as held and warns before a payment that would pay it early, and paying it is still the
person's act. **5 % is a common practice offered as a suggestion, not advice**: how much to hold
back, and whether the contract or the law allows it, is the contract's and the jurisdiction's to
say. **A snag is never deleted**: one raised by mistake is withdrawn with a reason and stays in the
list as withdrawn, its number kept; a typo in a title, a wrong stage or the wrong person is put
right by withdrawing the snag and raising it again. **A snag on nobody holds no retention**: until
somebody is named it holds nobody's money, and a snag is on one person, so a defect two trades share
holds one of them unless it is raised twice. **A withdrawal releases a retention as a fix does**:
its reason is on record, and the product does not judge it. **The snags have to be on record before
the money goes**: with no snag raised on that person, a retention is earned the day its stage
closes, and a snag raised after that holds it again — if the retention was already paid, the
commitment reads as paid ahead of the work until that snag is closed, which, by then, it is.
