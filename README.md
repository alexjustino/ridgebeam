<div align="center">

# Ridgebeam

**A works planner for the engineer, the architect and the person building once — where the
plan is intent, the diary is fact, and the plan says what it does not yet know.**

Stages and activities · Critical path on a working calendar · Decisions with computed deadlines ·
Readiness · Append-only site diary · Check gates · Money · Templates that are plans ·
Three lenses, one model · English and Portuguese

No cloud. No account. No telemetry. A work is a folder you own.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4.svg)](#requirements)

</div>

---

> **Status: pre-release — slice F0, the first.** The product was named on 2026-09-24
> ([ADR-001](docs/architecture/ADR.md#adr-001)). F0 — the foundation, the shell, one stage and
> readiness — runs from source; nothing after it exists yet, and there is no published
> installer. The [specification](docs/SPEC.md) says what 1.0.0 will be and what "done" means for
> every slice; [What exists today](#what-exists-today) says exactly how far the code has got.

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

Slices **F0** and **F1**, and nothing after them:

- **A work is a folder.** Create one in an empty folder chosen in the system dialog, or open an
  existing one; the recent works are listed, and one whose folder has gone says so and offers a
  way to find it. Everything about a work is one SQLite file inside its folder, checkpointed and
  closed when the work closes.
- **Stages and activities on a working calendar.** A start date, working days, hours per day
  and holidays, all edited on the Plan; a stage with activities, each with a duration in working
  days and a responsible. Activities are placed on the calendar one after another — a
  deliberately simple placement until the critical path arrives in F2.
- **The plan (F1).** Rooms and areas, the rooms each activity touches, and an optional quantity
  with its unit (12 m² of tile). Stages, activities and rooms reordered by button or by
  keyboard (Alt+Arrow), with the numbering following. People renamed and removed. The same rows
  in three arrangements — the numbered **breakdown** where editing lives, the works **by room**,
  and the owner's **checklist** — with none of them a copy of another.
- **Three lenses, one model (F1).** The engineer's, the architect's and the owner's words for
  the same things — _activity_, _work item_, _job_ — switched from the title bar, in both
  languages, from a vocabulary table in the glossary. The lens is the person's setting; switching
  it stores nothing in the work.
- **Readiness.** A figure that says how much of what the plan must know it does know, from two
  rules — every activity has a duration, every activity has a responsible — that opens onto the
  rows it counts and says in a sentence what is missing, in English and in Portuguese.
- **The shell.** Dashboard, Plan, Settings (language, theme, lens), Diagnostics and About, in
  light and dark, in English and Portuguese. There is no command, field or control that sets
  progress.
- **The documents written before the first work:** [`docs/SPEC.md`](docs/SPEC.md), the
  specification; [`SECURITY.md`](SECURITY.md), the threat model;
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), the schema;
  [`docs/GLOSSARY.md`](docs/GLOSSARY.md), every term with its plain sentence in both languages,
  generated from data; [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md), the UI contract;
  [`docs/architecture/ADR.md`](docs/architecture/ADR.md), fourteen binding decisions; and
  [`docs/RELEASE.md`](docs/RELEASE.md), the release checklist.
- **The gates**: one script, `npm run gates`, run identically on a developer machine and in CI;
  an end-to-end suite that drives the real binary; and a bundle check that holds the installer
  under 10 MB.

Not yet, and not pretended: dependencies and the critical path, baselines, decisions, the
diary, checks, money, people beyond a name, documents and photos, replanning, templates,
reports, backup.
Each arrives with its slice, in the order the [specification](docs/SPEC.md) §7 lists.

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

| Release   | Theme               | Contents                                                                                                                                                                                                                                      |
| --------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The plan            | the work, stages and activities, the schedule with critical path and baselines, decisions, readiness, the diary, checks, money, people, documents, replanning, templates and the library, three lenses, the dashboard, reports, print, backup |
| 1.1.0     | The site            | the diary from a phone: a companion build of the same app for Android, writing into the same work folder                                                                                                                                      |
| 1.2.0     | The crew            | the work shared between the owner, the engineer and the contractors: file-based sync with conflict rules, a read-only owner view                                                                                                              |
| 2.0       | Only if it earns it | quantities from drawings · price databases per region · IFC import · resource levelling · the network                                                                                                                                         |

Deliberately not in 1.0.0: accounts, sync, a phone or web app, BIM/IFC/CAD import, bills of
quantities and price databases, invoicing and tax, resource levelling, earned value beyond the
S-curve, weather from the network, macOS, Linux, tablets, plugins, auto-update, AI.

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
