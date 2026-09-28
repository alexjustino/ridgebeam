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

Templates are data in this repository, and a template is a **plan**, not a list of tasks: stages
with their typical activities, the links between them, duration **ranges**, the decisions each
stage needs with their lead times, the checks each stage must pass, the rooms it touches, and cost
lines with no prices ([ADR-029](docs/architecture/ADR.md#adr-029)). A person applies one to start a
work, and from that moment the plan is theirs: nothing links it back. So a template is read by
somebody who has never built anything, on the evening they decide to, and taken as advice. Write
it for them.

### How a template enters

1. **One file per template**, `templates/<id>.json`. The `id` is kebab-case — lowercase letters
   and digits joined by single hyphens, at most 64 characters — and is the file's name without
   `.json`. Start `version` at 1 and raise it by one whenever a template already in the library
   changes; a work records the version it started from.
2. **Only the fields of the format, and no other.** The top level is `ridgebeamTemplate` (always
   1, the format's version), `id`, `version`, `title`, `summary`, `includes`, `rooms`, `stages` and
   `links`. A stage has `key`, `name`, `checks` (`start` and `close`, each a list of questions),
   `costLines` (`label`, and the `activity` it belongs to if it is not the stage's own), `decisions`
   (`key`, `name`, `leadDays`, and the activity that `needs` it) and `activities` (`key`, `name`,
   `durationDays`, `rooms`). A link is `blocker`, `blocked` and `lagDays`: finish-to-start, each end
   a stage key (`tiling`) or an activity (`tiling/grout`). A field the validator does not know is
   refused — a template is data, never code. The format is written out, field by field, at the top
   of [`src/domain/templates/format.ts`](src/domain/templates/format.ts); the six files already in
   `templates/` are worked examples.
3. **Both languages, everywhere.** Every text is `{ "en": "…", "pt-BR": "…" }`, and both are
   there: the title, the summary, every room, stage, activity, decision, check and cost line. The
   Portuguese is Brazilian Portuguese as an owner and an engineer on a Brazilian site say it
   (_contrapiso_, _rejunte_, _caçamba_, _louças e metais_), not a translation of the English word
   by word. Names and labels are at most 120 characters, checks 200, the summary 400.
4. **Ranges, not points.** Every activity has `durationDays` and every decision has `leadDays`,
   each `{ "min": …, "max": … }` in whole **working days** with `min` strictly below `max`. A
   single number is refused: a template carries ranges, not promises, and the person turns them
   into durations for their own site. Durations are 1–3 650, lead times and lags 0–3 650. Make the
   range what a small residential job of that kind really takes, from a good week to a bad one —
   not the best case. A lag (`lagDays`) is waiting that is not work, such as a screed curing.
5. **No prices.** A cost line is a **label** — _Tiles_, _Plumbing labour_ — and never has
   `amountCents`. There is no price in the library, in any currency, anywhere, including in a name.
6. **Nothing real.** No brand or product name, no supplier, no shop, no address, no town or
   region, no person, no company, no web address, no e-mail address and no phone number — and no
   standard, code or regulation cited by number, which would read as advice to follow blindly and
   is out of date somewhere the day it is written. Say what a site checks, in words: "Was every
   circuit tested and the results written down?", not a clause.
7. **A plan a site follows.** Stages in the order the work is done; the activities that really
   happen in each; links that say what waits for what, with **no cycle**. A check is a question
   the site answers yes or no before a stage starts or closes — "Is the water supply to the
   bathroom shut off and tested?" — never a task. A decision is one a person really faces, in the
   stage that needs it, with the activity that needs it (`needs`). Rooms where they help the
   person read the work by room. The summary says what the template covers and says that it is a
   starting point, not a quote.
8. **Includes, when a template is made of others.** `includes` names library templates whose
   stages come first, in that order, each once (`apartment-refit` includes `bathroom-renovation`
   and `kitchen-renovation`). A link may name an included stage by its key when only one template
   in reach has it, or as `template-id:stage-key`. A template may not include itself, and
   includes may not go round.

### What the test enforces

The library test, `src/domain/templates/library.test.ts`, runs in `vitest` — in `npm run gates`
and in CI on every pull request. For **every** file in `templates/` it checks that:

- it is valid JSON with only the fields of the format, and its `id` is its file name;
- every key is kebab-case and unique where it must be, and every room, activity, `needs` and link
  endpoint names something that exists;
- every text is in both languages, not blank, and within its length;
- a summary is there;
- every duration and every lead time is a range with `min < max`, within its limits;
- no cost line has an amount;
- no text looks like a web address, an e-mail address or a phone number;
- its includes name library templates, never itself and never in a cycle;
- its links close no loop once every stage is expanded into its activities; and
- it **applies to an empty work** without a problem.

When a file fails, the test names the file and the JSON path of each problem
(`$.stages[2].activities[0].durationDays`). Run it before you open the pull request:

```bash
npx vitest run src/domain/templates
npx prettier --write templates/
```

Template files are formatted by Prettier like the rest of the repository, and the `prettier`
gate checks them.

### What the test cannot enforce

A test can refuse a point, a price and a phone number; it cannot tell whether a range is honest,
whether a check is the question a site really asks, whether a name is a brand, or whether the
Portuguese reads naturally. **A maintainer reviews every template before it merges**, on those
four questions and on the rule of nothing real, and asks for changes the way a reviewer asks for
them in code. The pull request answers the template questions in
[`PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md): which template, that the library
test passes, and that somebody who speaks each language has read it.

A work exported as a template ([ADR-030](docs/architecture/ADR.md#adr-030)) is a starting point
for a library template, not one: it is in one language, has no summary, and, with its numbers
kept, carries points and amounts. Write the second language, turn every number into a range,
remove every amount, and it goes through the same procedure as any other.

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

| Gate                       | What it protects                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `check:version`            | the version is one fact in every file that declares it                                              |
| `check:glossary`           | `docs/GLOSSARY.md` is exactly what `src/i18n/glossary.json` renders to                              |
| `cargo fmt --check`        | Rust formatting                                                                                     |
| `cargo clippy -D warnings` | Rust correctness and idiom                                                                          |
| `cargo test`               | the host: append-only triggers, the chain, copy-in caps, backup round-trip, CSV                     |
| `notices --check`          | About's licence list is the lockfiles' — run `node scripts/notices.mjs` after changing a dependency |
| `tsc --noEmit`             | type correctness                                                                                    |
| `eslint`                   | **`react-hooks/rules-of-hooks` is an error**, plus the boundary rule                                |
| `prettier --check`         | formatting                                                                                          |
| `vitest`                   | domain rules, including negative cases; the library schema test                                     |
| `npm run e2e` (separate)   | the real binary through WebDriver — needs a debug build and `msedgedriver`                          |

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
