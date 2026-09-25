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

| `activity`       | Type    | Meaning                                                                                                         |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `id`             | TEXT    | UUID v7                                                                                                         |
| `stage_id`       | TEXT    | `REFERENCES stage ON DELETE CASCADE`                                                                            |
| `position`       | INTEGER | order inside the stage, unique per stage                                                                        |
| `name`           | TEXT    | not empty                                                                                                       |
| `duration_days`  | INTEGER | working days, `NULL` until known, `> 0` once set                                                                |
| `responsible_id` | TEXT    | `REFERENCES person ON DELETE SET NULL`, `NULL` until known                                                      |
| `created_at`     | TEXT    | UTC                                                                                                             |
| `quantity`       | REAL    | how much of the activity there is — 12 (m² of tile); `NULL` or `>= 0`, a number and never text (F1)             |
| `unit`           | TEXT    | the quantity's unit as the person writes it — `m²`, `m`, `un`; 1–16 characters, and only beside a quantity (F1) |

**Order is explicit.** `position` is 1, 2, 3 … with no gaps — among stages, and among the
activities of one stage, and among rooms. The host renumbers them 1 … n in the same transaction as
every move and every removal — of a stage, an activity or a room — so the numbering a person
sees (1, 1.1, 1.2 …) is the order on disk. A move is up or down by one place; at the first or
last place it changes nothing and is not an error. A work created by F0, where a removal could
leave a gap, has its gaps closed by the first move in that list.

**A quantity is optional, and it is not a readiness rule.** The specification's rules for what
a plan must know are duration, responsible, decisions, checks, cost and dependencies — not how
many square metres. A unit means nothing without a quantity, and two guards say so. The host
checks first and refuses a unit on its own with its own sentence; the schema checks second —
`unit` is `NULL`, or 1–16 characters that are not blank and only when `quantity` is present,
a `CHECK` SQLite accepts on the added column and tests against every row. Clearing a quantity
clears its unit.

**There is no progress column, and there never will be.** Progress is derived from the diary
(slice F4). Dependencies with lag arrive with slice F2 as a table of their own, not as columns
here.

### `room` and `activity_room`

A room — or an area: the bathroom, the north wall, the roof — is a row of the work, the
architect's and the owner's map of it (F1). An activity touches zero or more rooms.

| `room`       | Type    | Meaning                          |
| ------------ | ------- | -------------------------------- |
| `id`         | TEXT    | UUID v7                          |
| `position`   | INTEGER | order among rooms, unique, 1 … n |
| `name`       | TEXT    | 1–120 characters, not blank      |
| `created_at` | TEXT    | UTC                              |

| `activity_room` | Type | Meaning                                 |
| --------------- | ---- | --------------------------------------- |
| `activity_id`   | TEXT | `REFERENCES activity ON DELETE CASCADE` |
| `room_id`       | TEXT | `REFERENCES room ON DELETE CASCADE`     |

The primary key is the pair. Removing a room removes its links and leaves the activities;
removing an activity removes its links and leaves the rooms. The host replaces an activity's
set of rooms whole, and refuses a room that is not in the work.

## Nothing is stored per lens, or per arrangement

The breakdown, the works by room and the owner's checklist are three arrangements of the same
rows, computed by the domain from one snapshot of the work (ADR-014). No table holds an
arrangement, and the work database has no lens column and never will: the lens is the person's
setting, in the application database, and it changes the words and the order on the screen,
never the work.

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

| Migration                      | Slice | Adds                                                             |
| ------------------------------ | ----- | ---------------------------------------------------------------- |
| `001_init.sql`                 | F0    | `work`, `calendar`, `holiday`, `person`, `stage`, `activity`     |
| `002_rooms_and_quantities.sql` | F1    | `room`, `activity_room`; `activity.quantity` and `activity.unit` |

Migration 002 is the first a released work would meet: a work created at schema 1, with its
stages and activities, is migrated to schema 2 without loss, and a round-trip test in `cargo
test` holds it. The migrations live in `src-tauri/work_migrations/`.

## Not yet in the schema

Dependencies with lag (F2) · baselines (F2, F8) · decisions (F3) ·
the diary, its photos and corrections, and the chain (F4) · checks (F5) · planned, committed
and paid money and the payments ledger (F6) · documents, thumbnails and hashes (F7) · templates
are files in the repository, not rows (F9).
