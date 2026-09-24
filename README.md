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

> **Status: pre-release — named, not yet built.** The product was named on 2026-09-24
> ([ADR-001](docs/architecture/ADR.md#adr-001)); slice **F0** is next and nothing runs yet.
> There is no installer. The [specification](docs/SPEC.md) says what 1.0.0 will be and what
> "done" means for every slice; this section will say exactly how far the code has got.

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

Documents only:

- [`docs/SPEC.md`](docs/SPEC.md) — the specification, v1.0.0: thesis, the closed scope of 1.0.0
  and the release train, the architecture, the non-functional requirements, the threat model's
  outline, the testing pyramid with its mandatory negative cases, the twelve vertical slices with
  their proofs of done, the definition of done, and the risks.
- [`docs/architecture/ADR.md`](docs/architecture/ADR.md) — ADR-001, the name, with the
  collision evidence and what could not be verified.
- [`CONTRIBUTING.md`](CONTRIBUTING.md), [`VERSIONING.md`](VERSIONING.md),
  [`CHANGELOG.md`](CHANGELOG.md), [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

`SECURITY.md`, `DESIGN_SYSTEM.md`, `docs/GLOSSARY.md` and `docs/DATA_MODEL.md` are written in
slice F0, before the first work is created — not after.

## Roadmap

| Release   | Theme               | Contents                                                                                                                       |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **1.0.0** | The plan            | the work, stages and activities, the schedule with critical path and baselines, decisions, readiness, the diary, checks, money, people, documents, replanning, templates and the library, three lenses, the dashboard, reports, print, backup |
| 1.1.0     | The site            | the diary from a phone: a companion build of the same app for Android, writing into the same work folder                        |
| 1.2.0     | The crew            | the work shared between the owner, the engineer and the contractors: file-based sync with conflict rules, a read-only owner view |
| 2.0       | Only if it earns it | quantities from drawings · price databases per region · IFC import · resource levelling · the network                            |

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
