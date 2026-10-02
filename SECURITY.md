# Security

Ridgebeam holds the record of somebody's home and somebody's money — the plan of a build, the
diary of what happened on site day by day, the photos, the quotes, the payments and the people
— and it is public source. This document is the threat model. It was written in slice F0,
before the first work was created, and it is the contract every later slice is held to: a
change that touches one of these rules changes this file in the same pull request.

Where a rule is enforced by code that does not exist yet, this file says which slice makes it
true. Until that slice lands, the rule is a promise, and the README says so.

## What the product holds

A **work** is a folder on disk chosen by the person in a dialog. It contains one SQLite
database, the photos and documents copied into it, and their thumbnails. Nothing about a work
lives anywhere else: not in the registry, not in the cloud, not in a cache the person cannot
see. Moving the folder moves the work.

The database holds the plan (stages, activities, dependencies, calendar, rooms, people, money),
the **diary** (one entry per day per work, with photos, deliveries, incidents and who was on
site), the **baselines** (every approved version of the plan and the reason for each change),
the **payments ledger** and, from E2, the ledger of **money received**. The diary, the baselines
and the ledgers are the record; the plan — and the money the owner expects to receive — is
intent.

A **backup** (F11) is that whole folder in one `.ridgebeam` file, written wherever the person
saves it: the database, every document and thumbnail, and a manifest. It holds everything the
work holds, and **it is not encrypted** (below, _A backup is the whole work_).

## The threat model

| Asset                                                                                   | Threat                                                                                                                                                                                                                              | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Slice                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| The diary                                                                               | an entry silently edited, deleted or replaced; an entry slipped in out of order                                                                                                                                                     | four insert-only tables; triggers refuse `UPDATE`, `DELETE` and `REPLACE`; a guard refuses a sequence number that exists; the chain trigger refuses an entry that is not next or does not carry the previous hash; no edit command, a correction instead; a hash chain verified in Diagnostics and by the host before every diary export, which writes nothing when it does not hold                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **F4**, **F10**                         |
| The baselines                                                                           | a baseline overwritten, withdrawn or given rows it did not have; an approved plan changed with no reason                                                                                                                            | insert-only tables — `baseline`, `baseline_activity` and, from F8, `baseline_stage` — triggers refuse `UPDATE`, `DELETE` and `REPLACE`; rows only on the latest baseline; `approved_at` never changes; an approved plan refuses every change a baseline records (`plan_approved`) until a replanning is opened with a reason; every baseline after the first closes one and carries its reason; the replanning itself is written once                                                                                                                                                                                                                                                                                                                                                                                                                     | **F2**, **F8**                          |
| A stage's gate answers                                                                  | an answer silently changed or removed; a stage started or closed with an item unanswered or answered no                                                                                                                             | `check_answer` insert-only with the diary's battery — triggers refuse `UPDATE`, `DELETE` and `REPLACE`, a guard refuses a key that exists; answering again appends and the latest counts; _not applicable_ requires a reason; the gate is enforced by the domain and by the host (`stage_gate_open`); a closed stage refuses every change to its rows (`stage_closed`); no hash chain                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **F5**                                  |
| The payments ledger                                                                     | a payment silently edited or removed; a mistake hidden by rewriting it; money summed with rounding errors                                                                                                                           | `payment` insert-only with the same battery — triggers refuse `UPDATE`, `DELETE` and `REPLACE`, a guard refuses a key that exists, payments numbered in order; a mistake is a reversal — a negative payment naming the one it reverses, never larger, once only; a commitment locked once something is paid against it; amounts are integers in minor units; no hash chain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **F6**                                  |
| A commitment's payment plan                                                             | a plan rewritten after paying, so that money paid ahead of the work no longer shows; a milestone marked earned that the work never reached                                                                                          | milestones refused — added, changed, moved or removed — by the host and again by triggers once a payment names the commitment, a reversal included; a milestone is earned only by a fact the product already records — a gate passed, an activity finished in the diary — and no column, command or control sets it; shares are integer basis points and amounts integer cents                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **D2**                                  |
| Money received                                                                          | a receipt silently edited or removed; a mistake hidden by rewriting it; money recorded as received before it arrived, so a week looks covered that is not; a fund removed after money came in against it                            | `funding_receipt` insert-only with the payments' battery — triggers refuse `UPDATE`, `DELETE` and `REPLACE`, a guard refuses a key that exists, receipts numbered in order; a mistake is a reversal — the whole receipt, for its own fund, once only; a day after today refused by the host; a fund a receipt names cannot be removed; amounts are integers in minor units; no bank connection, nothing sent; no hash chain                                                                                                                                                                                                                                                                                                                                                                                                                               | **E2**                                  |
| The handover book                                                                       | a file from outside the work read into the PDF by a path or a crafted hash; a book so large it cannot be kept; a hidden-work check answered yes with no photo                                                                       | images named only by a 64-hex-digit hash and found only in the open work's `documents/`, a hash the work does not hold refused; at most 400 images and 150 MiB of image data, each decoded under the `image` crate's limits and scaled to 1 600 px; a check that needs a photo refuses a yes without one, in the host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **D3**                                  |
| The owner's snapshot                                                                    | a file meant to be forwarded that runs a script, loads a tracker or a remote image, or posts a form; a hostile name or note that escapes into markup; a photo that carries where it was taken; a contact or a document sent with it | one HTML file the host renders from the report model: every string escaped, a Content-Security-Policy `<meta>` (`default-src 'none'; img-src data:; style-src 'unsafe-inline'`), inline CSS only, and the bytes checked by the host before they are written, refusing the write on a missing or misplaced policy, a `src` that is not a JPEG `data:` address, `<script`, an `on…=` attribute, `javascript:`, an `http:`, `https:` or `//` address, `<iframe`, `<object`, `<embed`, `<link`, `<base`, `<form`, `@import`, `url(`, any other `data:`, or an element or attribute the page is not made of; photos by hash inside the open work, always re-encoded at 1 024 px with no metadata; at most 60 photos placed, 8 MiB of image data and 12 MiB in all; no phone number, e-mail address or document in it; sent by the person, never by the product | **D4**                                  |
| The plan's progress                                                                     | progress typed in that the site never did                                                                                                                                                                                           | there is no command, column or control that writes progress; progress is derived from diary entries only, in states                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **F0**, **F4**                          |
| Documents — photos, receipts, quotes, drawings, permits, contracts, warranties, manuals | a hostile file — a crafted image, a huge file, an executable or an archive in disguise, a script inside an SVG; a file swapped on disk behind the product's back                                                                    | typed by its magic bytes — JPEG, PNG, WebP, GIF, BMP and PDF only, everything else refused with a sentence; 25 MiB for every file; image dimensions capped from the header before decoding; thumbnails decoded under limits; a PDF never parsed or rendered; SVG refused; copied by the host and named by hash, deduplicated; shown as data URLs; opened by the operating system's handler from Rust, only on a click; the hostile corpus in `cargo test` with its committed manifest; every file re-hashed on demand in Diagnostics; orphans listed, never deleted                                                                                                                                                                                                                                                                                       | **F4**–**F7**                           |
| The person's privacy                                                                    | a network request that carries what the work holds                                                                                                                                                                                  | no network: no account, no telemetry, no crash reporting, no update check, no weather service                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **F0**                                  |
| The person's machine                                                                    | a command injected through a name, a path or a file; a file written or opened that the person did not choose                                                                                                                        | Tauri capabilities declared one by one; no shell, file-system, HTTP or asset-protocol permission; the opener used only from Rust, for a document the person clicked or a file a report command wrote in this session; every path the host writes is inside the work folder, but for a template exported to the `.json` path, and a report or an export to the `.pdf`, `.csv`, `.json` or `.html` path, the person chose in the save dialog — written whole or not at all, over an existing file only when the dialog asked                                                                                                                                                                                                                                                                                                                                | **F0**, **F4**, **F9**, **F10**, **D4** |
| Exports read by other tools                                                             | a spreadsheet formula injected through a diary text or a name                                                                                                                                                                       | the diary CSV is written by the host from the database; every cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is written with a `'` before it, in every column; RFC 4180 quoting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **F10**                                 |
| The exported record                                                                     | a diary exported from a chain that does not hold; an export that claims a verification nobody made; an export read as a signature or as legal proof                                                                                 | the host runs `diary_verify` before it writes either diary export and writes nothing when the chain does not hold, naming the entry; the host, not the interface, writes the PDF's first block — the day, the count and the head of the chain, and that this is tamper-evidence, not a signature and not legal proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **F10**                                 |
| Backups                                                                                 | a restore that brings back less than was saved, or something else; a crafted backup that writes outside its folder, inflates without end or overwrites a work; a backup read by somebody else                                       | one ZIP of the shape the host writes, read by its own reader: allow-listed names, the manifest's own hash first, every size capped while it inflates, every SHA-256 checked, the database opened read-only and checked; staged beside a new or empty folder and renamed only when whole; round-trip byte for byte in `cargo test`; not encrypted, and said so                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **F11**                                 |
| The public repository                                                                   | a real address, person, contractor, price or e-mail committed; a secret                                                                                                                                                             | fixtures are synthetic and say so; `.gitignore` refuses `.env`, keys and certificates; review refuses the rest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **F0**                                  |
| The template library                                                                    | a wrong or hostile template accepted into the library; a real brand, supplier, price, place or contact published as advice                                                                                                          | templates are JSON data with a closed list of fields and no code; the library test in CI validates every file at the strict level — both languages, ranges never points, no amounts, no text that looks like a web address, an e-mail address or a phone number, no cycle — and applies it to an empty work; a maintainer reviews every template before merge; the loader drops, and logs, a file that fails                                                                                                                                                                                                                                                                                                                                                                                                                                              | **F9**                                  |
| A template from a file                                                                  | a crafted template: huge, not JSON, not UTF-8, with fields the product does not know, a link cycle or an include cycle, text past every limit, or a plan written into a work that already has one                                   | `.json` only, 1 MiB, UTF-8, read by the host as text and never parsed there; parsed by the domain as JSON and validated field by field, every unknown field refused and every problem named; includes resolve only against the library; applied in one transaction, every row re-checked by the host with its own limits, only into an empty work that is not approved; nothing in a template is ever run                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **F9**                                  |

A slice in **bold** has shipped the control; the others are promises, held to by the slice named.

## No network

The product makes no network request of any kind. There is no account, no login, no sync, no
telemetry, no crash reporting, no update check, no weather service, no font or script loaded
from anywhere. The Tauri capabilities do not include HTTP. The product reads and writes the
work folder the person chose and nothing else; the About screen says so, and a reader of the
source can confirm it in `src-tauri/capabilities/`.

## Files are hostile

Every file the product keeps arrived from somebody else — a photo from a phone, a quote from a
contractor, a drawing from an architect, a receipt from a shop. The host treats each one as
hostile. **Shipped for every document in F7** (ADR-025), on the pipeline F4 built for photos
(ADR-021).

- **Typed by its bytes, from a short list.** The host reads the file itself — the webview never
  touches it — and decides its type from its first bytes, never from its name. **JPEG, PNG, WebP,
  GIF and BMP** are images; **PDF** (`%PDF-` at the start) is a document; **everything else is
  refused** with a sentence that names the file and says what the product keeps — a Word file, a
  spreadsheet, an archive, an executable, a HEIC photo. A `.pdf` whose bytes are a PNG is kept as
  the PNG it is; a `.pdf` whose bytes are an executable, or a zip, is refused. Diary and answer
  photos accept images only: a PDF is not a photo.
- **SVG is refused, and why.** An SVG is a document that can carry scripts and references to other
  files, and a product that shows it has to be sure none of them runs. 1.0 does not keep SVGs.
- **Measured before decoding.** Every file is refused over **25 MiB**. An image is refused if the
  dimensions read from its header, without decoding, exceed **12 000 × 12 000** pixels, or are
  zero. The product decodes an image in two places only, each through the `image` crate with its
  limits set (width, height, at most 256 MiB of allocation): the thumbnail — 320 px, JPEG — and,
  from D3, a photo printed in the handover book (below, _Reports and exports_). A photo whose
  thumbnail fails is kept, marked, and says so.
- **A PDF is never parsed and never rendered.** The product reads its first bytes, its size and
  its hash, and nothing else. On screen it is a mark and a name; it opens in the operating
  system's own viewer, from Rust, on the person's click. No PDF reader is compiled into the
  product: `pdf-writer` (F10) writes the product's own reports and cannot read a file, and
  `lopdf`, which reads those reports back in the tests, is a development dependency and never
  shipped.
- **Copied, named by hash, never linked.** An accepted file is hashed (SHA-256) and copied to
  `documents/<hash>.<ext>` inside the work folder, the extension from its type. The original
  location is not kept. A file already there is linked again, never copied twice.
- **Removed only when nothing names it.** Removing a document removes its row and its links; the
  file is deleted only when no other document, diary photo, answer photo, receipt or commitment
  names its hash. The diary's rows are never touched.
- **One file, one transaction** for documents: a batch of ten with one refused keeps the nine and
  names the one. A diary entry is still refused whole with any photo it carries (ADR-019).
- **Never executed, never read by the webview.** Thumbnails reach the screen as
  `data:image/jpeg` URLs returned by a command; the capabilities hold no asset protocol and no
  file-system permission.
- **The bytes are verified.** Diagnostics' _Folder health_ reads every file in `documents/` and
  compares it with the hash its row records (`documents_verify`), lists rows whose file is
  missing, and lists files that no row names — **orphans, listed and never deleted by the
  product**, which says so. The diary's chain vouches for the rows, including each photo's hash;
  this is what checks that the file on disk is still that photo.
- **The corpus is committed as a manifest.** `cargo test` generates the hostile files — a text
  file named `.jpg`, a PNG whose header claims 100 000 pixels, a truncated JPEG, an empty file, a
  26 MiB image, a 26 MiB PDF, an executable named `.pdf`, a zero-width PNG, a WebP with a lying
  size, a HEIC, an SVG, a zip bomb named `.pdf` — and asserts that each is refused with a
  sentence and that nothing is written; a thirteenth, a PNG named `.pdf`, is kept as the PNG it is. The files themselves are never committed; their SHA-256
  manifest is, in `fixtures/hostile/MANIFEST.json`, and a test fails when the generator drifts
  from it. Rewriting the manifest is a deliberate act: an ignored _bless_ test does it, and the
  change is reviewed like any other.
- **A dropped file is a chosen file** (U1, ADR-040). Files dragged from Explorer onto the window
  reach the interface as paths, through the webview's own drag-and-drop event — as the dialog's
  paths do — and go through **exactly the same intake**: the same commands, typed by their bytes,
  measured, copied by hash, refused with the same sentences. The interface first keeps only the
  names that screen's dialog would offer — photo extensions on the Diary, photos and PDFs on
  Documents — and leaves every other name out, saying so; that filter is a convenience, as the
  dialog's is, never the control. The interface has no file-system access and cannot tell a folder
  from a file: a folder whose name ends like a photo's reaches the host, which refuses it by name,
  and a `.jpg` whose bytes are an executable is refused by the host as one chosen would be. A diary
  photo dropped reaches the host only when the entry is saved, like a chosen one. Nothing new
  reaches the host: no command, no capability and no file-system permission was added, and the
  webview still cannot read a path.

## The diary and the baselines are append-only

This is requirement one of the specification, and it is enforced in two places on purpose.
**Shipped: the baselines in F2 (ADR-016) and their stages in F8 (ADR-028), the diary in F4
(ADR-019).**

- **In the schema.** The diary is four tables — `diary_entry`, `diary_done`, `diary_present`
  and `diary_photo` — and the baselines three, `baseline`, `baseline_activity` and
  `baseline_stage`. On each, triggers refuse `UPDATE` and `DELETE`. `INSERT OR REPLACE` removes
  the row it replaces without firing a delete trigger when `recursive_triggers` is off, so each
  table also has a guard before insert that refuses a key that already exists; the product opens
  every file with `recursive_triggers` on as well. A done line, a person present or a photo may be added only to
  the latest entry — the one being written — so a past entry cannot gain a line it did not have
  when its hash was computed; rows are added only to the latest baseline for the same reason. A
  further trigger refuses a diary entry whose sequence number is not the next one, or whose
  `prev_hash` is not the hash of the entry before it: the chain cannot fork, skip or start again.
  Every one of these raises `diary: append-only` or `baseline: append-only`, so that no code
  path — not the product's, not a script's through the database — can edit, remove or reorder a
  row.
- **In the host.** No Tauri command edits or deletes an entry or a baseline. The Rust module that
  writes the diary contains no `UPDATE`, `DELETE` or `REPLACE`, and a test reads its source to
  prove it; the same rule holds for baselines, `baseline_stage` included, and a second test
  reads the modules that write the plan and the replanning and fails if one writes a baseline
  table. An entry dated in the future is refused by the domain against today and by the host
  against its own clock.
- **A correction is a new entry.** It names the entry it corrects, restates the day, and says
  what was wrong. The interface offers _Correct…_ where an edit would be expected, and says why;
  the day view shows the original struck through beside its correction. A change to an approved
  plan is a new baseline with its reason (F8), never an edit of the last one.
- **A chain.** Each entry carries the SHA-256 hash of the entry before it — the empty string for
  the first — and its own hash over a canonical form of the entry and its children: every field,
  every done line, every person present and every photo, with `NULL` distinguishable from the
  empty text, versioned and written out in full in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). The host
  refuses control characters in every text of an entry, so no value can forge a separator.
  `diary_verify` recomputes every hash and every link and answers "N entries, chain intact" or
  "broken at #k" with the reason; Diagnostics runs it on demand, and both diary exports run it
  before they write (F10, below). `cargo test` tampers with a work file through a second, plain
  connection — the triggers dropped, a note rewritten, a photo's hash changed, a row deleted —
  and shows the verification fails at that entry. The chain covers each photo's hash, not the
  file on disk; _Folder health_ re-hashes the files themselves (F7, _Files are hostile_).
- **The author is the account's name.** The host writes the display name of the Windows account
  that is running it on each entry. It is what the machine says, not an identity the product
  checks: the product has no accounts.

**A stage's gate answers are append-only too, and not chained** (F5, ADR-022). `check_answer`
carries the same triggers and guard as the diary's tables and raises `checks: append-only`; the
host holds no statement that would reach them. Answering again appends a row and the latest one
counts, so the history of a gate — who answered what, and when — is never rewritten. There is no
hash chain over answers: a gate's history is short and local to one check, and the chain is the
diary's. A photo on an answer goes through exactly the pipeline in _Files are hostile_.

**A check that needs a photo refuses a yes without one** (D3, ADR-038). A check marked
`needs_photo` is the gate's question about work that is about to be hidden — pipes and wiring
before a wall is closed, waterproofing before it is tiled. The host refuses a `yes` on it that
carries no photo, with _"This check needs a photo of the work before it is closed."_; `no` and _not
applicable_ with its reason are accepted as they always were. What this proves is limited, and
said so: the product checks that a photo is attached, not what it shows or when it was taken — a
photo taken after the wall was closed passes. An answer recorded before migration 012 that says
yes with no photo stays as it was, append-only; the handover book lists it among what it lacks.

**An approved plan changes only after somebody says why** (F8, ADR-027). Once the plan is
approved, the host refuses every command that changes what a baseline records — the stages, the
activities' names, durations and order, the dependencies, the calendar, the start date, the cost
lines — with `plan_approved`, unless a **replanning** is open. A replanning is opened with a
reason that is not blank, and closed only by taking the next baseline, which copies the reason
and is insert-only like every baseline. There is no abandon: an edit already in the file ends in
a baseline that records it. Facts are never locked — the diary, answers, payments and the rest
are the record, and refusing them would push them out of it. **An activity's range is not in the
list either** (D1, ADR-035): a baseline does not record it, so an approved plan takes a new
optimistic or pessimistic duration with no reason asked, and the finish's chance moves with it —
never the plan's dates, the slip or a baseline. The chance is computed and never stored, so there
is nothing of it to tamper with in the file; a range changed after approval is not recorded
anywhere either, which is the cost ADR-035 names.

**The replanning is written once, and not a requirement-one table.** Its `closed_at` and
`baseline_number` are written into the row by the transaction that takes the baseline closing
it, so the table cannot refuse every `UPDATE` as the baselines do. Triggers hold the rest, each
with `replanning: written once`: no removal, no replacement, and no change but that one closing —
the reason, the author and the moment it was opened never move, and a closed replanning never
reopens. It is not in requirement one because it is not the record: it is the lock's state, and
the reason it carries is copied into the baseline, which is. At most one is open, by a unique
index over the open rows. The same caveat as every table here holds: somebody who owns the file
can drop the triggers.

**The payments ledger is append-only, with reversals, and not chained** (F6, ADR-023). `payment`
carries the same triggers and guard as the diary's tables and raises `money: append-only`. A
payment is never edited or removed; a mistake is corrected by a **reversal** — a new payment
with a negative amount that names the payment it reverses, with a note — and the schema refuses — with
`money: reversal` — a negative amount that reverses nothing, a reversal of a reversal, a reversal
larger than its payment or for another stage, person or commitment than it, and a second
reversal of the same one. A stage, a person or a commitment that a payment names cannot be
removed: nothing that was paid disappears. Amounts are whole numbers of minor units, so no total drifts by rounding. A
receipt goes through the pipeline in _Files are hostile_ — an image or, from F7, a PDF.

**A commitment's payment plan locks when money moves** (D2, ADR-037). A milestone says which fact of
the work earns a share of a commitment — the advance, the stage started, an activity finished, the
stage closed — and the product compares what was earned with what was paid. That comparison is only
worth something if the plan it compares against is the one that was agreed before paying. So from
the first payment that names a commitment — and a reversal names it too — the host refuses every
command that adds, changes, moves or removes its milestones, with `invalid_input` and a sentence,
exactly as it refuses a change to the commitment itself (F6) — and the schema refuses them again,
with `money: payment plan locked`, from triggers on `payment_milestone` for insert, update and
delete, so a file written by something else holds the same rule. Without the lock, a plan could be
rewritten after the fact to earn what had already been paid, and being ahead of the work would
disappear from every screen and report. A renegotiation is a new commitment, and the old one keeps
its record. The lock is not the approved plan's (ADR-027) — no replanning opens it — and a closed
stage does not add one: money is not a plan edit. **Earned is never stored**: it is read from the
gates and the diary every time, so there is no column to set and no command that marks a milestone
earned; the diary's chain and the gates' append-only answers are what protect it. **The warning is
not a control**: a payment that puts the owner ahead of the work is recorded when the person saves
it, and the product says so before, not after — it never refuses money that was paid. The same
caveat as every table here holds: somebody who owns the file can drop the triggers, and the payment
plan carries no chain.

**Change orders are insert-only, and their effects are data the host validates** (E1, ADR-041). A
change to an approved plan is raised once and decided once: `change_order` and
`change_order_decision` carry the same triggers and guard as the diary's tables, so a change is
never edited or removed and a decision never rewritten; a mistake is withdrawn and raised again, and
the record keeps both. The module that writes them holds no `UPDATE`, `DELETE` or `REPLACE`, and a
test reads its source to prove it; the triggers are attacked in `cargo test` with
`recursive_triggers` on and off. A change's **effects** arrive from the interface as JSON, and they
are data, never a statement: the host parses them into a closed list of three kinds — add an
activity, change a duration, remove an activity — and refuses, with a sentence, anything else — a
kind it does not know, a name outside 1–200 characters, a duration outside 1–3 650 working days or
outside the activity's range, more than 50 effects, an activity or a stage the work does not have, a
closed stage, an activity named twice, or the removal of an activity a payment milestone is earned
by. **No SQL comes from the interface**: every id is bound as a parameter, a name is stored as text
and rendered by React as text, and an approval applies the effects only through the functions the
plan's own commands use, in one transaction that writes all of it or none of it. **The host never
computes a schedule**, so the impact a decision freezes — the finish before and after and the
working days between them — is the figure the interface's domain computed and sent: the host checks
its shape and stores it as the fact of that day, and does not compute it again. A webview that lied
would write a wrong figure into a record that says it is what the schedule said; that is the same
trust the product already gives the interface for every placement of a baseline (F2), and it is why
the figure is frozen beside the effects that produced it, which anybody can schedule again. **"Who
asked" is a record, not a signature**: the product has no accounts, nobody asked signs anything, and
the author is the name the Windows account gives. A change raised before the plan is approved, a
second decision on the same change, and a decision that names a change the work does not have or
carries another price than the change's are refused by the host with a sentence and again by the
schema, with `change order: plan not approved`, `change order: append-only` and `change order:
decision`. The same caveat as every table here holds: somebody who owns the file can drop the
triggers, and change orders carry no chain.

**Money received is a ledger like the payments, and it is not connected to anything** (E2,
ADR-042). The owner writes down the money the work expects — a fund, which is plan and changes
freely — and records each sum on the day it actually arrives, as a **receipt**. `funding_receipt`
carries the same triggers and guard as the payments and raises `funding: append-only`: a receipt is
never edited or removed, and the module that writes it holds no `UPDATE`, `DELETE` or `REPLACE`,
which a test reads its source to prove. A mistake is a **reversal** — a negative receipt naming the
one it reverses — and the schema refuses, with `funding: reversal`, a reversal of nothing, of a
reversal, of part of a receipt, for another fund, dated before the receipt, or made twice. A fund
that money was received against cannot be removed: the host refuses with a sentence and the foreign
key refuses again, so nothing that arrived disappears with the plan for it. **A receipt's day is
never in the future**: money recorded before it arrives would make a week look covered that is
not, which is the one lie this projection exists to catch. The host checks the day against its own
clock and refuses with a sentence; the schema cannot, because it has no clock it can trust, so a
file written by something else can carry a receipt dated ahead — the same caveat as every table
here. **Money in is recorded, not connected**: there is no bank connection, no Open Finance, no
statement imported and no account number asked for; a receipt is an amount, a day and a note the
person typed, and nothing about it — or about the projection read from it — leaves the machine
(_No network_). Whether the money lasts is computed by the domain every time and never stored, so
there is no balance to tamper with: it is read from the two ledgers and the plan. The same caveat
as every table here holds: somebody who owns the file can drop the triggers, and the receipts carry
no chain.

**What the chain cannot see.** An entry removed from the _end_ of the diary leaves no successor
pointing at it, so what remains still verifies. The diary export records the count and the head
of the chain (F10), so that an export or a backup kept elsewhere can show the loss; nothing kept
only inside the work folder can.

**What the chain is, stated plainly.** It is tamper-evidence: it shows whether the record has
been altered since it was written. It is **not** a signature, it does not prove who wrote an
entry, and it is **not** legal proof. What a diary is worth in a dispute is the jurisdiction's
to decide, not the product's. The product says this in Diagnostics, in the export header, and
here, and never claims more.

## The plan has no progress command

Nobody types "60 % done" into a stage. There is no command, column or control that sets
progress (F0, ADR-009); progress is derived from diary entries (F4, ADR-020) — _not started_,
_started_ or _finished_, and a share only where the diary recorded quantities against a planned
one. This is a security rule as much as a product rule: a plan that can be rewritten with no
trace, or a diary whose entries can be edited after the fact, is a notes app.

## Templates are hostile input, and the library is reviewed data

A template is a plan's shape as data (ADR-029). One from the library was written by a contributor
and reviewed; one from a file came from anybody. Both are treated as hostile until the domain has
validated them, and neither can do anything but describe rows. **Shipped in F9.**

- **Read as text, under caps, by the host.** `template_read` takes a full path the person chose in
  the open dialog and refuses, with a sentence naming the file, anything that is not a `.json`
  file, is empty, is larger than **1 MiB** — measured before it is read, and never read past the
  cap — or is not UTF-8. A byte-order mark is dropped. The host never parses a template: there is
  nothing in one that it acts on.
- **Parsed as JSON, validated as data.** The domain parses the text with the JSON parser and
  nothing else, and validates it with origin `file` (`validateTemplate`): a closed list of fields
  at every level, **any other field refused** — a template has nowhere to put code, a script or
  a formula, and nothing in one is ever evaluated; kebab-case keys of at most 64 characters, unique
  in their scope; every text 1–120 characters (a check 200, the summary 400) in one of the product's
  two languages; every number a whole number in its range (durations 1–3 650 working days, lead
  times and lags 0–3 650, amounts from 0 to the host's ceiling); rooms, activities and link
  endpoints that resolve; **includes that name library templates only** — a file cannot reach
  another file, a path or an address — never itself and never a cycle; and links that close no
  loop once stage endpoints are expanded. Every problem is returned with its path and a sentence,
  and a template with any problem is not applied.
- **Applied once, whole or not at all.** The host's `plan_apply` checks every row of the draft
  again with the same limits as the command that adds one of its kind, refuses a key that does
  not resolve and a cycle, and writes the plan in one transaction **only into a work with no stage
  that is not approved** — a template can start a plan, never change one, and never touch the
  diary, the baselines, the ledger or a document. When `work_create` carries a plan and the plan
  is refused, the empty folder the call created is removed and nothing is left in the recent list.
- **Shown as text.** Every name a template brings is rendered by React as text, never as markup.
- **The library is reviewed data.** The files in `templates/` are bundled into the application at
  build time. The library test (`src/domain/templates/library.test.ts`, in CI) validates each one
  at the strict level — both languages everywhere, a summary, every duration and lead time a range
  with `min < max`, no `amountCents`, and no text that looks like a web address, an e-mail address
  or a phone number — checks that its id is its file name, and applies it to an empty work. The
  loader validates them again when the application starts and drops, and logs, any file that fails,
  so a broken file can never be offered. The text checks are a heuristic; a brand, a supplier, a
  real place or a figure that reads as a rule to follow blindly is what **a maintainer's review**
  catches ([`CONTRIBUTING.md`](CONTRIBUTING.md)).
- **An export carries the plan's shape and none of its people.** `template_write` writes `.json`
  only, 1 MiB at most, to a temporary file in the same folder, flushed and renamed over the name, so
  a file is whole or absent; an existing file is replaced only when the person chose it in the save
  dialog, which asked. The export (ADR-030) never carries a person, a phone number or an e-mail
  address, a payment, a commitment, a diary entry, a document or a path from the machine — and,
  stripped, no number of the site's either.

## Reports and exports

Every file the product writes for somebody else to read is written by the host, to the path the
person chose in the save dialog, and to nothing else. **Shipped in F10** (ADR-031, ADR-032), but
for the backup, which is F11's.

- **One write path.** `report_pdf_write`, `report_html_write` (D4), `diary_export_pdf`,
  `diary_export_csv` and `work_export_json` take an absolute path ending in `.pdf`, `.html`, `.csv`
  or `.json` by kind and refuse any other; write a temporary file in the same folder, flush it and rename it over the name, so a
  file is whole or absent; and replace an existing file only with `overwrite`, which the interface
  sends only for a path the save dialog chose after asking. No file is written over 256 MiB. A
  report document is checked whole before it is laid out — 5 000 blocks, 20 000 rows (tables,
  figures and Gantt bars together), 16 columns to a table, 2 000 characters in any string — and one
  past a cap is refused with a sentence before anything is written.
- **The diary export verifies the chain when it is written.** Both diary exports verify the chain
  inside the host first — the check `diary_verify` makes, over the very rows they are about to
  write, while the work is held; a chain that does not hold writes **nothing** — no
  temporary file left behind, no file replaced — and the refusal names the entry where it broke.
  The PDF's first block is written by the host, not composed by the interface, so the interface
  cannot claim a verification that did not happen. In English it reads:

  > Chain verified on {date}: {N} entries, head {the first 16 hex digits of the last entry's
  > hash}. This is tamper-evidence: it shows whether the file was changed outside Ridgebeam. It
  > is not a signature and not legal proof.

  and in Portuguese, _"Cadeia verificada em {data}: {N} entradas, impressão digital da última
  {hash}. Isto é evidência de adulteração: mostra se o arquivo foi alterado fora do Ridgebeam. Não
  é uma assinatura e não é prova legal."_ These sentences live in the host, for this block only;
  the date is the moment the interface gives as the report's. A diary document sent to the plain
  report command is refused, so the diary is never printed without this block. It says what the
  chain is and what it is not in the one place a person reading the record away from the product
  will see it (SPEC R6). The count and the head let a copy kept elsewhere show entries removed from the
  end of the diary, which the chain alone cannot.

- **A CSV never carries a formula.** The diary CSV is written by the host from the database —
  never from anything the interface sends — with RFC 4180 quoting, UTF-8 with a byte-order mark,
  and `,` or `;` as the separator. **Every cell whose first character is `=`, `+`, `-`, `@`, a tab
  (U+0009) or a carriage return (U+000D) is written with a `'` before it**, in every column — names,
  notes, what was done, who was present — so a spreadsheet reads it as text and never as a formula
  (OWASP, CSV injection). `cargo test` holds each of the six characters in a name and in a note,
  and a cell that starts with anything else written untouched.
- **A PDF is written, never read.** The host lays out the interface's document itself — text,
  lines and rectangles in the standard Helvetica faces, no font embedded, no script, no link, no
  form, no attachment, and no image but the handover book's photos (below) — and the file's
  metadata names the title and "Ridgebeam {version}" as its producer, and **no author and no
  e-mail address**. A second reader parses every kind of report in `cargo test`.
- **An image in a report is named by its hash, and found only inside the open work** (D3,
  ADR-038). The handover book prints photos; the interface names each one by its SHA-256 and
  nothing else — never a path. The host (`src-tauri/src/report/images.rs`) accepts a hash only as 64
  lowercase hexadecimal digits, so a value shaped like a path is refused before any file is looked
  for; accepts it only when a `document` row of the open work names it, and only for an image; reads
  the original from that work's `documents/` folder and nowhere else; and **refuses a hash the work
  does not hold** with a sentence, rather than skipping it. So the report command cannot be used to
  read a file from anywhere else on the machine into a PDF. The original is read under the
  documents' caps — 25 MiB, measured before it is read and again while it is, and 12 000 × 12 000
  pixels from its header — and its bytes must still hash to the name, so a file changed outside
  Ridgebeam is refused, as _Folder health_ would list it. It is decoded with the `image` crate's
  limits (the side cap and at most 256 MiB of allocation), scaled to at most 1 600 pixels on its
  long edge and embedded as JPEG; a JPEG already within those bounds — 8 bits, grey or colour, not
  turned by its camera, at most 4 MiB — is embedded as it is, byte for byte. A PDF among the
  documents is listed by name and never embedded: an image block naming one is refused, and the
  product still never parses a PDF. **One document holds at most 400 images and 150 MiB of image
  data**, each distinct photo counted once, and one past either is refused with a sentence before
  anything is written. The second reader checks the embedded images in `cargo test`.
- **The handover book is as private as the work folder.** It prints people's phone numbers and
  e-mail addresses, and the photos themselves. **No photo's metadata reaches the book**: a JPEG
  embedded as it is has its EXIF (GPS included), XMP, colour profiles and comments stripped from the
  marker stream, keeping only the segments decoding needs; a re-encoded image is written with none;
  `cargo test` proves both with a synthetic photo carrying a GPS tag. The original in the work folder
  keeps everything. Sending the book to anybody is the person's act.
- **The owner's snapshot runs nothing and loads nothing** (D4, ADR-039). It is the one file the
  product writes in order to be sent — opened on somebody else's phone, in whatever browser it has,
  and forwarded from there to people the person may never have meant to reach. So it is held by
  three defences, each tested on its own:
  - **Escaping.** The host renders the snapshot to HTML from the report model
    (`src-tauri/src/report/html.rs`) and passes every string the model carries — the title and
    subtitle, headings, paragraphs, figure labels, values and rows, table cells, Gantt labels and
    day labels, photo captions — through one escape, in text and in attribute values alike. It
    writes `&`, `<`, `>`, `"` and `'`, and also `/`, `:`, `=`, `@`, `(` and `` ` ``, as character
    references, which read the same on the page, and drops control characters. So a hostile string
    can neither become markup nor spell an address, a handler or a CSS import: whatever the
    verifier below finds is the renderer's own bug. `cargo test` puts `<`, `&`, quotes,
    `</script>`, `" onmouseover="` and `javascript:` into every string field of every kind of block
    and finds none of them as markup.
  - **The policy.** The file carries, in a `<meta http-equiv="Content-Security-Policy">` element
    placed before anything it governs, exactly
    `default-src 'none'; img-src data:; style-src 'unsafe-inline'`: a browser that honours it runs
    no script, loads no image, font, style sheet or frame from anywhere, and shows only the images
    inside the file. Its style is one inline `<style>`, in the system's own fonts. Its head declares
    the language (`lang="en"` or `lang="pt-BR"`), `charset="utf-8"`, a viewport, `color-scheme`,
    `referrer` set to `no-referrer`, the generator (Ridgebeam) and the moment it was written.
  - **The verifier.** Before the bytes are written, the host checks them and **refuses the write**
    — said as a bug in Ridgebeam, not in the work — unless all of these hold:
    1. the exact policy `<meta>` is there once, before the `<style>`, the `<body>`, every `<img>`
       and every `<svg>`;
    2. every `src` is `data:image/jpeg;base64,` followed by base64 and nothing else; those
       photos, and the policy, are then set aside;
    3. what remains contains, in any case, none of `<script`, `javascript:`, `vbscript:`, `http:`,
       `https:`, `//`, `<iframe`, `<object`, `<embed`, `<link`, `<base`, `<form`, `@import`,
       `url(`, `expression(`, `data:` or `<!--`, and no event-handler attribute — `on` not preceded
       by a letter or a digit, then letters, then `=`;
    4. it begins `<!DOCTYPE html>` and is made only of the page's own elements — the document's
       head and body, headings, paragraphs, `details` and `summary`, lists, tables, `figure`,
       `img`, and the SVG's `svg`, `g`, `line`, `rect`, `text` and `title` — carrying only the
       attributes they use, each value in double quotes, with no `>` outside a tag and no markup
       inside the style.

    `cargo test` injects each forbidden pattern into a rendered page and proves it refused, and,
    through a hook between rendering and verifying in the write command itself, proves a page that
    fails is refused as a bug with nothing written.

- **A photo in the snapshot is always re-encoded.** It is named by its hash and found inside the
  open work exactly as the handover book's (above): only a hash a `document` row names, only an
  image, read under the documents' caps and checked against its hash. It is then **decoded and
  re-encoded every time** — at most 1 024 pixels on the long edge, JPEG at quality 78, never passed
  through as it is — so no EXIF, GPS, XMP, colour profile or comment from the original reaches the
  file; `cargo test` finds no APP1 (EXIF, XMP), APP2 (colour profile), APP13 or comment segment
  in an embedded image. It goes in as a `data:image/jpeg;base64,` URL, the only kind of URL the
  file has. **One snapshot places at most 60
  photos and 8 MiB of image data, and the file is at most 12 MiB**; a photo placed twice is embedded
  and counted twice, since a page cannot reuse one without a script. One past a cap is refused with
  a sentence and nothing is written; the count is checked before any photo is read.
- **The snapshot carries no contact and no document.** It is the work's state, which the person
  chooses to share: people's names and trades, the diary's last notes as they were typed, photos
  with their file names as captions, the money's lines — cost lines, commitments and payments with
  their amounts and days — and the work's place. It carries **no phone number, no e-mail address,
  not the Windows account that wrote an entry, no document** (a PDF, a quote, a receipt), no
  baseline and no diary chain. Contacts belong in the handover book, which is kept, not forwarded.
  The snapshot is not encrypted, has no password and does not expire.
- **Open is for the file just written.** `report_open` hands a file to the operating system's own
  viewer only when a report command wrote that exact path **in this session** — the host keeps
  the set in memory and refuses every other path, so the command cannot be used to open anything
  else on the machine. After a restart the set is empty.
- **The work as JSON** (`"ridgebeamWork": 1`, [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)) carries
  no path from the person's machine: documents are named by their hash and their original file
  name, and not embedded. It carries everything else the work holds — people with their phone
  numbers and e-mail addresses, the payments, the Windows account name on each entry — so it is
  as private as the work folder. It is written as the database holds it and **not verified** on
  the way out: it carries every entry's hash and the one before, so its reader can verify the chain
  with the canonical form in the data model.
- **Nothing leaves the machine.** Writing a report or an export makes no network request; the
  file goes where the person put it and nowhere else. Sending it to anybody is the person's act,
  outside the product — the owner's snapshot included, which exists to be sent and is still never
  sent by Ridgebeam.
- **A template export** is written whole or not at all, `.json` only, and carries no person,
  contact, payment, diary entry or document (ADR-030).
- **A backup** is written through the same path, and read back as hostile input: the next
  section.

## A backup is the whole work, and comes back as hostile input

**Shipped in F11** (ADR-033). The format is in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

**What a backup holds.** Everything in the work, as it is: the plan, the diary with every entry's
author (the Windows account name), the baselines and their reasons, the payments, the people with
their phone numbers and e-mail addresses, every photo, receipt, quote, drawing and contract, and
their thumbnails. **It is not encrypted** — it is a ZIP, and anybody who has the file can open it
with Windows and read all of that. Keep it as carefully as the work folder: on a disk or in a place
only you can reach. Settings says so beside **Back up this work**, the glossary says so, and the
product does not pretend otherwise. It holds **no path** from the machine and nothing of the
application's own database — no settings, no recent list.

**Writing one.** `backup_write` takes a full path ending in `.ridgebeam`, written whole or not at
all through `files::save` — a temporary file beside it, flushed and renamed — replacing an existing
file only with `overwrite`, which the interface sends only when the save dialog chose that path.
A path inside the work's own folder is refused: a backup there would be lost with the work. The
database is a snapshot taken with `VACUUM INTO` on the open connection, so the free pages of the
live file, where the bytes of a deleted row may linger, are not copied into a file a person hands
on. A file in `documents/` or `thumbnails/` whose name the allow-list below does not take is left
out, and the answer names it. A file that changes while it is read refuses the backup.

**Restoring one.** The file is hostile: it may have been cut short in a copy, changed by another
program, or built to attack the machine that opens it. `backup_inspect` (the Restore dialog's
preview) and `backup_restore` check all of this, and refuse with a sentence that names the file
and the first thing that does not hold:

- **The shape the host writes, and no other.** A ZIP read by the product's own reader
  (`src-tauri/src/files/archive.rs`), not a general library: at most **4 GiB** (one byte under,
  what the plain format's offsets reach), at most **65 535** entries, the end record in the last
  22 bytes with no comment, a central directory of at most **16 MiB** ending exactly where the end
  record begins; each entry stored or deflated only — no encryption, no data descriptor, no extra
  field, no comment, no ZIP64 — with a name of 1 to 255 bytes; every local header repeating its
  directory record exactly; and the entries lying one after another with no gap and no overlap, so
  no two names share bytes and nothing is hidden between them.
- **Names from a closed allow-list**, lowercase, none twice, no directory entry:

  | Name                                                                                               | Cap    |
  | -------------------------------------------------------------------------------------------------- | ------ |
  | `manifest.json` — the first entry                                                                  | 16 MiB |
  | `work.sqlite3`                                                                                     | 2 GiB  |
  | `documents/<64 hex>.<ext>`, the extension one of `jpg`, `jpeg`, `png`, `gif`, `webp`, `bmp`, `pdf` | 25 MiB |
  | `thumbnails/<64 hex>.jpg`                                                                          | 25 MiB |
  | `manifest.sha256` — the last entry                                                                 | 256 B  |

  A name with `..`, a full path (`/` or `\` first) or a drive letter is refused, each with its own
  sentence; so is any other name. A hostile name is shown in the sentence with its control
  characters replaced and cut at 80 characters.

- **The manifest's own hash first.** `manifest.sha256` must be exactly the SHA-256 of
  `manifest.json` in the form `sha256sum -c` reads; only then is the manifest parsed — a closed
  shape, an unknown field refused, the format's version `1` (a later one: "written by a newer
  version of Ridgebeam"), a work id of 36 characters, a name of 1 to 120.
- **The archive holds exactly what the manifest lists**, in its order, the database once; every
  entry's declared size equal to the manifest's and under its cap.
- **Sizes are enforced while inflating, never trusted from a header.** A size over its cap is
  refused before a byte is inflated; inflating stops one byte past the declared size, so a size
  that lies, or a zip bomb, is found without ever holding what it hid; the CRC is checked at the
  end, and then **every file's SHA-256 against the manifest**.
- **The database is checked before it is used.** Its first 16 bytes are SQLite's; it is opened
  **read-only and immutable** — no lock, no journal, exactly the bytes on disk — and must pass
  `PRAGMA quick_check`, have the tables of a work, hold the work id the manifest names, and be at a
  schema this build knows and the manifest records. A database of another product, of another
  work, or from a newer build is refused.
- **Staged, then renamed; never over anything.** The target is a folder that does not exist yet or
  is empty; one that holds anything is refused. Every file is written with `create_new` into a
  temporary folder beside it (`.<name>.<id>.restoring`), the work opened there — an older schema
  migrating forward, as any old work does — and the folder renamed into place only when all of
  that has passed. On any refusal, every file and folder the restore made is removed, one by one —
  never a recursive delete — and nothing is left.
- **Then verified.** The restored work is opened, its chain verified and every document
  re-hashed, and the answer says how many entries and documents, and whether each held.

`cargo test` round-trips a full work byte for byte and row for row, reads what the host wrote with
Windows' own `tar.exe`, and generates a corpus of thirty-two hostile archives — in the test, each
derived from a backup written moments before and committed nowhere, so there is no manifest of
their hashes as F7's corpus has — among them a name that climbs out with
`..`, a full path, a drive letter, a name not on the list, a duplicate entry, a size that lies, a
zip bomb, a wrong SHA-256, a changed manifest, no manifest, a database of another product, a
database of another work, a schema newer than the build, an archive cut short — each refused with a
sentence and nothing written.

## Public repository hygiene

Nothing in this repository is a real address, a real person, a real contractor, a real price or
a personal e-mail. Fixtures are synthetic and say so in their name or their header. The
template library carries duration **ranges** and cost **lines** with no amount, never quotes,
and the library test refuses a price, a point, and text that looks like a web address, an e-mail
address or a phone number. No `.env`, no
key, no certificate, no secret, ever; `.gitignore` refuses the obvious ones and a reviewer
refuses the rest. `CONTRIBUTING.md` says how a template enters the library and the schema test
says whether it may.

## Minimum capabilities

Tauri capabilities are declared one by one in `src-tauri/capabilities/`. The shell plugin is not
used. There is no file-system permission, no HTTP permission and no asset protocol: the webview
cannot read a path. The dialog plugin returns a path the person chose — a work folder, a document to
attach, the new place of a moved work, a template to read, where to save one, where to save a
report, an export or a backup, a backup to restore and the folder to restore it into — and only the
host's own commands read or write there. A file dropped on the window gives the interface its path
the same way, through the webview's drag-and-drop event under the event permission the window
already had, and goes to the same commands as a chosen one (above, _Files are hostile_). The opener
is a Rust dependency with no JavaScript permission: the host opens a document with the operating
system's handler when the person clicks it, and a report or an export it wrote in this session when
the person presses **Open** — and nothing else. The window is a single window with no remote
content.

## Out of the threat model, stated plainly

An attacker with write access to the person's account can edit the database file with any SQLite
tool, and the triggers do not stop them — they can be dropped by whoever owns the file. The chain
would show an alteration of the diary; it would not prevent it — and somebody who rewrites every
entry and recomputes every hash leaves a chain that verifies. The database is **not encrypted at
rest**; the folder's access control is the operating system's. A person who needs the record
protected from somebody with their password needs full-disk encryption and a backup kept elsewhere,
and the product does not claim otherwise. A backup is not encrypted either: whoever holds the file
can read the whole work, and a restore checks that the file is the one the product wrote — not who
is restoring it.

The host cannot tell that the path a template, a report or an export is written to came from the
save dialog: it trusts the interface, which sends only the path the dialog returned, and it limits
what any path can receive — a `.json`, `.pdf`, `.csv` or `.html` name by kind, a capped size, written whole,
never over a folder, and over an existing file only with the flag the dialog's confirmation sets.

A file the product has written is outside its protection. A PDF, a CSV or a JSON export can be
edited, copied and sent like any other file; the verification in a diary export is true of the
work's diary at the moment of writing, and only its head, compared with the work, says whether a
copy still matches. The CSV and the JSON hold names, notes, contacts and amounts in plain text.
An owner's snapshot, once sent, can be forwarded by anybody who holds it, and the product cannot
take it back. It is safe to open because it contains nothing that runs, not because the browser
that opens it honours its security policy: a viewer that ignores the policy still finds no script
and no address in the file. How it looks is the reader's browser's decision, within the style the
file carries.

## Reporting a vulnerability

Do not open a public issue. Report privately through the repository's Security tab
(**Security → Report a vulnerability**). Say what you found, how to reproduce it, and which
version. You will get an answer, and the fix will be credited to you in the changelog unless you
ask otherwise.
