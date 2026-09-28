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
([ADR-020](#adr-020)), which is append-only with a hash chain ([ADR-019](#adr-019)). The
sixth, templates are plans, waits for F9.

| #               | Decision                                                                                                      | Status                         |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [001](#adr-001) | The product is named Ridgebeam                                                                                | Accepted — 2026-09-24, by Alex |
| [002](#adr-002) | Tauri 2 with a deliberately thin Rust host                                                                    | Accepted — 2026-09-25          |
| [003](#adr-003) | The domain layer is pure TypeScript                                                                           | Accepted — 2026-09-25          |
| [004](#adr-004) | A work is a folder, and the application keeps a small database of its own                                     | Accepted — 2026-09-25          |
| [005](#adr-005) | Fluent is the visual language, with one icon set                                                              | Accepted — 2026-09-25          |
| [006](#adr-006) | No network, no telemetry                                                                                      | Accepted — 2026-09-25          |
| [007](#adr-007) | Strings are data in two languages, and the glossary is data too                                               | Accepted — 2026-09-25          |
| [008](#adr-008) | Readiness is a measure, not a feeling                                                                         | Accepted — 2026-09-25          |
| [009](#adr-009) | The plan has no progress command                                                                              | Accepted — 2026-09-25          |
| [010](#adr-010) | End-to-end tests drive the real binary                                                                        | Accepted — 2026-09-25          |
| [011](#adr-011) | Accessibility is gated, not reviewed                                                                          | Accepted — 2026-09-25          |
| [012](#adr-012) | Installers are not code-signed in 1.0.0                                                                       | Accepted — 2026-09-25          |
| [013](#adr-013) | Settings are a closed list of keys the host owns                                                              | Accepted — 2026-09-25          |
| [014](#adr-014) | A lens is a vocabulary table over the glossary, and an arrangement; nothing is stored per lens                | Accepted — 2026-09-25          |
| [015](#adr-015) | One scheduling engine: Tessera's, copied literally and extended with the working calendar, lags and baselines | Accepted — 2026-09-25          |
| [016](#adr-016) | Baselines are insert-only from the first one                                                                  | Accepted — 2026-09-25          |
| [017](#adr-017) | A decision's deadline is computed, never stored                                                               | Accepted — 2026-09-25          |
| [018](#adr-018) | Readiness is explained rule by rule, and the rules sum to the figure                                          | Accepted — 2026-09-25          |
| [019](#adr-019) | The diary is append-only with a hash chain, and a correction is a new entry                                   | Accepted — 2026-09-25          |
| [020](#adr-020) | Progress is derived from the diary, in states, never as an invented number                                    | Accepted — 2026-09-25          |
| [021](#adr-021) | Photos are copied by the host under caps and shown as data URLs                                               | Accepted — 2026-09-25          |
| [022](#adr-022) | A stage's gates are answered facts, and a closed stage is closed                                              | Accepted — 2026-09-27          |
| [023](#adr-023) | Money is three facts with three sources, in minor units, and the ledger is append-only                        | Accepted — 2026-09-27          |
| [024](#adr-024) | Every money figure carries its rows, and paid over committed is flagged, not refused                          | Accepted — 2026-09-27          |
| [025](#adr-025) | A document is a file the work owns, typed by its bytes, deduplicated by its hash, and never parsed            | Accepted — 2026-09-27          |
| [026](#adr-026) | A person is a contact with stages, and presence comes from the diary                                          | Accepted — 2026-09-27          |
| [027](#adr-027) | An approved plan is locked until somebody says why: a replanning is a row, closed only by the next baseline   | Accepted — 2026-09-28          |
| [028](#adr-028) | Any two baselines compare in the domain; a what-if is never written                                           | Accepted — 2026-09-28          |

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
