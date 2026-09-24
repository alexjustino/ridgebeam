# Contributing to Ridgebeam

Thank you for considering a contribution. This document is short on ceremony and precise
about the few rules that are not negotiable.

## Ground rules

1. **Green gates before anything.** `npm run gates` must pass locally, and CI must be green
   before a pull request is merged. There is no "I'll fix it after".
2. **One commit, one concern.** Stage per file. Never `git add .` blindly, never squash
   unrelated work together.
3. **Verified running, not just compiling.** If a change touches a screen, open the screen in
   the real application, in both themes **and both languages**, and drive it with the keyboard.
   If it touches a report, an export or a backup, open the file that was written. A green
   type-check is not evidence that a UI works.
4. **Documentation is part of the delivery.** Behaviour, contract or procedure changed? The
   README, ADR, CHANGELOG, SPEC, DATA_MODEL, DESIGN_SYSTEM or GLOSSARY changes in the same pull
   request. A term shown on a screen that is not in the glossary is a defect.

## The architectural boundary

This is the one rule that a reviewer will always check.

> `src/domain/` must never import from `src/data/`, `src/ui/`, `src/features/`,
> `react`, or `@tauri-apps/*`.

`domain/` is pure: the plan, the schedule on a working calendar with its critical path and
baselines, decisions and their computed deadlines, readiness rule by rule, the diary's chain and
the progress derived from it, the two check gates, every money figure, templates, the lenses
and the reports. It performs no I/O and knows nothing about the UI or the host. That is what
makes the hard parts of this product unit-testable without opening a window or writing a file.

The rule is enforced twice, on purpose: by ESLint `no-restricted-imports`, and by an
architecture test that fails CI. A rule without a gate is not a rule.

Business logic does not live in Rust either. `src-tauri/` is a thin repository plus the
operating-system surface: the work folder, migrations, the append-only tables and their
triggers, copy-in of files under caps, thumbnails, backup and restore, and the exports.

## The security rule

This product holds the record of somebody's home and somebody's money, and it is public
source. Two things are never negotiable, whatever the feature:

- **No diary entry is lost and no baseline overwritten.** The diary and the baselines are
  insert-only in the schema — triggers refuse `UPDATE` and `DELETE` — and in the host: there is
  no command that edits an entry; a correction is a new entry that says so. Each entry carries
  the hash of the previous one and the export verifies the chain. This is tamper-evidence,
  stated plainly, never a signature and never legal proof.
- **The plan has no progress command.** Progress, actual dates, people on site and weather days
  are derived from diary entries. A figure on the plan is always traceable to the entries that
  produced it.

And, because files arrive from other people: **every file the product opens is hostile.** A
photo or document copied into a work goes through caps on size and dimensions, is never
executed, and is opened by the operating system's own handler only on the person's click.
Exports neutralise formula injection.

A change that touches **the diary, the baselines, copy-in or export** does not merge without
the negative test: the edit that must be refused, the tampered file that must fail the chain,
the file that must be refused with a sentence, the cell that must not become a formula.
`SECURITY.md` is the threat model; a change that touches it changes it.

## The template library

Templates are data in this repository, and a template is a **plan**, not a list of tasks:
stages with their typical activities, dependencies, duration **ranges**, the decisions each
stage needs with their lead times, the checks each stage must pass, and cost lines with no
prices. The schema test says whether a template may enter: it must validate, have no cycle,
carry ranges rather than points, and apply to an empty work without error. Slice F9 writes the
schema and the exact procedure here; until then no template is accepted.

## Public repository hygiene

Nothing in this repository is a real address, a real person, a real contractor, a real price or
a personal e-mail. Fixtures are synthetic and say so. No `.env`, no key, no secret, ever; the
`.gitignore` refuses the obvious ones and a reviewer refuses the rest.

## Branches

| Branch            | Meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `main`            | always releasable, tagged; updated only at a release |
| `develop`         | integration branch; pull requests target this        |
| `feat/*`, `fix/*` | one slice or one fix                                 |
| `release/vX.Y`    | release stabilisation                                |

**Both `main` and `develop` are protected on GitHub**, and the protection says what this
document says: a pull request is required, the gates and the dependency audit must be green
before it can be merged, neither branch can be force-pushed or deleted, and the rule applies to
administrators too. A rule with no gate is a rule that eventually gets bypassed — including by
the person who wrote it.

Tags follow SemVer: `vMAJOR.MINOR.PATCH`. See [`VERSIONING.md`](VERSIONING.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), imperative mood, 72 characters
or fewer in the subject, no trailing period.

```
<type>(<scope>): <description>
```

**Types** — `feat` `fix` `refactor` `docs` `test` `chore` `style` `perf` `build` `ci`

**Scopes** — the module's canonical token:
`work` `plan` `schedule` `decisions` `readiness` `diary` `checks` `money` `people` `documents`
`replanning` `templates` `lenses` `dashboard` `reports` `settings` `diagnostics` `about` `db`
`domain` `host` `ui` `i18n` `a11y` `ci` `docs` `deps`

```
feat(readiness): count an activity with no duration as not ready, and say so
fix(diary): refuse an entry dated in the future with the day it may be dated
test(schedule): a dependency onto an activity in a closed stage is refused
```

## Gates

```bash
npm run gates
```

runs, and all of them must pass:

| Gate                       | What it protects                                                                 |
| -------------------------- | -------------------------------------------------------------------------------- |
| `check:version`            | the version is one fact in every file that declares it                           |
| `cargo fmt --check`        | Rust formatting                                                                  |
| `cargo clippy -D warnings` | Rust correctness and idiom                                                       |
| `cargo test`               | the host: append-only triggers, the chain, copy-in caps, backup round-trip, CSV  |
| `tsc --noEmit`             | type correctness                                                                 |
| `eslint`                   | **`react-hooks/rules-of-hooks` is an error**, plus the boundary rule             |
| `prettier --check`         | formatting                                                                       |
| `vitest`                   | domain rules, including negative cases; the library schema test                  |
| `npm run e2e` (separate)   | the real binary through WebDriver — needs a debug build and `msedgedriver`       |

> A hook placed after an early return type-checks cleanly and crashes the screen at runtime.
> That is why the lint gate is mandatory and not advisory.

The script and the workflow that run these arrive with slice F0; this table is the contract
they are written to.

## Tests

The pyramid is in `docs/SPEC.md` §6, with the mandatory negative cases. In short: rules in
Vitest over `domain/` at **90 % coverage**; the host in `cargo test`; a contract suite over
`data/` proving the interface's shape matches the Rust serde shape; an architecture test that
fails if `domain/` imports React, Tauri or an outer layer, or if a string is shown that is not
in the i18n table; the library schema test over every template; axe-core over every screen in
both themes and both languages inside the end-to-end suite, where serious and critical findings
fail; and an end-to-end suite that drives the real binary from a new work to a diary entry, a
restart, and a chain that still holds.

New rules arrive with tests, **including the negative case**.

## Pull requests

Target `develop`. One slice per pull request. The body uses the template: what changed, which
slice, the gates, what was verified running — on which screen, in which theme and language, and
which file was written and opened — the documentation that moved with it, the risk, and **what
could not be verified**. That last section is mandatory and is never empty; if everything was
verified, it says "nothing" in as many words.

## Reporting security issues

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md) (written in slice F0; until
then, report privately through the repository's Security tab).

## Licence of contributions

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), consistent with the rest of the project.
