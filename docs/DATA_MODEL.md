# Data model

The schema of a work, and of the little the application keeps outside one. Rationale for the
decisions lives in [`architecture/ADR.md`](architecture/ADR.md); what each noun means, in plain
words, in [`GLOSSARY.md`](GLOSSARY.md).

## Two databases

**A work is a folder.** The person chooses it in a dialog; the product creates inside it:

```
<work folder>/
  work.sqlite3        the work: plan, calendar, people, diary, baselines, money
  documents/          files copied in (slice F7), named by their hash
  thumbnails/         thumbnails of the images in documents/ (slice F7)
```

Nothing about a work lives anywhere else. Moving the folder moves the work; the product finds
it again from a dialog. The database is opened with `journal_mode = WAL`, `synchronous = FULL`,
`foreign_keys = ON`, `recursive_triggers = ON` and `busy_timeout = 5000`, and is checkpointed
and closed cleanly when the work is closed, so that a closed work folder holds one database
file and no journal. A work folder that is synchronised by another program **while the work is
open** is outside what 1.0.0 supports (ADR-004): the synchroniser sees the database, its `-wal`
and its `-shm` as three files at three moments. Sharing a work is release 1.2.

**The application keeps one small database of its own**, `ridgebeam.sqlite3`, in the
application data folder (`%APPDATA%/io.github.alexjustino.ridgebeam/`). It holds the settings
that are the person's rather than a work's — language, theme, the lens they last used — and the
list of recent works with their folders. It holds nothing about the content of a work.

## The work database

### `work`, and where the schema version lives

One row, `id = 1`, created by the first migration.

| Column           | Type    | Meaning                                                           |
| ---------------- | ------- | ----------------------------------------------------------------- |
| `id`             | INTEGER | always 1 (`CHECK (id = 1)`)                                       |
| `schema_version` | INTEGER | the last migration applied; moves independently of the product    |
| `work_id`        | TEXT    | UUID v7, the work's identity across renames and moves             |
| `name`           | TEXT    | what the person calls the work                                    |
| `place`          | TEXT    | where it is, as the person writes it — never geocoded, never sent |
| `start_date`     | TEXT    | ISO 8601 date, the first day the schedule may use                 |
| `currency`       | TEXT    | ISO 4217 code, three letters                                      |
| `created_at`     | TEXT    | UTC, milliseconds, trailing `Z`                                   |

### `calendar` and `holiday`

The working calendar durations are counted on. One `calendar` row, `id = 1`.

| Column          | Type    | Meaning                                                             |
| --------------- | ------- | ------------------------------------------------------------------- |
| `id`            | INTEGER | always 1                                                            |
| `working_days`  | TEXT    | seven characters, Monday first, `1` working and `0` not — `1111100` |
| `hours_per_day` | REAL    | hours in a working day, `> 0`                                       |

`holiday` — `date TEXT PRIMARY KEY` (ISO 8601), `name TEXT`. A holiday is not a working day
whatever the mask says. A calendar with no working day is refused by the domain (a mandatory
negative case) before it reaches the host.

### `person`

A person is a row, not a user. Slice F0 creates the table with what a responsible needs; slice
F7 adds trade, phone, stages and availability.

| Column       | Type | Meaning   |
| ------------ | ---- | --------- |
| `id`         | TEXT | UUID v7   |
| `name`       | TEXT | not empty |
| `created_at` | TEXT | UTC       |

### `stage` and `activity`

| `stage`      | Type    | Meaning                    |
| ------------ | ------- | -------------------------- |
| `id`         | TEXT    | UUID v7                    |
| `position`   | INTEGER | order among stages, unique |
| `name`       | TEXT    | not empty                  |
| `created_at` | TEXT    | UTC                        |

| `activity`       | Type    | Meaning                                                    |
| ---------------- | ------- | ---------------------------------------------------------- |
| `id`             | TEXT    | UUID v7                                                    |
| `stage_id`       | TEXT    | `REFERENCES stage ON DELETE CASCADE`                       |
| `position`       | INTEGER | order inside the stage, unique per stage                   |
| `name`           | TEXT    | not empty                                                  |
| `duration_days`  | INTEGER | working days, `NULL` until known, `> 0` once set           |
| `responsible_id` | TEXT    | `REFERENCES person ON DELETE SET NULL`, `NULL` until known |
| `created_at`     | TEXT    | UTC                                                        |

**There is no progress column, and there never will be.** Progress is derived from the diary
(slice F4). Dependencies, rooms and quantities arrive with slices F1 and F2 as tables of their
own, not as columns here.

## Readiness is computed, not stored

Nothing in the schema records readiness. The domain computes it from the rows every time, from
a rule table that is data (`src/domain/readiness/rules.ts`): for slice F0, an activity must have
a duration and must have a responsible; each rule contributes the rows that fail it, the figure
is `known / must-know`, and the sentence is built from the failing rows in the person's
language. Later slices add rules (a stage's decisions, checks and money; declared
dependencies) without changing the shape.

## The application database

### `settings`

A closed list of keys the host owns (ADR-013): `language` (`system`,
`en`, `pt-BR`), `theme` (`system`, `light`, `dark`), `lens` (`owner`, `architect`, `engineer`;
the default for a new work is `owner`). A key outside the list is refused by the host.

### `recent_work`

| Column      | Type | Meaning                                                                               |
| ----------- | ---- | ------------------------------------------------------------------------------------- |
| `work_id`   | TEXT | primary key, the work's UUID                                                          |
| `name`      | TEXT | as last seen                                                                          |
| `folder`    | TEXT | the folder as last seen; if it is gone, the row says so on screen and offers a dialog |
| `opened_at` | TEXT | UTC                                                                                   |

## Conventions

- Identifiers are UUID v7 as 36-character text; timestamps are UTC with milliseconds and a
  trailing `Z`; dates are ISO 8601 `YYYY-MM-DD` text.
- Every table that must never lose a row (the diary, its photos and corrections, the baselines,
  the payments ledger — slices F4, F6, F8) is insert-only: triggers refuse `UPDATE`, `DELETE`
  and `REPLACE`, and the Rust module that writes it contains no `UPDATE` or `DELETE` statement,
  by rule. Each diary entry carries the hash of the previous one.
- Text columns that a person types are bounded by `CHECK (length(...) <= n)` in the schema.

## Migrations

Numbered SQL files compiled into the binary, forward-only, applied in a transaction that also
moves `work.schema_version`. A release that adds a migration says so in the changelog and is
covered by a round-trip test that opens a work at version N-1 and migrates it without loss.

| Migration      | Slice | Adds                                                         |
| -------------- | ----- | ------------------------------------------------------------ |
| `001_init.sql` | F0    | `work`, `calendar`, `holiday`, `person`, `stage`, `activity` |

## Not yet in the schema

Rooms, quantities and dependencies with lag (F1–F2) · baselines (F2, F8) · decisions (F3) ·
the diary, its photos and corrections, and the chain (F4) · checks (F5) · planned, committed
and paid money and the payments ledger (F6) · documents, thumbnails and hashes (F7) · templates
are files in the repository, not rows (F9).
