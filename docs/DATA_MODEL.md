# Data model

The schema of a work, and of the little the application keeps outside one. Rationale for the
decisions lives in [`architecture/ADR.md`](architecture/ADR.md); what each noun means, in plain
words, in [`GLOSSARY.md`](GLOSSARY.md).

## Two databases

**A work is a folder.** The person chooses it in a dialog; the product creates inside it:

```
<work folder>/
  work.sqlite3        the work: plan, calendar, people, diary, baselines, money
  documents/          every file the work owns — photos, receipts, quotes, drawings, permits,
                      contracts — named <sha-256>.<ext>
  thumbnails/         a 320 px JPEG of each image, named <sha-256>.jpg; none for a PDF
```

That is the whole folder, and it is final for 1.0. `documents/` and `thumbnails/` exist only
once a file does. A file's name is the SHA-256 of its bytes and its extension comes from the type
its first bytes say it is — `jpg`, `png`, `webp`, `gif`, `bmp` or `pdf` — never from the
name it arrived with; the same file attached twice is one file (ADR-021, ADR-025). A file in
`documents/` that no row names is an **orphan**: Diagnostics lists it and the product never
deletes it.

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

| Column           | Type    | Meaning                                                                            |
| ---------------- | ------- | ---------------------------------------------------------------------------------- |
| `id`             | INTEGER | always 1 (`CHECK (id = 1)`)                                                        |
| `schema_version` | INTEGER | the last migration applied; moves independently of the product                     |
| `work_id`        | TEXT    | UUID v7, the work's identity across renames and moves                              |
| `name`           | TEXT    | what the person calls the work                                                     |
| `place`          | TEXT    | where it is, as the person writes it — never geocoded, never sent                  |
| `start_date`     | TEXT    | ISO 8601 date, the first day the schedule may use                                  |
| `currency`       | TEXT    | ISO 4217 code, three letters                                                       |
| `created_at`     | TEXT    | UTC, milliseconds, trailing `Z`                                                    |
| `approved_at`    | TEXT    | UTC, when baseline 1 was taken; `NULL` until then, and never changed once set (F2) |

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

A person is a row, not a user — a contact (ADR-026). Slice F0 creates the table with what a
responsible needs; F6 adds the trade; F7 adds the contact columns and the stages. Contact details
are stored as typed and never used: the product has no network, and nothing is ever sent to an
address or dialled. Who was on site is the diary's (`diary_present`), never a column here.

| Column         | Type | Meaning                                                                                           |
| -------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `id`           | TEXT | UUID v7                                                                                           |
| `name`         | TEXT | not empty                                                                                         |
| `created_at`   | TEXT | UTC                                                                                               |
| `trade`        | TEXT | the person's trade — _tiler_, _plumber_ — 1–60 characters, or `NULL`; groups money per trade (F6) |
| `phone`        | TEXT | as typed, 1–40 characters, or `NULL` (F7)                                                         |
| `email`        | TEXT | as typed, 1–120 characters, or `NULL` (F7)                                                        |
| `note`         | TEXT | 1–500 characters, or `NULL` (F7)                                                                  |
| `availability` | TEXT | as the person writes it — _mornings only_, _from October_ — 1–200 characters, or `NULL` (F7)      |

`person_stage` — `person_id` (`REFERENCES person ON DELETE CASCADE`) and `stage_id`
(`REFERENCES stage ON DELETE CASCADE`), the pair as primary key: the stages somebody is expected
on (F7).

### `stage` and `activity`

| `stage`      | Type    | Meaning                                                                                                    |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `id`         | TEXT    | UUID v7                                                                                                    |
| `position`   | INTEGER | order among stages, unique                                                                                 |
| `name`       | TEXT    | not empty                                                                                                  |
| `created_at` | TEXT    | UTC                                                                                                        |
| `started_at` | TEXT    | UTC, when the person started it — the start gate passed; `NULL` while planned; never changed once set (F5) |
| `closed_at`  | TEXT    | UTC, when the person closed it — the close gate passed; only on a started stage; cleared by a reopen (F5)  |

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
(slice F4).

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

### `dependency`

A dependency says that one thing starts after another has finished (F2). Each end is an
activity or a stage — _the tiling after the plumbing_, _the finishes after the whole Structure
stage_ — finish-to-start, with a lag in working days that is waiting, not work.

| Column         | Type    | Meaning                                                       |
| -------------- | ------- | ------------------------------------------------------------- |
| `id`           | TEXT    | UUID v7                                                       |
| `blocker_kind` | TEXT    | `activity` or `stage` — the end that finishes first           |
| `blocker_id`   | TEXT    | the id of that activity or stage                              |
| `blocked_kind` | TEXT    | `activity` or `stage` — the end that starts after             |
| `blocked_id`   | TEXT    | the id of that activity or stage                              |
| `lag_days`     | INTEGER | working days of waiting between the two, 0 to 3650, default 0 |
| `created_at`   | TEXT    | UTC                                                           |

The pair of ends is unique, and an end cannot depend on itself (`CHECK`). An end names a row in
one of two tables, so it cannot be a foreign key: the host removes the dependencies that name an
activity or a stage in the same transaction that removes it. **A cycle is refused twice** — by
the domain, which names the loop, and by the host (`dependency_cycle`) — over the graph as the
domain expands it, where a stage stands for all its activities; SQLite cannot see a cycle.
Before scheduling, the domain expands every stage end into the stage's activities; a dependency
onto a stage with no activities joins nothing and is reported as inert (ADR-015).

### `baseline`, `baseline_activity` and `baseline_stage` — insert-only

A baseline is the plan as it was approved: each activity's name, stage, duration, start and
finish at that moment, each stage, the money planned, and the finish date of the work (F2, F8).
Approving the plan takes baseline 1 and sets `work.approved_at`; every later baseline closes a
replanning and carries its reason (F8, ADR-027). The slip is measured against the latest; any
two compare (ADR-028). These are the first tables of requirement one: **no row is ever changed
or removed** (ADR-016).

| `baseline`      | Type    | Meaning                                                                                                                         |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | TEXT    | UUID v7                                                                                                                         |
| `number`        | INTEGER | 1, 2, 3 … unique; the host takes one more than the last                                                                         |
| `taken_at`      | TEXT    | UTC                                                                                                                             |
| `reason`        | TEXT    | why the plan changed, up to 2 000 characters — the reason of the replanning it closed; `NULL` for baseline 1, the approval      |
| `finish_date`   | TEXT    | the work's finish date on that day, a real ISO date, or `NULL` when nothing was scheduled                                       |
| `planned_cents` | INTEGER | the work's planned money then — every cost line, in cents, `>= 0`; `NULL` for a baseline taken before F8: **not recorded** (F8) |

| `baseline_activity` | Type    | Meaning                                                                                                                            |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `baseline_id`       | TEXT    | `REFERENCES baseline`                                                                                                              |
| `activity_id`       | TEXT    | the activity's id — **not** a foreign key, so an activity removed after approval stays in the baseline it was approved in          |
| `position`          | INTEGER | the row's order in the breakdown when the baseline was taken                                                                       |
| `name`              | TEXT    | the activity's name then, copied                                                                                                   |
| `stage_name`        | TEXT    | its stage's name then, copied                                                                                                      |
| `duration_days`     | INTEGER | 1 to 3650, or `NULL` if it had none                                                                                                |
| `start`, `finish`   | TEXT    | ISO dates, both or neither, start not after finish                                                                                 |
| `planned_cents`     | INTEGER | the money planned on the activity then — the cost lines that name it, in cents, `>= 0`; `NULL` for a baseline taken before F8 (F8) |

The primary key is `(baseline_id, activity_id)`. The host checks that a baseline's rows name
every activity of the work exactly once and nothing else, and writes the baseline and its rows
in one transaction.

| `baseline_stage` | Type    | Meaning                                                                                                            |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `baseline_id`    | TEXT    | `REFERENCES baseline`                                                                                              |
| `stage_id`       | TEXT    | the stage's id — **not** a foreign key, so a stage removed after approval stays in the baseline it was approved in |
| `position`       | INTEGER | the stage's order then, from 1, unique within the baseline                                                         |
| `name`           | TEXT    | the stage's name then, copied, 1–120 characters                                                                    |
| `planned_cents`  | INTEGER | the money planned on the stage then — its own cost lines and its activities', in cents, `>= 0`; `NULL` before F8   |

The primary key is `(baseline_id, stage_id)`, one row per stage the plan held, a stage with no
activity included (F8). Two baselines compare their stages **by id**, so a stage renamed between
them is the same stage, not one removed and one added.

**Money is recorded from F8 on, and never invented for before.** The host reads the three
amounts from the cost lines inside the baseline's transaction, as it reads the names — the draft
the interface sends carries only the placements the domain computed — and writes 0 where there
is no cost line. A baseline taken before migration 009 recorded no money: its three amounts are
`NULL`, which means _not recorded then_, and a comparison that reaches one says so, never 0.

**How the schema refuses an edit.** On all three tables, `BEFORE UPDATE` and `BEFORE DELETE`
triggers refuse every change and every removal. `INSERT OR REPLACE` removes the row it replaces
without firing a delete trigger when `recursive_triggers` is off — SQLite's default — so each
table also has a `BEFORE INSERT` trigger that refuses an insert whose key is already there; it
fires before conflict resolution, and the replace never reaches the row (with
`recursive_triggers` on, as this product opens every file, the delete trigger refuses it too).
Rows may be added only to the latest baseline, so a past one cannot gain a row it did not have
when it was approved. And `work.approved_at`, once set, cannot change. Every one of these
triggers raises the same message, `baseline: append-only`, and the host never issues a statement
that would reach one: the Rust module that writes baselines holds no `UPDATE` or `DELETE`, by
rule. Adding a column is not an `UPDATE`: the triggers of migration 003 cover the money columns
migration 009 added.

### `replanning` — written once (F8)

An approved plan is locked until somebody says why it changes (ADR-027). The "why" is a row: a
replanning is opened with a reason, and closed only by taking the next baseline, which copies
the reason into `baseline.reason` and writes its own number here, in one transaction. There is
no abandon and no discard. While the plan is approved and no replanning is open, the host
refuses every command that changes what a baseline records with `plan_approved`.

| `replanning`      | Type    | Meaning                                                                                          |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `id`              | TEXT    | UUID v7                                                                                          |
| `reason`          | TEXT    | why the plan changes, 1–2 000 characters, not blank                                              |
| `opened_at`       | TEXT    | UTC                                                                                              |
| `author_name`     | TEXT    | the display name of the Windows account that opened it                                           |
| `closed_at`       | TEXT    | UTC, when the baseline that closed it was taken; `NULL` while it is open                         |
| `baseline_number` | INTEGER | `REFERENCES baseline (number)` — the baseline that closed it, 2 or more; `NULL` while it is open |

A `CHECK` keeps `closed_at` and `baseline_number` both set or both empty. **At most one is
open**: a partial unique index over the open rows, on the expression `closed_at IS NULL` —
SQLite counts `NULL`s as distinct in a unique index, so an index on `closed_at` itself would let
a second open row in.

**Written once, not append-only.** Closing a replanning writes its `closed_at` and
`baseline_number`, so the table cannot refuse every `UPDATE` as a baseline does. Triggers refuse
the rest, each with `replanning: written once`: a removal, an insert whose id is already there,
and any update of a closed row or of the reason, the author or the moment it was opened — the
one change a replanning takes is its closing. The record that matters, the reason, is the
baseline's copy, which is insert-only.

### `decision`

A decision belongs to a stage — _which tile_, _which colour_, _which contractor for the roof_ —
and carries a lead time: the working days between deciding and having what was decided on site
(F3).

| Column           | Type    | Meaning                                                                       |
| ---------------- | ------- | ----------------------------------------------------------------------------- |
| `id`             | TEXT    | UUID v7                                                                       |
| `stage_id`       | TEXT    | `REFERENCES stage ON DELETE CASCADE` — removing a stage removes its decisions |
| `position`       | INTEGER | order inside the stage, unique per stage, 1 … n                               |
| `name`           | TEXT    | 1–120 characters, not blank                                                   |
| `lead_time_days` | INTEGER | working days between deciding and having, 0 to 3650, default 0                |
| `made_at`        | TEXT    | UTC, when it was made; `NULL` while it is open                                |
| `answer`         | TEXT    | what was decided, 1–500 characters, optional — and only on a made decision    |
| `created_at`     | TEXT    | UTC                                                                           |

**The deadline is never a column** (ADR-017). It is computed by the domain every time: the
earliest scheduled start among the stage's activities minus the lead time, counted backwards in
working days on the work's calendar — so it moves when the schedule moves and nobody maintains
it. A stage with nothing scheduled gives no deadline. There is no _overdue_ column either:
overdue is the deadline against today, and today is an input the interface passes to the
domain, not a fact the file could keep. An answer belongs to the making: `CHECK (answer IS NULL
OR made_at IS NOT NULL)`, and reopening a decision clears both. Positions are renumbered 1 … n
by the host with every move and removal, as for activities.

### The diary — `diary_entry`, `diary_done`, `diary_present`, `diary_photo` — insert-only

An entry is a fact about one day on site (F4, ADR-019). The plan is intent; the diary is fact,
and progress is derived from it by the domain (ADR-020), never stored.

| `diary_entry`  | Type    | Meaning                                                                                         |
| -------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `seq`          | INTEGER | 1, 2, 3 … — the entry's place in the chain; primary key; always the last plus one               |
| `day`          | TEXT    | the ISO day the entry is about; never in the future (the domain and the host both refuse it)    |
| `kind`         | TEXT    | `entry` or `correction`                                                                         |
| `corrects_seq` | INTEGER | for a correction, the earlier entry it corrects (`REFERENCES diary_entry`); `NULL` for an entry |
| `note`         | TEXT    | what the day was, up to 4 000 characters; for a correction, also what was wrong (required)      |
| `weather`      | TEXT    | `sun`, `cloud`, `rain`, `storm`, `wind`, `other`, or `NULL`                                     |
| `lost_day`     | INTEGER | 1 when no work was possible that day                                                            |
| `hours`        | REAL    | hours worked, 0 to 24, or `NULL`                                                                |
| `deliveries`   | TEXT    | what arrived, 1–2 000 characters, or `NULL`                                                     |
| `incidents`    | TEXT    | what went wrong, 1–2 000 characters, or `NULL`                                                  |
| `visitors`     | TEXT    | who visited, 1–2 000 characters, or `NULL`                                                      |
| `author_name`  | TEXT    | the display name of the Windows account that wrote it — the product has no accounts of its own  |
| `created_at`   | TEXT    | UTC, when it was written                                                                        |
| `prev_hash`    | TEXT    | the `hash` of entry `seq − 1`, 64 lower-case hex; the empty string for the first entry only     |
| `hash`         | TEXT    | SHA-256 of this entry's canonical form, 64 lower-case hex, unique                               |

A `CHECK` holds the shape: an `entry` corrects nothing; a `correction` corrects an earlier
`seq`. Indexes on `day` and on `corrects_seq`. A second entry on a day that has one is allowed
and ordered by `seq`; a replacement is not, because nothing can replace a row.

| `diary_done`  | Type    | Meaning                                                |
| ------------- | ------- | ------------------------------------------------------ |
| `entry_seq`   | INTEGER | `REFERENCES diary_entry`                               |
| `activity_id` | TEXT    | the activity worked on — **no foreign key**, see below |
| `state`       | TEXT    | `worked` or `finished`                                 |
| `quantity`    | REAL    | how much was done, `>= 0`, or `NULL`                   |
| `note`        | TEXT    | 1–500 characters, or `NULL`                            |

| `diary_present` | Type    | Meaning                                 |
| --------------- | ------- | --------------------------------------- |
| `entry_seq`     | INTEGER | `REFERENCES diary_entry`                |
| `person_id`     | TEXT    | the person on site — **no foreign key** |

| `diary_photo`     | Type    | Meaning                                                                                                                                                        |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry_seq`       | INTEGER | `REFERENCES diary_entry`                                                                                                                                       |
| `position`        | INTEGER | the photo's order in the entry, from 1                                                                                                                         |
| `file_hash`       | TEXT    | SHA-256 of the file's bytes — its name in `documents/`; unique within the entry                                                                                |
| `file_name`       | TEXT    | the name it arrived with, 1–255 characters, kept for the person and never used as a path                                                                       |
| `bytes`           | INTEGER | its size                                                                                                                                                       |
| `width`, `height` | INTEGER | its dimensions, read from the header                                                                                                                           |
| `thumbnail`       | INTEGER | 1 when `thumbnails/<hash>.jpg` was rendered; 0 when the photo was kept but could not be drawn small — not part of the hash: it describes the copy, not the day |

**No foreign key into the plan, on purpose.** A done line names an activity and a presence names
a person by id: the plan may change after the day — an activity removed, a person removed — and
the diary must still say what it said. A key with `ON DELETE` would try to change the diary (and
be refused); a key without one would stop the plan from changing. The host checks the ids exist
when the entry is written.

**Append-only, in the schema.** On all four tables, `BEFORE UPDATE` and `BEFORE DELETE`
triggers refuse every edit and removal, and a `BEFORE INSERT` guard refuses a key that is
already there, so `REPLACE` cannot reach a row with `recursive_triggers` off. A done line, a
presence or a photo may be added only to the latest entry — the one being written. And
`diary_continue_the_chain` accepts an entry only as `seq = max + 1` with `prev_hash` equal to
the previous entry's `hash`. Every trigger raises `diary: append-only`; the host's `db::diary`
holds no `UPDATE`, `DELETE` or `REPLACE`, and a test reads its source to prove it.

**A correction restates the day.** It carries the full set of facts — done lines, people,
photos, which it may re-attach by hash without copying anything twice. For everything derived
from the diary, a corrected entry contributes nothing and its latest correction contributes
instead; a correction may itself be corrected.

**The canonical form.** An entry's `hash` is the SHA-256 of this UTF-8 string, computed by the
host before the insert and recomputed by `diary_verify`:

**Version 1**, as written in the header of `src-tauri/src/db/diary.rs`. It is a UTF-8 string
of **records** joined by U+001E (RECORD SEPARATOR); each record is a **tag** followed by
**fields**, joined by U+001F (UNIT SEPARATOR). A field is:

- the empty string, for `NULL`;
- `+` followed by the value, for a value — so the empty text `''` is `+` and differs from
  `NULL`.

Values are written as: text as stored; whole numbers in decimal (`12`); real numbers as the
shortest decimal that reads back as the same number, with no exponent (`8`, `7.5`, `0.25` —
Rust's `Display` for `f64`); `lost_day` as `0` or `1`. No value may contain U+001E or U+001F:
the host refuses control characters in every text of an entry, and ids and hashes cannot hold
them.

The records, in this order:

1. `entry.v1` · seq · day · kind · corrects_seq · note · weather · lost_day · hours · deliveries ·
   incidents · visitors · author_name · created_at · prev_hash
2. for each done line, sorted by activity id (byte order): `done` · activity_id · state ·
   quantity · note
3. for each person present, sorted by id (byte order): `present` · person_id
4. for each photo, by position: `photo` · file_hash · file_name · bytes · width · height

`hash` is the lower-case hex of SHA-256 over the bytes of that string. A photo's `thumbnail`
flag is not in it: it describes the copy, not the day. The tag carries the version, so a later
form can be introduced without making earlier entries unverifiable.

**What verification cannot see.** An entry removed from the _end_ of the diary leaves no
successor pointing at it, so the chain of what remains still verifies. The export of slice F10
records the count and the last hash, so that a copy kept elsewhere can show it.

### `stage_check` and `check_answer` — a stage's gates (F5)

A stage is _planned_, _started_ or _closed_ — `started_at` and `closed_at` above — and the
person decides it (ADR-022). It is intent, not progress. Starting needs the stage's **start
gate** passed and closing its **close gate**: every check at that gate has a latest answer of
`yes` or `na`. A trigger keeps `started_at` from changing once set, and a `CHECK` keeps a
stage from being closed before it was started. A closed stage refuses every change to its rows
in the host (`stage_closed`) until it is reopened.

| `stage_check` | Type    | Meaning                                             |
| ------------- | ------- | --------------------------------------------------- |
| `id`          | TEXT    | UUID v7                                             |
| `stage_id`    | TEXT    | `REFERENCES stage ON DELETE CASCADE`                |
| `gate`        | TEXT    | `start` or `close`                                  |
| `position`    | INTEGER | order at its gate, unique per stage and gate, 1 … n |
| `name`        | TEXT    | the question, 1–200 characters, not blank           |
| `created_at`  | TEXT    | UTC                                                 |

The table is `stage_check` and not `check`: CHECK is a reserved word in SQL.

| `check_answer` | Type    | Meaning                                                                      |
| -------------- | ------- | ---------------------------------------------------------------------------- |
| `id`           | TEXT    | UUID v7                                                                      |
| `check_id`     | TEXT    | `REFERENCES stage_check` — no cascade: a check that was answered cannot go   |
| `seq`          | INTEGER | 1, 2, 3 … per check, always the last plus one; the latest counts             |
| `answer`       | TEXT    | `yes`, `no` or `na`                                                          |
| `reason`       | TEXT    | 1–500 characters; **required for `na`** (`CHECK`), optional otherwise        |
| `photo_hash`   | TEXT    | the SHA-256 of a photo in `documents/`, copied like a diary photo, or `NULL` |
| `author_name`  | TEXT    | the display name of the Windows account that answered                        |
| `answered_at`  | TEXT    | UTC                                                                          |

**Answers are facts: append-only, not chained.** `check_answer` carries the diary's battery —
`BEFORE UPDATE` and `BEFORE DELETE` triggers, a `BEFORE INSERT` guard against `REPLACE` with
`recursive_triggers` off, and a trigger that accepts an answer only as the next `seq` of its
check — each raising `checks: append-only`. Answering again appends; nothing is rewritten.
There is **no hash chain**: the chain is the diary's, where the record is the day; an answer is a
fact of one gate. Because an answer's check cannot be removed, neither can a stage whose checks
were answered — the host refuses first with a sentence, and the foreign key refuses second.

### Money — `cost_line`, `commitment`, `payment` (F6)

Three amounts from three sources (ADR-023). **Every amount is `amount_cents`, an `INTEGER`** of
the minor unit of the work's currency (`work.currency`) — never a floating-point number. The
domain adds cents; the interface formats them.

| `cost_line`    | Type    | Meaning                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------- |
| `id`           | TEXT    | UUID v7                                                                           |
| `stage_id`     | TEXT    | `REFERENCES stage ON DELETE CASCADE`                                              |
| `activity_id`  | TEXT    | `REFERENCES activity ON DELETE CASCADE`, or `NULL` for a line on the stage itself |
| `label`        | TEXT    | 1–120 characters, not blank                                                       |
| `amount_cents` | INTEGER | the planned amount, `>= 0`                                                        |
| `created_at`   | TEXT    | UTC                                                                               |

**Planned** is cost lines: a stage's planned amount is its own lines plus its activities'. Cost
lines are plan, edited per work, and refused on a closed stage (ADR-022).

| `commitment`    | Type    | Meaning                                                   |
| --------------- | ------- | --------------------------------------------------------- |
| `id`            | TEXT    | UUID v7                                                   |
| `stage_id`      | TEXT    | `REFERENCES stage ON DELETE CASCADE`                      |
| `person_id`     | TEXT    | `REFERENCES person` — the contractor or trade — or `NULL` |
| `label`         | TEXT    | 1–120 characters, not blank — _Tiler's quote_             |
| `amount_cents`  | INTEGER | the amount agreed, `>= 0`                                 |
| `agreed_on`     | TEXT    | the ISO day it was agreed                                 |
| `document_hash` | TEXT    | the SHA-256 of the quote in `documents/`, or `NULL`       |
| `created_at`    | TEXT    | UTC                                                       |

**Committed** is commitments: a quote or a contract accepted. A commitment can be changed or
removed while nothing has been paid against it; from the first payment that names it, the host
refuses both, and the foreign key from `payment` keeps it — and its stage — from being removed.

| `payment`       | Type    | Meaning                                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------------------- |
| `id`            | TEXT    | UUID v7                                                                                     |
| `seq`           | INTEGER | 1, 2, 3 … — one sequence for the whole work, always the last plus one; unique               |
| `day`           | TEXT    | the ISO day it was paid                                                                     |
| `person_id`     | TEXT    | `REFERENCES person`, or `NULL`                                                              |
| `stage_id`      | TEXT    | `REFERENCES stage` — required: a payment always belongs to a stage                          |
| `commitment_id` | TEXT    | `REFERENCES commitment`, or `NULL` — a payment against no commitment is allowed and flagged |
| `amount_cents`  | INTEGER | never 0; positive for a payment, negative for a reversal                                    |
| `what_for`      | TEXT    | 1–200 characters, or `NULL`; **required on a reversal** — the note that says why            |
| `reverses_seq`  | INTEGER | for a reversal, the earlier payment it reverses (`REFERENCES payment (seq)`)                |
| `receipt_hash`  | TEXT    | the SHA-256 of the receipt image in `documents/`, or `NULL`                                 |
| `author_name`   | TEXT    | the display name of the Windows account that recorded it                                    |
| `created_at`    | TEXT    | UTC                                                                                         |

**Paid** is the ledger, and the ledger is **append-only**: the diary's battery of triggers —
`BEFORE UPDATE` and `BEFORE DELETE` refused, a guard before insert against `REPLACE` with
`recursive_triggers` off, and `seq` accepted only as the next — each raising `money:
append-only`. There is **no hash chain**: the chain is the diary's.

**Reversals.** A `CHECK` makes a payment positive with no `reverses_seq`, or a reversal negative
with an earlier `reverses_seq` and a note. The trigger `payment_reversal_rules` refuses, with
`money: reversal`, a reversal of a payment that is not there or of another reversal, a reversal
larger than the payment it reverses, a second reversal of the same payment, and a reversal for
another stage, person or commitment than the payment it reverses. The domain applies reversals
everywhere a paid amount is shown.

**Nothing that was paid disappears.** `payment`'s foreign keys to `stage`, `person` and
`commitment` have no action, so a stage, a person or a commitment that a payment names cannot be
removed; the host refuses first, with a sentence. A closed stage still accepts payments — money
paid is a fact — but not new cost lines. Payments travel in the work's snapshot, which suits the
thousands a house has; a much larger ledger would need a query of its own.

**Every money figure is computed**, never stored (ADR-024): planned, committed, paid, remaining
(planned − paid) and variance (committed − planned), per stage, per trade and for the work, each
the sum of its rows; _over committed_ where paid exceeds committed for a stage or a commitment,
or a payment names no commitment.

### `document` and `document_link` — the files the work owns (F7)

A document is a file the work owns: copied into `documents/`, typed by its bytes, never parsed
beyond an image's header (ADR-025). **One row per file** — `file_hash` is unique — so adding the
same bytes again links the row again instead of copying the file twice.

| `document`        | Type    | Meaning                                                                                                      |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `id`              | TEXT    | UUID v7; for a row the backfill created, derived from the hash (below)                                       |
| `file_hash`       | TEXT    | SHA-256 of the bytes — the file's name in `documents/`; unique                                               |
| `file_name`       | TEXT    | the name it arrived with, 1–255 characters — kept for the person, never used as a path                       |
| `media_type`      | TEXT    | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp` or `application/pdf`; `NULL` only as below |
| `bytes`           | INTEGER | the size; `NULL` only as below                                                                               |
| `width`, `height` | INTEGER | an image's dimensions, both or neither; always `NULL` for a PDF, which is never parsed                       |
| `kind`            | TEXT    | `photo`, `quote`, `drawing`, `permit`, `receipt`, `contract` or `other` — editable                           |
| `title`           | TEXT    | 1–200 characters — editable                                                                                  |
| `added_on`        | TEXT    | the ISO day it was added                                                                                     |
| `author_name`     | TEXT    | the display name of the Windows account that added it                                                        |
| `created_at`      | TEXT    | UTC                                                                                                          |

| `document_link` | Type | Meaning                                                                     |
| --------------- | ---- | --------------------------------------------------------------------------- |
| `document_id`   | TEXT | `REFERENCES document ON DELETE CASCADE`                                     |
| `target_kind`   | TEXT | `work`, `stage`, `activity`, `decision`, `entry`, `commitment` or `payment` |
| `target_id`     | TEXT | the target's id — for a diary entry, its `seq`                              |

The primary key is the triple. **A target is not a foreign key**: when a stage goes, its links
stay, and the interface lists them as a detached target rather than losing the document.
Removing a document removes its row and its links; the file is removed only when nothing else
names its hash — a diary photo, an answer's photo, a receipt, a commitment's quote, another
document — and the diary's own rows are never touched.

**Where the bytes are checked.** The diary's chain covers each photo's hash in its rows; it does
not read the files. `documents_verify` does: it reads every file in `documents/`, compares it
with its row's `file_hash`, and lists mismatches, rows whose file is missing, and orphans.

## Nothing is stored per lens, or per arrangement

The breakdown, the works by room and the owner's checklist are three arrangements of the same
rows, computed by the domain from one snapshot of the work (ADR-014). No table holds an
arrangement, and the work database has no lens column and never will: the lens is the person's
setting, in the application database, and it changes the words and the order on the screen,
never the work.

## Readiness is computed, not stored

Nothing in the schema records readiness. The domain computes it from the rows every time, from
a rule table that is data (`src/domain/readiness/rules.ts`, ADR-008 and ADR-018). Each rule says
whether it **applies** to a row in this plan and whether the row **holds** — knows what the rule
asks. A rule that does not apply is neither known nor missing: it is not counted, so it cannot
move the figure. Each row a rule applies to is one _must-know_; each that holds is one _known_;
each that does not is a _missing_ row, named, and opens from the figure. The figure is `known /
must-know`; the rules, summed, give exactly that figure; and the sentence is built from the
count of missing rows per rule, in the person's language.

| Rule                   | Slice | Applies to                               | Holds when                                                            | The sentence, in English                 |
| ---------------------- | ----- | ---------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| `activity.duration`    | F0    | every activity                           | it has a duration of one working day or more                          | "1 activity has no duration."            |
| `activity.responsible` | F0    | every activity                           | its responsible is a person of the work                               | "1 activity has no responsible."         |
| `activity.linked`      | F2    | every activity, in a plan of two or more | a dependency joins it to another, stages expanded                     | "1 activity is not linked to any other." |
| `decision.deadline`    | F3    | every decision                           | its stage has a scheduled activity, so it has a deadline              | "1 decision has no deadline yet."        |
| `decision.timely`      | F3    | every decision whose deadline is known   | it is made, or its deadline is today or later                         | "2 decisions are overdue."               |
| `stage.checks`         | F5    | every stage                              | it has at least one check at its start gate and one at its close gate | "2 stages have no checks."               |
| `stage.money`          | F6    | every stage                              | it has at least one cost line, its own or one of its activities'      | "2 stages have no money planned."        |

A plan with no activity at all is not ready: it has one missing row, "The plan has no activity
yet.", and a figure of 0 %. The nouns in the sentences follow the lens — the owner reads "job"
where the engineer reads "activity" (ADR-014). Every rule also has a one-sentence explanation of
why the plan must know it, in both languages, shown when its line on the dashboard is opened.
A later rule is a row of this table, and never a change of its shape.

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
- Every table that must never lose a row is insert-only: triggers refuse `UPDATE`, `DELETE`
  and `REPLACE`, and the Rust module that writes it contains no `UPDATE` or `DELETE` statement,
  by rule. **Shipped for the baselines (F2) and the diary (F4)**, whose entries also carry the
  hash of the one before; the payments ledger (F6) follows the same pattern.
- Text columns that a person types are bounded by `CHECK (length(...) <= n)` in the schema.

## Migrations

Numbered SQL files compiled into the binary, forward-only, applied in a transaction that also
moves `work.schema_version`. A release that adds a migration says so in the changelog and is
covered by a round-trip test that opens a work at version N-1 and migrates it without loss.

| Migration                            | Slice | Adds                                                                                                                                                                                                         |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `001_init.sql`                       | F0    | `work`, `calendar`, `holiday`, `person`, `stage`, `activity`                                                                                                                                                 |
| `002_rooms_and_quantities.sql`       | F1    | `room`, `activity_room`; `activity.quantity` and `activity.unit`                                                                                                                                             |
| `003_dependencies_and_baselines.sql` | F2    | `dependency`; `work.approved_at`; `baseline` and `baseline_activity` with their insert-only triggers                                                                                                         |
| `004_decisions.sql`                  | F3    | `decision`                                                                                                                                                                                                   |
| `005_diary.sql`                      | F4    | `diary_entry`, `diary_done`, `diary_present`, `diary_photo`, with their insert-only and chain triggers                                                                                                       |
| `006_checks.sql`                     | F5    | `stage.started_at` and `stage.closed_at`; `stage_check`; `check_answer` with its insert-only triggers                                                                                                        |
| `007_money.sql`                      | F6    | `person.trade`; `cost_line`; `commitment`; `payment` with its insert-only and reversal triggers                                                                                                              |
| `008_documents.sql`                  | F7    | `person.phone`, `.email`, `.note`, `.availability`; `person_stage`; `document`; `document_link`; the backfill of every file already in the folder                                                            |
| `009_replanning.sql`                 | F8    | `replanning` with its written-once triggers; `baseline.planned_cents` and `baseline_activity.planned_cents`; `baseline_stage` with its insert-only triggers; the backfill of every earlier baseline's stages |

Each migration has its round-trip test in `cargo test`: a work created at schema 1 with its
stages and activities migrates to schema 2 without loss, a work at schema 2 with rooms and
quantities migrates to schema 3 the same way, a work at schema 3 with dependencies and a
baseline migrates to schema 4, a work at schema 4 with decisions migrates to schema 5, a work at schema 5 with diary entries
migrates to schema 6 with its chain still verifying, and a work at schema 6 with checks and
answers migrates to schema 7 the same way, and a work at schema 7 with photos, receipts and
quotes migrates to schema 8 with a document for each and its chain still verifying, and a work
at schema 8 with two baselines migrates to schema 9 with their stages rebuilt, their money not
recorded and its chain still verifying.

**Migration 008's backfill.** Every file an earlier slice copied becomes a `document`, linked
where it came from, one row per hash in this order of precedence: a diary photo (kind `photo`,
linked to its entry by `seq`, with its name, size and dimensions); an answer's photo (`photo`,
linked to the check's stage); a receipt (`receipt`, linked to the payment); a commitment's
document (`quote`, linked to the commitment). Every origin is linked, even when the row came
from an earlier one. The id of a backfilled row is the first 32 hex digits of its hash in the
8-4-4-4-12 form, so the backfill is deterministic. What SQL cannot know is left `NULL` — no
earlier row recorded a media type, and only diary photos recorded a size — and the host
completes `media_type` and `bytes` from the files when the work is opened; a row whose file is
missing stays incomplete, and `documents_verify` lists it. That is the only case in which either
is `NULL`. A backfilled quote's author, which no earlier row recorded, reads "Unknown account".

**Migration 009's backfill.** A baseline taken before F8 recorded its activities' stage names and
nothing else about its stages. Its `baseline_stage` rows are rebuilt from them, one per stage,
numbered in the order they first appear in the breakdown. The id is the stage the activity still
belongs to, when the activity is still in the plan — an activity never moves between stages, so
that is the stage it was in. When none of a stage name's activities is left, the id is derived
from the name: four polynomial hashes of its code points, each modulo a prime just under 2³²,
written in the 8-4-4-4-12 form — the same name gives the same id in every baseline, so two old
baselines still compare that stage as one. A stage that had no activity when an old baseline was
taken left no trace in it, and is not invented. The money is `NULL` everywhere: not recorded
then, and never back-filled from today's cost lines, which are not what the plan held when it
was approved. The rows are written before the insert-only triggers on `baseline_stage` exist,
because from then on they refuse a row added to a past baseline.

The migrations live in `src-tauri/work_migrations/`.

## A comparison and a what-if are computed, not stored

Nothing in the schema records the comparison of two baselines: the domain computes it from their
rows every time (`compareBaselines`, ADR-028) — dates moved, durations changed, activities and
stages added and removed by id, the money, and the reasons of the baselines between them. A
what-if is never written at all: the domain applies its durations and lags to a copy of the
snapshot in memory (`withOverrides`), and **Clear**, leaving the Schedule or a restart forgets
it.

## Not yet in the schema

Templates are files in the repository, not rows (F9). A backup is a file beside the work, not a
table (F11).
