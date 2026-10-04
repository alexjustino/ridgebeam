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
                      contracts, warranties, manuals — named <sha-256>.<ext>
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
that are the person's rather than a work's — language, theme, the lens they last used — the
list of recent works with their folders, and the day each work was last backed up (F11). It holds
nothing about the content of a work.

## The work database

### `work`, and where the schema version lives

One row, `id = 1`, created by the first migration.

| Column             | Type    | Meaning                                                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `id`               | INTEGER | always 1 (`CHECK (id = 1)`)                                                                             |
| `schema_version`   | INTEGER | the last migration applied; moves independently of the product                                          |
| `work_id`          | TEXT    | UUID v7, the work's identity across renames and moves                                                   |
| `name`             | TEXT    | what the person calls the work                                                                          |
| `place`            | TEXT    | where it is, as the person writes it — never geocoded, never sent                                       |
| `start_date`       | TEXT    | ISO 8601 date, the first day the schedule may use                                                       |
| `currency`         | TEXT    | ISO 4217 code, three letters                                                                            |
| `created_at`       | TEXT    | UTC, milliseconds, trailing `Z`                                                                         |
| `approved_at`      | TEXT    | UTC, when baseline 1 was taken; `NULL` until then, and never changed once set (F2)                      |
| `template_id`      | TEXT    | the id of the template the plan was started from, 1–64 characters; `NULL` for a plan started empty (F9) |
| `template_version` | INTEGER | that template's version, 1 or more; `NULL` with the id (F9)                                             |
| `template_title`   | TEXT    | its title in the language the work was started in, 1–120 characters; `NULL` with the id (F9)            |

**Provenance, not a tie** (ADR-029). The three `template_*` columns are all set or all `NULL`, a
`CHECK` on the last of them. They record where the plan came from and nothing else: nothing is
ever read from the template again, and nothing in the work refers to it.

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

| `activity`          | Type    | Meaning                                                                                                                                                       |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | TEXT    | UUID v7                                                                                                                                                       |
| `stage_id`          | TEXT    | `REFERENCES stage ON DELETE CASCADE`                                                                                                                          |
| `position`          | INTEGER | order inside the stage, unique per stage                                                                                                                      |
| `name`              | TEXT    | not empty                                                                                                                                                     |
| `duration_days`     | INTEGER | working days, `NULL` until known, `> 0` once set                                                                                                              |
| `responsible_id`    | TEXT    | `REFERENCES person ON DELETE SET NULL`, `NULL` until known                                                                                                    |
| `created_at`        | TEXT    | UTC                                                                                                                                                           |
| `quantity`          | REAL    | how much of the activity there is — 12 (m² of tile); `NULL` or `>= 0`, a number and never text (F1)                                                           |
| `unit`              | TEXT    | the quantity's unit as the person writes it — `m²`, `m`, `un`; 1–16 characters, and only beside a quantity (F1)                                               |
| `duration_min_days` | INTEGER | the lower — optimistic — end of the activity's range of working days, 1–3650, as a template gave it (F9) or a person typed it (D1); `NULL` when there is none |
| `duration_max_days` | INTEGER | the upper — pessimistic — end, from the lower end to 3650; set exactly when `duration_min_days` is (F9)                                                       |

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

**A range is not a duration** (F9, ADR-029). An activity started from a template carries the
template's range and **no duration**: `duration_days` stays `NULL` while the range is a range, and
is written only by a person — typed, or taken from every range at once, its lower or its upper end
(`ranges_take`, which writes only activities with a range and no duration, outside a closed
stage, and is locked after approval like any duration edit). A range given as a point — which only
a file may carry — is applied as the duration too. The two ends are both set or both `NULL`, a
`CHECK` on the second column, because a column's `CHECK` may name a column added before it and not
one added after.

**Any activity can have a range, and approval does not lock it** (D1, ADR-035). From D1 the range
is the activity's **optimistic** and **pessimistic** duration, edited in the breakdown on every
activity — not only one a template brought — through `activity_update`, whose patch carries
`durationMinDays` and `durationMaxDays` together or not at all: both left out leaves the range
alone, both `null` clears it, two numbers set it, each a whole number of working days from 1 to
3650 and the optimistic not above the pessimistic (a point, both ends equal, is a range). The host
refuses one end on its own, a fraction, 0, a value past 3650 and an upside-down range, each with a
sentence. **A change that would leave the duration outside the range is refused** — a duration
typed outside it, or a range sent that does not hold the duration — with a sentence naming the
range; nothing widens or clears a range on its own, and the fix is one patch, the range or both
together. Only a change is asked: a duration an activity already held outside its range before D1
(F9 allowed it) is not refused when its name or its responsible changes. **The range is not in the
lock's list** ([ADR-027](architecture/ADR.md#adr-027)): a baseline records an activity's name and
duration, never its range, so an approved plan with no replanning open still takes a new range,
while a new duration is refused as before. An activity of a closed stage takes no change at all, a
range included. The range feeds the finish's probability, which the domain computes and nothing
stores ([ADR-035](architecture/ADR.md#adr-035)); there is no migration — the columns and their
`CHECK`s are F9's (migration 010).

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

| Column           | Type    | Meaning                                                                             |
| ---------------- | ------- | ----------------------------------------------------------------------------------- |
| `id`             | TEXT    | UUID v7                                                                             |
| `stage_id`       | TEXT    | `REFERENCES stage ON DELETE CASCADE` — removing a stage removes its decisions       |
| `position`       | INTEGER | order inside the stage, unique per stage, 1 … n                                     |
| `name`           | TEXT    | 1–120 characters, not blank                                                         |
| `lead_time_days` | INTEGER | working days between deciding and having, 0 to 3650, default 0                      |
| `lead_min_days`  | INTEGER | the lower end of the lead range a template gave, 0 to 3650; `NULL` when none (F9)   |
| `lead_max_days`  | INTEGER | the upper end, from the lower end to 3650; set exactly when `lead_min_days` is (F9) |
| `made_at`        | TEXT    | UTC, when it was made; `NULL` while it is open                                      |
| `answer`         | TEXT    | what was decided, 1–500 characters, optional — and only on a made decision          |
| `created_at`     | TEXT    | UTC                                                                                 |

**The deadline is never a column** (ADR-017). It is computed by the domain every time: the
earliest scheduled start among the stage's activities minus the lead time, counted backwards in
working days on the work's calendar — so it moves when the schedule moves and nobody maintains
it. A stage with nothing scheduled gives no deadline. There is no _overdue_ column either:
overdue is the deadline against today, and today is an input the interface passes to the
domain, not a fact the file could keep. An answer belongs to the making: `CHECK (answer IS NULL
OR made_at IS NOT NULL)`, and reopening a decision clears both. Positions are renumbered 1 … n
by the host with every move and removal, as for activities.

**A lead range keeps its upper end as the lead time** (F9). A decision a template brought takes
the **upper** end of its range as `lead_time_days` — the earlier deadline, the careful reading —
and keeps both ends for display. The ends are both set or both `NULL`, like an activity's. A
template may say which activity needs a decision; the host checks that it names one of the stage's
and does not store it, because in 1.0 a decision is needed by its whole stage.

### The diary — `diary_entry`, `diary_done`, `diary_present`, `diary_photo` — insert-only

An entry is a fact about one day on site (F4, ADR-019). The plan is intent; the diary is fact,
and progress is derived from it by the domain (ADR-020), never stored.

| `diary_entry`          | Type    | Meaning                                                                                           |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `seq`                  | INTEGER | 1, 2, 3 … — the entry's place in the chain; primary key; always the last plus one                 |
| `day`                  | TEXT    | the ISO day the entry is about; never in the future (the domain and the host both refuse it)      |
| `kind`                 | TEXT    | `entry` or `correction`                                                                           |
| `corrects_seq`         | INTEGER | for a correction, the earlier entry it corrects (`REFERENCES diary_entry`); `NULL` for an entry   |
| `note`                 | TEXT    | what the day was, up to 4 000 characters; for a correction, also what was wrong (required)        |
| `weather`              | TEXT    | `sun`, `cloud`, `rain`, `storm`, `wind`, `other`, or `NULL`                                       |
| `lost_day`             | INTEGER | 1 when no work was possible that day                                                              |
| `lost_cause`           | TEXT    | why, from E3: `weather`, `decision`, `absence`, `material`, `owner`, `access`, `other`, or `NULL` |
| `lost_party_person_id` | TEXT    | the person the lost day is put down to — **no foreign key** — or `NULL`; only with a cause        |
| `hours`                | REAL    | hours worked, 0 to 24, or `NULL`                                                                  |
| `deliveries`           | TEXT    | what arrived, 1–2 000 characters, or `NULL`                                                       |
| `incidents`            | TEXT    | what went wrong, 1–2 000 characters, or `NULL`                                                    |
| `visitors`             | TEXT    | who visited, 1–2 000 characters, or `NULL`                                                        |
| `author_name`          | TEXT    | the display name of the Windows account that wrote it — the product has no accounts of its own    |
| `created_at`           | TEXT    | UTC, when it was written                                                                          |
| `prev_hash`            | TEXT    | the `hash` of entry `seq − 1`, 64 lower-case hex; the empty string for the first entry only       |
| `hash`                 | TEXT    | SHA-256 of this entry's canonical form, 64 lower-case hex, unique                                 |

A `CHECK` holds the shape: an `entry` corrects nothing; a `correction` corrects an earlier
`seq`. From migration 015, two more: a `lost_cause` only on an entry whose `lost_day` is 1, and a
`lost_party_person_id` — an id of 36 characters — only with a cause. Indexes on `day` and on
`corrects_seq`. A second entry on a day that has one is allowed and ordered by `seq`; a
replacement is not, because nothing can replace a row.

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

**No foreign key into the plan, on purpose.** A done line names an activity, and a presence or a
lost day's party names a person, by id: the plan may change after the day — an activity removed,
a person removed — and the diary must still say what it said. A key with `ON DELETE` would try to change the diary (and
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
5. **only when `lost_cause` is not `NULL`** (E3): `lost` · lost_cause · lost_party_person_id

`hash` is the lower-case hex of SHA-256 over the bytes of that string. A photo's `thumbnail`
flag is not in it: it describes the copy, not the day. The tag carries the version, so a later
form can be introduced without making earlier entries unverifiable.

**The conditional record (E3, ADR-043).** Record 5 is written only for an entry that says why a
day was lost, and its party is the empty field when nobody was named. An entry with no cause —
every entry written before migration 015, and every one written after it without a cause — has
exactly the canonical string it always had, and so the same hash, byte for byte: the form is
extended, not changed, and the tag stays `entry.v1`. The host writes such an entry with the very
statement it always used, and a file not yet at migration 015 reads both columns as `NULL`. A
cause, once written, is as fixed as the rest of the entry — the `BEFORE UPDATE` trigger names no
column, so it refuses an update of these two as well — and is changed only by a correction.

**What verification cannot see.** An entry removed from the _end_ of the diary leaves no
successor pointing at it, so the chain of what remains still verifies. The diary export (F10,
ADR-032) records the count and the head of the chain — the first 16 hex digits of the last entry's
`hash` — so that a copy kept elsewhere can show it; the CSV and the JSON export carry every hash
in full.

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
| `needs_photo` | INTEGER | 0 or 1: a `yes` needs a photo (D3); 0 by default    |
| `created_at`  | TEXT    | UTC                                                 |

The table is `stage_check` and not `check`: CHECK is a reserved word in SQL.

**A check can need a photo** (D3, ADR-038). `needs_photo` marks a question about work that is
about to be hidden — the pipes and wiring before a wall is closed, the waterproofing before it is
tiled. A `yes` on it with no `photo_hash` is refused by the host with a sentence, and by the
trigger `check_answer_needs_photo` after it (`checks: needs a photo`); `no`, and `na` with its
reason, are accepted without one. The flag is set on the Gates tab, or by a template whose check
says `"photo": true`, and changed only while the stage is not closed. Answers given before the flag
was set — or before migration 012 — stay as they are: they are facts, and the handover book lists a
`yes` without its photo among what it lacks.

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
| `amount_cents` | INTEGER | the planned amount, `>= 0`; `NULL` for a line **not priced yet** (F9)             |
| `created_at`   | TEXT    | UTC                                                                               |

**Planned** is cost lines: a stage's planned amount is its own lines plus its activities'. Cost
lines are plan, edited per work, and refused on a closed stage (ADR-022).

**A line may be a label with no amount** (F9, ADR-029). A template carries no prices, so the cost
lines it brings have `amount_cents` `NULL` — _not priced yet_, which is not 0. Planned money sums
the priced lines and lists each unpriced one as a row marked so, contributing nothing; the S-curve
draws only priced lines; and readiness's `stage.money` needs a priced line. `cost_line_add` and
`cost_line_update` accept `NULL` to leave a line unpriced or to unprice it. Every line written
before F9 has an amount, so no existing total or readiness figure moved with the change.

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

### `payment_milestone` — a commitment's payment plan (D2)

A commitment may carry a **payment plan**: milestones, each a share of its amount earned by a fact
of the work, never by a date (ADR-037).

| `payment_milestone` | Type    | Meaning                                                                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                | TEXT    | UUID v7                                                                                                                                    |
| `commitment_id`     | TEXT    | `REFERENCES commitment ON DELETE CASCADE`                                                                                                  |
| `position`          | INTEGER | 1 … n within the commitment, renumbered in the same transaction as a move or a removal                                                     |
| `label`             | TEXT    | 1–120 characters, not blank — _Tiles laid_                                                                                                 |
| `share_bp`          | INTEGER | the share of the commitment's amount in basis points, 1–10 000 — "30 %" is 3 000                                                           |
| `trigger`           | TEXT    | the fact that earns it: `advance`, `stage_started`, `activity_finished` or `stage_closed`                                                  |
| `activity_id`       | TEXT    | `REFERENCES activity`, with no action; required when `trigger` is `activity_finished`, `NULL` otherwise — a `CHECK` holds the two together |
| `created_at`        | TEXT    | UTC                                                                                                                                        |

**The triggers are facts.** `advance` is earned the day the commitment was agreed
(`commitment.agreed_on`); `stage_started` the day the stage passed its start gate
(`stage.started_at`, F5); `stage_closed` the day it passed its close gate (`stage.closed_at`), and a
stage reopened has none, so it un-earns it; `activity_finished` the first day an effective diary
entry finished the activity, corrections applied (F4), so a correction that takes the finish back
un-earns it. A fact dated after today is not a fact yet. **Nothing records that a milestone was
earned**: the domain reads it from those facts every time (`src/domain/milestones.ts`), so there is
no column to set and none to tamper with.

**What the schema holds, behind the host.** The host refuses each of these first, with a sentence,
and the migration's triggers refuse them again, so a file written by something else holds the same
rules: the shares of one commitment summing past 10 000 (`money: payment plan over 100 %`); an
`activity_finished` milestone naming an activity of another stage than the commitment's (`money:
milestone activity`); and **any insert, change or removal once a payment names the commitment** — a
reversal included — (`money: payment plan locked`), as a change to the commitment itself is refused
(F6). A closed stage does not refuse a milestone: a payment plan is money, not a plan edit, and no
baseline records it, so an approved plan's lock (ADR-027) does not cover it either.

**What goes with what.** A milestone goes with its commitment (`ON DELETE CASCADE`), which can
itself be removed only while nothing was paid against it. The activity a milestone names is
referenced with no action: the host refuses to remove an activity a milestone is earned by, with a
sentence, and the foreign key refuses it after. A stage nothing was paid on, removed whole, takes
its activities, its commitments and their milestones in the same statement. The lookups by
commitment use the index of `UNIQUE (commitment_id, position)`; `idx_payment_milestone_activity`
serves the check an activity's removal makes.

**Every figure is computed.** Earned, paid, due now (earned − paid, when positive) and ahead of the
work (paid − earned, when positive) are the domain's, per commitment, per stage and for the work,
each with its rows (ADR-024); due and ahead are summed commitment by commitment and never netted
across them. A milestone's amount is its share of the commitment's cents, rounded half up in exact
integer arithmetic (`milestoneCents`); in a plan of exactly 10 000 the last milestone takes the
remainder, so the plan sums to the commitment's amount exactly, and a plan below it is rounded
milestone by milestone. A commitment with no milestones is not evaluated — counted and listed as
having no payment plan; payments on no commitment are outside the question, and counted.

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
| `kind`            | TEXT    | `photo`, `quote`, `drawing`, `permit`, `receipt`, `contract`, `warranty`, `manual` or `other` — editable     |
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

`warranty` and `manual` arrived in D3 (migration 012), so that the handover book can list what the
owner keeps for the years after the work under their own headings.

### `care_note` — what the owner must know to look after the work (D3)

A care note is a sentence the owner keeps for later — _"Reseal the shower grout once a year"_,
_"The stopcock is under the sink"_ — on the whole work, a room or a stage, in an order the person
sets. The handover book prints them where they belong (ADR-038).

| `care_note`   | Type    | Meaning                                                                          |
| ------------- | ------- | -------------------------------------------------------------------------------- |
| `id`          | TEXT    | UUID v7                                                                          |
| `target_kind` | TEXT    | `work`, `room` or `stage`                                                        |
| `target_id`   | TEXT    | the room's or the stage's id; for the work, the work's own id                    |
| `position`    | INTEGER | 1 … n among the notes of one target, `UNIQUE (target_kind, target_id, position)` |
| `text`        | TEXT    | 1–1 000 characters, not blank — as the person wrote it                           |
| `created_at`  | TEXT    | UTC                                                                              |

**Not the plan.** A care note is not something a baseline records, so an approved plan does not
lock it and a closed stage does not refuse it: it can be written, changed, moved or removed at any
time. **A target is not a foreign key** — one column cannot reference three tables — so the host
removes the notes that name a room or a stage in the same transaction that removes it; nothing is
left pointing at a target that is gone.

### `change_order` and `change_order_decision` — insert-only (E1)

After the plan is approved, a change of scope is a request on record: who asked, what changes, what
it costs, and what it does to the finish, computed by the schedule before anybody decides
(ADR-041). Two tables, both **insert-only**: a change is raised once and decided once, and neither
row is ever edited or removed. A mistake is withdrawn and raised again, and the record keeps both.

| `change_order`       | Type    | Meaning                                                                                                            |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                 | TEXT    | UUID v7                                                                                                            |
| `number`             | INTEGER | 1, 2, … — the next after the highest already written; unique, never reused, so a withdrawn change keeps its number |
| `raised_on`          | TEXT    | the ISO day it was raised                                                                                          |
| `title`              | TEXT    | 1–200 characters, not blank — _Extra socket in the kitchen_                                                        |
| `description`        | TEXT    | up to 2 000 characters, or `NULL`                                                                                  |
| `asked_by`           | TEXT    | `owner`, `person` or `other`                                                                                       |
| `asked_by_person_id` | TEXT    | the person of the plan who asked — required when `asked_by` is `person`, `NULL` otherwise; **not a foreign key**   |
| `asked_by_name`      | TEXT    | the name of somebody outside the plan, 1–120 characters — required when `asked_by` is `other`, `NULL` otherwise    |
| `stage_id`           | TEXT    | the stage the change lands on; **not a foreign key**                                                               |
| `cost_cents`         | INTEGER | the price, signed — a change can save money; `NULL` for a change **not priced**, which is not 0                    |
| `effects`            | TEXT    | a JSON array of effects (below), validated by the host when the change is raised                                   |
| `author_name`        | TEXT    | the display name of the Windows account that raised it                                                             |
| `created_at`         | TEXT    | UTC                                                                                                                |

| `change_order_decision` | Type    | Meaning                                                                                                             |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `change_order_id`       | TEXT    | primary key — **one decision per change**; a decision on a change the work does not have is refused                 |
| `outcome`               | TEXT    | `approved`, `declined` or `withdrawn`                                                                               |
| `decided_on`            | TEXT    | the ISO day it was decided                                                                                          |
| `note`                  | TEXT    | up to 2 000 characters, or `NULL`                                                                                   |
| `finish_before`         | TEXT    | the finish date before the change, as the schedule said at the moment of deciding, or `NULL`                        |
| `finish_after`          | TEXT    | the finish date with the change applied, as the schedule said at the moment of deciding, or `NULL`                  |
| `days_delta`            | INTEGER | the working days between the two, signed, as the domain computed them at the moment of deciding and sent; or `NULL` |
| `cost_cents`            | INTEGER | the change's price, copied from it                                                                                  |
| `replanning_id`         | TEXT    | the replanning the approval opened or joined; `NULL` for a decline or a withdrawal                                  |
| `author_name`           | TEXT    | the display name of the Windows account that decided it                                                             |
| `created_at`            | TEXT    | UTC                                                                                                                 |

**The effects.** `effects` holds a JSON array of at most 50 effects, each one of three kinds; an
empty array is a change that is only money.

```json
[
  { "kind": "add", "name": "Extra socket", "durationDays": 2, "after": "<activity id>" },
  { "kind": "duration", "activityId": "<activity id>", "durationDays": 5 },
  { "kind": "remove", "activityId": "<activity id>" }
]
```

**`add`** is a new activity in the change's stage, named in 1–200 characters, of 1–3 650 working
days, finish-to-start after `after` — an existing activity — or after none when `after` is `null`;
**`duration`** sets an existing activity's duration, 1–3 650 working days; **`remove`** drops an
activity, which narrows the scope. When the change is raised the host checks the kinds and the
ranges; that every activity named exists and is not in a closed stage; that a new duration lies
inside the activity's range, when it has one; that an activity a payment milestone is earned by is
not removed; that no activity is named against itself — removed and changed, removed and followed,
or changed twice; and that the change's stage exists and is not closed — and refuses the change with
a sentence otherwise. It stores the array as it was validated and never computes a schedule from it:
the impact is the domain's (`withEffects`, `changeImpact`).

**Who asked, and where it lands, are not foreign keys.** A person removed from the plan, or a stage
removed after the change was decided, leaves the change order as it was written; the interface says
the person or the stage is no longer in the plan rather than losing the record.

**The decision freezes the impact.** `finish_before`, `finish_after` and `days_delta` are the
schedule as it was on the day of the decision: the interface's domain computes them and sends them,
and the host stores them as the facts of that moment. They are never recomputed — the plan may move
later for other reasons, and the record keeps what was known when somebody said yes.

**What an approval writes.** In one transaction: a replanning opened with the reason _"Change order
#N — {title}"_ when none is open (when one is, the change joins it and its reason is not rewritten);
the effects applied as ordinary rows — an `activity` and its `dependency` added, an activity's
duration changed, an activity removed — through the same functions the plan's commands use; a
`cost_line` on the change's stage labelled _"Change order #N"_, with no activity, when the change is
priced at 0 or more — a saving adds no line, since a planned amount is never negative, and the
person lowers the plan's own lines by hand in the same replanning; and the decision, carrying the
replanning's id. If any of it is refused, nothing is written. A decline or a withdrawal writes only
the decision.

**Insert-only, behind the host.** Migration 013 gives both tables the battery of migrations 003,
007 and 009: triggers refuse `UPDATE` and `DELETE`, and a guard before insert refuses a key — or,
for a change, a number — that is already there, so `INSERT OR REPLACE` cannot remove a row whether
`recursive_triggers` is on or off; a change whose number is not the next one is refused too. Each
raises `change order: append-only`. What the host refuses first with a sentence, the schema
refuses again, so a file written by something else holds the same rules: a change raised before
the plan is approved (`change order: plan not approved`); a decision for a change that is not
there, dated before the change was raised, or carrying another price than the change's (`change
order: decision`); an `effects` that is not a JSON array of at most 50; and a replanning named by
anything but an approval, or an approval that names none. The Rust module that writes them
(`db/change_orders.rs`) holds no `UPDATE`, `DELETE` or `REPLACE`, and a test reads its source to
prove it. **Every figure is computed**: the tally — how
many changes approved, declined, withdrawn and waiting, the price and the working days of the
approved ones, and who asked them — is the domain's (`changeTally`), from these rows, each figure
with its rows.

### `funding` and `funding_receipt` — where the money comes from (E2)

The owner writes down the money the work will receive — savings on hand, a loan's tranches, a
client's instalments — each expected on a day, and records each sum when it actually arrives
(ADR-042). **Funding is plan** and **receipts are facts**: the first table is edited like a
commitment, the second is a ledger exactly like the payments.

| `funding`      | Type    | Meaning                                                                                                |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `id`           | TEXT    | UUID v7                                                                                                |
| `position`     | INTEGER | 1 … n for the whole work, in the order written, unique, closed up when one is removed; never reordered |
| `label`        | TEXT    | 1–200 characters, not blank — _Loan tranche 2_                                                         |
| `source`       | TEXT    | where it comes from, 1–200 characters, or `NULL` — _the bank_                                          |
| `amount_cents` | INTEGER | the amount expected, `> 0`                                                                             |
| `expected_on`  | TEXT    | the ISO day it is expected                                                                             |
| `note`         | TEXT    | up to 2 000 characters, or `NULL`                                                                      |
| `created_at`   | TEXT    | UTC                                                                                                    |

**A fund is plan.** It is changed freely — its amount, its day, its words — and an approved plan's
lock does not cover it (ADR-027): funding is not the plan's scope, and no baseline records it. It is
removed only while no receipt names it; from the first receipt that does, the host refuses with a
sentence, and the foreign key from `funding_receipt` refuses it after.

| `funding_receipt` | Type    | Meaning                                                                              |
| ----------------- | ------- | ------------------------------------------------------------------------------------ |
| `id`              | TEXT    | UUID v7                                                                              |
| `seq`             | INTEGER | 1, 2, 3 … — one sequence for the whole work, always the last plus one; unique        |
| `day`             | TEXT    | the ISO day the money arrived — **never after today**, which the host refuses        |
| `funding_id`      | TEXT    | `REFERENCES funding`, with no action, or `NULL` for money that arrived unplanned     |
| `amount_cents`    | INTEGER | never 0; positive for money received, negative for a reversal                        |
| `note`            | TEXT    | 1–200 characters, or `NULL`; a reversal carries none                                 |
| `reverses_seq`    | INTEGER | for a reversal, the earlier receipt it reverses (`REFERENCES funding_receipt (seq)`) |
| `author_name`     | TEXT    | the display name of the Windows account that recorded it                             |
| `created_at`      | TEXT    | UTC                                                                                  |

**Money received is a ledger, append-only.** Migration 014 gives `funding_receipt` the battery of
migration 007: `BEFORE UPDATE` and `BEFORE DELETE` refused, a guard before insert that refuses an id
or a `seq` already there — so `INSERT OR REPLACE` cannot remove a row whether `recursive_triggers`
is on or off — and `seq` accepted only as the next, each raising `funding: append-only`. There is no
hash chain. A receipt's day is never after today, and that is the host's to refuse: the schema has
no clock it can trust.

**Reversals.** A `CHECK` makes a receipt positive with no `reverses_seq`, or a reversal negative
with an earlier `reverses_seq`. The trigger `funding_receipt_reversal_rules` refuses, with `funding:
reversal`, a reversal of a receipt that is not there or of another reversal, a reversal of any
amount but the whole receipt's, for another fund than the receipt's, dated before it, and a second
reversal of the same receipt. Unlike a payment, a receipt is not reversed in part: money that
arrived short is a reversal and a new receipt of what did arrive. The domain applies reversals
everywhere money received is shown.

**What goes with what.** The receipts name their fund by a foreign key with no action, so a fund
money was received against cannot be removed, and nothing that arrived disappears with the plan
for it. `idx_funding_receipt_funding` serves the lookup by fund and the check a removal makes. The
Rust module that writes the ledger holds no `UPDATE`, `DELETE` or `REPLACE`, and a test reads its
source to prove it.

**Nothing here holds a projection.** Whether the money lasts is the domain's (`runway`), computed
every time from these two tables, the payments, the payment plans, the schedule and the cost lines;
no table holds a week, a balance or a chance (below, _A comparison, a what-if and a chance are
computed, not stored_).

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

| Rule                   | Slice | Applies to                                            | Holds when                                                                                   | The sentence, in English                              |
| ---------------------- | ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `activity.duration`    | F0    | every activity                                        | it has a duration of one working day or more                                                 | "1 activity has no duration."                         |
| `activity.responsible` | F0    | every activity                                        | its responsible is a person of the work                                                      | "1 activity has no responsible."                      |
| `activity.linked`      | F2    | every activity, in a plan of two or more              | a dependency joins it to another, stages expanded                                            | "1 activity is not linked to any other."              |
| `decision.deadline`    | F3    | every decision                                        | its stage has a scheduled activity, so it has a deadline                                     | "1 decision has no deadline yet."                     |
| `decision.timely`      | F3    | every decision whose deadline is known                | it is made, or its deadline is today or later                                                | "2 decisions are overdue."                            |
| `stage.checks`         | F5    | every stage                                           | it has at least one check at its start gate and one at its close gate                        | "2 stages have no checks."                            |
| `stage.money`          | F6    | every stage                                           | it has at least one **priced** cost line, its own or one of its activities' (priced from F9) | "2 stages have no money planned."                     |
| `change.waiting`       | E1    | every change order                                    | it is decided, or it was raised 7 calendar days ago or less                                  | "1 change is waiting for a decision."                 |
| `work.funding`         | E2    | the work, when its priced planned money is above zero | at least one fund is recorded — money received with no fund does not count                   | "Where the money comes from is not written down yet." |

A plan with no activity at all is not ready: it has one missing row, "The plan has no activity
yet.", and a figure of 0 %. The nouns in the sentences follow the lens — the owner reads "job"
where the engineer reads "activity" (ADR-014). Every rule also has a one-sentence explanation of
why the plan must know it, in both languages, shown when its line on the dashboard is opened.
A later rule is a row of this table, and never a change of its shape. Slice F9 changed two rows'
reading and neither's shape: `activity.duration`'s missing row names the range an activity carries
from its template, and `stage.money` counts only a priced line — every line before F9 was one, so
no existing figure moved.

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

Restoring a backup of a work this list already knows at another folder moves its row to the
restored folder; the old folder is left as it was, and the answer names it (ADR-033).

### `backup` — the day of the last backup (F11)

| Column       | Type    | Meaning                                                                        |
| ------------ | ------- | ------------------------------------------------------------------------------ |
| `work_id`    | TEXT    | primary key, the work's UUID (36 characters)                                   |
| `day`        | TEXT    | `YYYY-MM-DD`, the day the last backup was written, on this computer's calendar |
| `written_at` | TEXT    | UTC                                                                            |
| `bytes`      | INTEGER | the backup file's size                                                         |
| `files`      | INTEGER | how many of the work's files it holds, the database included (≥ 1)             |

One row per work, replaced by the next backup. It is here and not in the work: a backup cannot hold
the moment it was itself written, and a work restored on another computer was never backed up
_there_. Where the file went is not kept — it is the person's, and may be moved or deleted without
the product being told. Settings reads it as "Last backed up on this machine on {day}." or "Not backed up on this
machine yet.", and Diagnostics' folder health as its last backup, or "never, on this machine".

### Application migrations

Numbered like the work's, in `src-tauri/migrations/`: `001_init` (`workspace`, `recent_work`),
`002_settings` (`settings`) and, from F11, `003_backups` (`backup`). Diagnostics lists every
migration each database has been through, by number and name.

## Conventions

- Identifiers are UUID v7 as 36-character text; timestamps are UTC with milliseconds and a
  trailing `Z`; dates are ISO 8601 `YYYY-MM-DD` text.
- Every table that must never lose a row is insert-only: triggers refuse `UPDATE`, `DELETE`
  and `REPLACE`, and the Rust module that writes it contains no `UPDATE` or `DELETE` statement,
  by rule. **Shipped for the baselines (F2) and the diary (F4)**, whose entries also carry the
  hash of the one before; the payments ledger (F6), the change orders (E1) and the money received
  (E2) follow the same pattern.
- Text columns that a person types are bounded by `CHECK (length(...) <= n)` in the schema.

## Migrations

Numbered SQL files compiled into the binary, forward-only, applied in a transaction that also
moves `work.schema_version`. A release that adds a migration says so in the changelog and is
covered by a round-trip test that opens a work at version N-1 and migrates it without loss.

| Migration                            | Slice | Adds                                                                                                                                                                                                                  |
| ------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_init.sql`                       | F0    | `work`, `calendar`, `holiday`, `person`, `stage`, `activity`                                                                                                                                                          |
| `002_rooms_and_quantities.sql`       | F1    | `room`, `activity_room`; `activity.quantity` and `activity.unit`                                                                                                                                                      |
| `003_dependencies_and_baselines.sql` | F2    | `dependency`; `work.approved_at`; `baseline` and `baseline_activity` with their insert-only triggers                                                                                                                  |
| `004_decisions.sql`                  | F3    | `decision`                                                                                                                                                                                                            |
| `005_diary.sql`                      | F4    | `diary_entry`, `diary_done`, `diary_present`, `diary_photo`, with their insert-only and chain triggers                                                                                                                |
| `006_checks.sql`                     | F5    | `stage.started_at` and `stage.closed_at`; `stage_check`; `check_answer` with its insert-only triggers                                                                                                                 |
| `007_money.sql`                      | F6    | `person.trade`; `cost_line`; `commitment`; `payment` with its insert-only and reversal triggers                                                                                                                       |
| `008_documents.sql`                  | F7    | `person.phone`, `.email`, `.note`, `.availability`; `person_stage`; `document`; `document_link`; the backfill of every file already in the folder                                                                     |
| `009_replanning.sql`                 | F8    | `replanning` with its written-once triggers; `baseline.planned_cents` and `baseline_activity.planned_cents`; `baseline_stage` with its insert-only triggers; the backfill of every earlier baseline's stages          |
| `010_templates.sql`                  | F9    | `activity.duration_min_days` and `.duration_max_days`; `decision.lead_min_days` and `.lead_max_days`; `work.template_id`, `.template_version` and `.template_title`; `cost_line` rebuilt with `amount_cents` nullable |
| `011_payment_milestones.sql`         | D2    | `payment_milestone` with its `CHECK`s and its triggers: an activity of the commitment's stage, at most 100 % per commitment, and locked once a payment names the commitment                                           |
| `012_handover.sql`                   | D3    | `stage_check.needs_photo` and the trigger that refuses a `yes` without a photo on such a check; `document` rebuilt with the kinds `warranty` and `manual`, its links set aside and restored; `care_note`              |
| `013_change_orders.sql`              | E1    | `change_order` and `change_order_decision`, each with its `CHECK`s and the insert-only battery of migrations 003, 007 and 009                                                                                         |
| `014_funding.sql`                    | E2    | `funding`; `funding_receipt` with its `CHECK`s, the insert-only battery of migration 007 and its reversal trigger                                                                                                     |
| `015_lost_cause.sql`                 | E3    | `diary_entry.lost_cause` and `.lost_party_person_id`, each with its `CHECK`; the canonical form's conditional `lost` record                                                                                           |

Each migration has its round-trip test in `cargo test`: a work created at schema 1 with its stages
and activities migrates to schema 2 without loss, a work at schema 2 with rooms and quantities
migrates to schema 3 the same way, a work at schema 3 with dependencies and a baseline migrates to
schema 4, a work at schema 4 with decisions migrates to schema 5, a work at schema 5 with diary
entries migrates to schema 6 with its chain still verifying, and a work at schema 6 with checks and
answers migrates to schema 7 the same way, and a work at schema 7 with photos, receipts and quotes
migrates to schema 8 with a document for each and its chain still verifying, and a work at schema 8
with two baselines migrates to schema 9 with their stages rebuilt, their money not recorded and its
chain still verifying, and a work at schema 9 with cost lines, a baseline and a diary entry migrates
to schema 10 with every amount and id kept and its chain still verifying, and a work at schema 10
with commitments, payments and a diary migrates to schema 11 with every amount kept, no milestone
invented, the paid commitment's plan locked from the start — a reversal does not unlock it — and its
chain still verifying, and a work at schema 11 with documents and their links migrates to schema 12
with every document, id and link kept, every check not needing a photo and its chain still
verifying, and a work at schema 12 migrates to schema 13 losing nothing, with its chain still
verifying, and a work at schema 13 with change orders, payments and a diary migrates to schema 14
losing nothing, with no fund and no receipt invented and its chain still verifying, and a work at
schema 14 with diary entries, a correction and photos migrates to schema 15 with every entry's hash
byte for byte what it was, no cause invented and its chain verifying before and after.

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

**Migration 010's rebuild of `cost_line`.** SQLite cannot drop a `NOT NULL` from a column, so the
table is rebuilt, and the migration's header says how: `cost_line_010` is created with every
column, reference and `CHECK` exactly as migration 007 wrote them but `amount_cents`, which now
allows `NULL`; every row is copied across as it is — id, stage, activity, label, amount and the
moment it was written — so the ids the interface and the baselines know stay the ids; `cost_line`
is dropped, which drops its two indexes; `cost_line_010` is renamed `cost_line`; and the indexes
are created again under the names they had. It runs with `foreign_keys = ON` inside the runner's
transaction. No table, trigger or view refers to `cost_line`, so dropping it removes no row that
anything points at, and each copied row is checked against `stage` and `activity` as it is
inserted. A failure anywhere rolls the whole migration back and the file stays at version 9.

**Migration 012's rebuild of `document`.** SQLite cannot change a `CHECK` on a column, so the
table is rebuilt to take the two new kinds, the way migration 010 rebuilt `cost_line` — with one
more step, because a table points at it: `document_link.document_id` references `document` with
`ON DELETE CASCADE`, and with `foreign_keys = ON` dropping `document` would delete every link with
it. So every link is first copied, as it is, into a holding table with no reference, and
`document_link` is dropped, which drops its index; `document_012` is created with every column,
`CHECK` and default exactly as migration 008 wrote them but the kind rule, and every document is
copied across as it is — id, hash, name, type, size, dimensions, kind, title, day, author and the
moment it was written — so the ids the interface and the links know stay the ids; `document` is
dropped and `document_012` renamed `document`; `document_link` is created again exactly as
migration 008 wrote it, and the links are copied back, each checked against `document` as it is
inserted; the holding table is dropped and the index created again under the name it had. Neither
table carried a trigger or a view. A failure anywhere rolls the whole migration back and the file
stays at version 11. `stage_check.needs_photo` is added as 0 for every check already in the file,
and `care_note` starts empty: no answer, document or figure an earlier slice showed changes.

**Migration 011 adds a table and nothing else.** No existing row changes: every commitment starts
with no payment plan, which the domain reads as _not evaluated_ — never as earned, never as paid
ahead — so no figure an earlier slice showed moves with the migration.

**Migration 013 adds two tables and nothing else.** No existing row changes: a work migrated from
schema 12 has no change order, so the tally is empty, readiness's new rule applies to nothing, and
no figure an earlier slice showed moves with the migration.

**Migration 014 adds two tables and nothing else.** No existing row changes: a work migrated from
schema 13 has no fund and no receipt. Every figure an earlier slice showed stays as it was; what is
new is the projection, which for such a work opens with the payments already made and nothing
received, and readiness's new rule, which a work with priced planned money now misses until a fund
is recorded.

**Migration 015 adds two columns and nothing else.** It is a plain `ADD COLUMN`, not a rebuild:
SQLite accepts a column `CHECK` that reads another column of the row and tests it against every row
already there, and each passes, because both columns are `NULL`. No row is copied, so no row can
change — every entry keeps its bytes — and the triggers of migration 005 stay exactly as they were.
Every hash in the chain is the one it was (_The conditional record_, above). A work migrated from
schema 14 has no lost day with a cause, so the delay ledger counts its lost days as days with no
cause stated, and no figure an earlier slice showed moves with the migration.

The migrations live in `src-tauri/work_migrations/`.

## A comparison, a what-if and a chance are computed, not stored

Nothing in the schema records the comparison of two baselines: the domain computes it from their
rows every time (`compareBaselines`, ADR-028) — dates moved, durations changed, activities and
stages added and removed by id, the money, and the reasons of the baselines between them. A
what-if is never written at all: the domain applies its durations and lags to a copy of the
snapshot in memory (`withOverrides`), and **Clear**, leaving the Schedule or a restart forgets
it.

The finish as a probability (D1) is not stored either: the domain simulates it from the snapshot —
the durations, the ranges, the links, the calendar and the diary's actuals — every time a screen
asks, seeded by a hash of those inputs so the same plan gives the same numbers
([ADR-035](architecture/ADR.md#adr-035)). No table holds a run, a seed or a chance, and the plan's
own dates are the schedule's, untouched.

A change order's impact (E1) is computed the same way as a what-if — its effects applied to a copy
of the snapshot in memory (`withEffects`) and scheduled — every time a screen shows a change still
waiting. Only the decision stores it, once: the finish before and after and the working days
between them, as they were on the day somebody decided, never recomputed
([ADR-041](architecture/ADR.md#adr-041)).

Whether the money lasts (E2) is not stored either. The domain projects it week by week from the
funds, the receipts, the payments, the payment plans, the cost lines and the schedule every time a
screen asks (`runway`), and its chance from the same seeded runs as the finish's (`runwayChance`,
[ADR-042](architecture/ADR.md#adr-042)). No table holds a week, a balance or a chance, and nothing
the projection reads is changed by it. The rules it reads by are the domain's and are set out in
ADR-042: money earned and not paid, a milestone past its expected day, a closed stage's money still
owed, and money the schedule cannot date — noted as such — all fall in the current week; the rest of
a payment plan that covers less than its commitment is spread like a commitment with no plan; money
planned and not committed is less what was paid on the stage outside any commitment; a fund
expected today counts, and only one expected on an earlier day is late; and money dated after the
last week is listed, not counted. The result is one of four states — the money lasts, it runs
short, there is no funding, or there is nothing to project. The chance counts the runs whose balance
goes below zero in any week up to that run's own finish week, through a per-run hook on D1's
simulation that changes none of its results.

When the work will finish as things stand, and why it is late (E3), are not stored either. The
forecast is the domain's (`forecast`): the plan's activities and links laid on its calendar, forward
from what the diary says happened — a finished activity at its diary dates, a started one from its
first day and not finishing before today, one not started not before today — and measured against
the latest baseline's finish. The delay ledger (`delayLedger`) attributes the working days of that
difference to causes read from the change orders' frozen days, the lost days and their causes, the
weather, the decisions made after their deadline in the baseline and the people the diary says were
not on site, and says what it cannot attribute ([ADR-043](architecture/ADR.md#adr-043)). No table
holds a forecast date, a day of delay or a cause the domain inferred: the only thing written is the
cause a person gave for a lost day, in the diary, in the chain. The plan's own schedule and the slip
are untouched by either.

## Not yet in the schema

Nothing that 1.0 needs. A backup is a file the person keeps, not a table: the work records nothing
about it, and the application database only the day of the last one.

## Templates are files, not rows

A template is a JSON file (ADR-029): the library is `templates/*.json` in the repository, bundled
into the application, and a template from somebody else is a file read as text and validated by
the domain. No table holds a template. Applying one writes ordinary rows — stages, activities
with their ranges, checks, cost lines with no amount, decisions with their lead ranges, rooms and
dependencies — with new ids, in one transaction, and the work keeps only the three `template_*`
columns that say where its plan came from. Exporting a work as a template (ADR-030) reads the
snapshot and writes a file; nothing in the work records it.

## The work as JSON — the export format (F10)

`work_export_json` writes the whole work as one JSON file for anybody else's tool (SPEC R4,
ADR-031). It is written by the host from the database (`src-tauri/src/report/json.rs`),
pretty-printed, UTF-8 with no byte-order mark, ending in a line break, and it is a format this
document fixes. **`ridgebeamWork` is the version of the shape**: a field may be added under the same
number, and a reader should ignore a field it does not know; anything that changes what an existing
field means, or removes one, takes the next number.

```json
{
  "ridgebeamWork": 1,
  "exportedAt": "2026-09-28T14:03:11.402Z",
  "work": { "work": { "name": "…" }, "stages": [], "activities": [] },
  "diary": [{ "seq": 1, "day": "2026-09-21", "hash": "…", "prevHash": "" }]
}
```

| Field           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ridgebeamWork` | the format's version, `1`. A reader that does not know the number should refuse the file rather than guess                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `exportedAt`    | when the file was written, UTC with milliseconds and a trailing `Z`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `work`          | the work exactly as the `work_get` command returns it (`WorkSnapshot` in `src-tauri/src/contract.rs`): the work row with its provenance, the calendar and holidays, people, stages, rooms, activities, dependencies, baselines with their activities and stages, decisions, checks — each saying whether it needs a photo — and every answer, cost lines, commitments, the payments ledger with its reversals, documents with their links, the care notes, the change orders each with its decision or none, and the open replanning |
| `diary`         | every diary entry from 1, in the chain's order — corrections included, as they were written — with its done lines, the people present, its photos, why a lost day was lost (`lostCause` and `lostPartyPersonId`, `null` when none was given) and its `hash` and `prevHash`, so that a reader can recompute the chain from the canonical form above                                                                                                                                                                                   |

Field names are camelCase, as the interface receives them; money is whole minor units, dates are
`YYYY-MM-DD` and instants UTC, as everywhere in this model. Nothing is computed: no schedule, no
critical path, no readiness, no progress and no totals — those are the domain's, derived every
time from these rows, and a reader who wants them derives them too.

**What it does not hold.** The files themselves: a document or a photo is named by its hash (its
name in `documents/`) and by the file name it arrived with, and **not embedded**; copy the work
folder to carry them. No path from the person's machine — not the work folder, not where a file
came from. No settings, no lens, no recent list: those are the application's, not the work's. It
does carry everything the work holds about people and money — names, phone numbers, e-mail
addresses, payments, and the Windows account name on each entry — so it is as private as the work
folder itself.

**It is not verified on the way out.** Unlike the diary's own exports (ADR-032), the JSON is
written as the database holds it, chain or no chain; it carries every hash so that its reader can
check it.

**It is not a backup.** Nothing reads it back into the product: there is no import. A backup — one
file that restores the work exactly, files included — is the next section.

**Reports are files, not rows.** Nothing in either database records that a report or an export
was written, where, or when. The set of files written in a session, which **Open** may open, is
kept in the host's memory and forgotten when the application closes. The owner's snapshot (D4) is
one more such file: an HTML page rendered from the same report model, holding the work as it stood
when it was written, and nothing records that it was written or sent
([ADR-039](architecture/ADR.md#adr-039)).

## A backup — the `.ridgebeam` format (F11)

`backup_write` writes the whole work as one file, `<name>.ridgebeam` (ADR-033), and
`backup_restore` reads it back into a new folder. It is written and read by the host
(`src-tauri/src/files/backup.rs`, on the ZIP of `src-tauri/src/files/archive.rs`), and it is a
format this document fixes. **`ridgebeamBackup` is the version of the shape**; a build refuses a
later number, saying the backup was written by a newer version.

**The file is a plain ZIP** that Windows opens by itself: local headers with their sizes and CRC in
place, each entry **stored** or **deflated**, the central directory right after the last entry, the
end record with no comment — no ZIP64, no encryption, no extra field, no data descriptor, no
directory entry, lowercase ASCII names with `/`. At most 4 GiB (one byte under) and 65 535 entries.
Its entries, in this order and no other:

| Entry                       | Kept     | What it is                                                                                                                                                                                       |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.json`             | stored   | what the backup holds, below                                                                                                                                                                     |
| `work.sqlite3`              | deflated | a consistent snapshot of the work's database: `VACUUM INTO` on the open connection, every committed row with the write-ahead log folded in and no free page, set to WAL mode as a closed work is |
| `documents/<sha-256>.<ext>` | stored   | every file of the work's `documents/`, by name, as the folder holds it (a `.bmp` is deflated, the one kept format that is not already compressed)                                                |
| `thumbnails/<sha-256>.jpg`  | stored   | every thumbnail, by name                                                                                                                                                                         |
| `manifest.sha256`           | stored   | `<64 hex>  manifest.json` and a line feed — the SHA-256 of the manifest's bytes, in the form `sha256sum -c` reads                                                                                |

The manifest is pretty-printed UTF-8 JSON ending in a line feed, camelCase, and a field it does not
name is refused on the way back in:

```json
{
  "ridgebeamBackup": 1,
  "createdAt": "2026-09-28T17:05:30.000Z",
  "app": "Ridgebeam 0.1.0",
  "workId": "01920000-0000-7000-8000-000000000000",
  "workName": "Bathroom",
  "schemaVersion": 10,
  "files": [
    { "path": "work.sqlite3", "bytes": 245760, "sha256": "…" },
    { "path": "documents/….pdf", "bytes": 81234, "sha256": "…" }
  ]
}
```

| Field             | Meaning                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ridgebeamBackup` | the format's version, `1`                                                                                                                                                                                                      |
| `createdAt`       | when the backup was written, UTC with milliseconds and a trailing `Z`                                                                                                                                                          |
| `app`             | the build that wrote it, `Ridgebeam <version>`                                                                                                                                                                                 |
| `workId`          | the work's UUID — the restored database must hold the same                                                                                                                                                                     |
| `workName`        | the work's name when it was backed up, 1 to 120 characters — what the Restore dialog shows                                                                                                                                     |
| `schemaVersion`   | the work's schema version then; a restore refuses one newer than the build, and migrates an older one forward                                                                                                                  |
| `files`           | every file the archive holds between the manifest and its hash, **in the archive's order**, the database first: its path inside the archive (and inside the work folder), its size, and its SHA-256 as 64 lowercase hex digits |

**What it holds, and what it does not.** Everything in the work folder that the work owns — the
database, `documents/` and `thumbnails/` — and nothing else: no path from the machine, nothing of
the application's database. A file in `documents/` or `thumbnails/` whose name is not
`<sha-256>.<ext>` (something put there by hand) is left out, and `backup_write` names it. The
backup is **not encrypted**.

**Restoring it** writes the files into a temporary folder beside the target, checks each against
the manifest, opens the work there (migrating it forward if its schema is older), and renames the
folder into place — so the restored folder is the work folder above, and its `work.sqlite3` is,
byte for byte, the snapshot the archive held (unless a migration ran). What restore refuses, and
why, is in [`SECURITY.md`](../SECURITY.md).
