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
before there is a diary. The other four wait for their slices.

| #               | Decision                                                                  | Status                         |
| --------------- | ------------------------------------------------------------------------- | ------------------------------ |
| [001](#adr-001) | The product is named Ridgebeam                                            | Accepted — 2026-09-24, by Alex |
| [002](#adr-002) | Tauri 2 with a deliberately thin Rust host                                | Accepted — 2026-09-25          |
| [003](#adr-003) | The domain layer is pure TypeScript                                       | Accepted — 2026-09-25          |
| [004](#adr-004) | A work is a folder, and the application keeps a small database of its own | Accepted — 2026-09-25          |
| [005](#adr-005) | Fluent is the visual language, with one icon set                          | Accepted — 2026-09-25          |
| [006](#adr-006) | No network, no telemetry                                                  | Accepted — 2026-09-25          |
| [007](#adr-007) | Strings are data in two languages, and the glossary is data too           | Accepted — 2026-09-25          |
| [008](#adr-008) | Readiness is a measure, not a feeling                                     | Accepted — 2026-09-25          |
| [009](#adr-009) | The plan has no progress command                                          | Accepted — 2026-09-25          |
| [010](#adr-010) | End-to-end tests drive the real binary                                    | Accepted — 2026-09-25          |
| [011](#adr-011) | Accessibility is gated, not reviewed                                      | Accepted — 2026-09-25          |
| [012](#adr-012) | Installers are not code-signed in 1.0.0                                   | Accepted — 2026-09-25          |
| [013](#adr-013) | Settings are a closed list of keys the host owns                          | Accepted — 2026-09-25          |

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
