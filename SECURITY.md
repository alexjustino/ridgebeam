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
and the **payments ledger**. The diary, the baselines and the ledger are the record; the plan
is intent.

## The threat model

| Asset                                                              | Threat                                                                                                                                                                                            | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Slice                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| The diary                                                          | an entry silently edited, deleted or replaced; an entry slipped in out of order                                                                                                                   | four insert-only tables; triggers refuse `UPDATE`, `DELETE` and `REPLACE`; a guard refuses a sequence number that exists; the chain trigger refuses an entry that is not next or does not carry the previous hash; no edit command, a correction instead; a hash chain verified in Diagnostics (and on export, F10)                                                                                                                                                                                                                                                 | **F4**                 |
| The baselines                                                      | a baseline overwritten, withdrawn or given rows it did not have; an approved plan changed with no reason                                                                                          | insert-only tables — `baseline`, `baseline_activity` and, from F8, `baseline_stage` — triggers refuse `UPDATE`, `DELETE` and `REPLACE`; rows only on the latest baseline; `approved_at` never changes; an approved plan refuses every change a baseline records (`plan_approved`) until a replanning is opened with a reason; every baseline after the first closes one and carries its reason; the replanning itself is written once                                                                                                                               | **F2**, **F8**         |
| A stage's gate answers                                             | an answer silently changed or removed; a stage started or closed with an item unanswered or answered no                                                                                           | `check_answer` insert-only with the diary's battery — triggers refuse `UPDATE`, `DELETE` and `REPLACE`, a guard refuses a key that exists; answering again appends and the latest counts; _not applicable_ requires a reason; the gate is enforced by the domain and by the host (`stage_gate_open`); a closed stage refuses every change to its rows (`stage_closed`); no hash chain                                                                                                                                                                               | **F5**                 |
| The payments ledger                                                | a payment silently edited or removed; a mistake hidden by rewriting it; money summed with rounding errors                                                                                         | `payment` insert-only with the same battery — triggers refuse `UPDATE`, `DELETE` and `REPLACE`, a guard refuses a key that exists, payments numbered in order; a mistake is a reversal — a negative payment naming the one it reverses, never larger, once only; a commitment locked once something is paid against it; amounts are integers in minor units; no hash chain                                                                                                                                                                                          | **F6**                 |
| The plan's progress                                                | progress typed in that the site never did                                                                                                                                                         | there is no command, column or control that writes progress; progress is derived from diary entries only, in states                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **F0**, **F4**         |
| Documents — photos, receipts, quotes, drawings, permits, contracts | a hostile file — a crafted image, a huge file, an executable or an archive in disguise, a script inside an SVG; a file swapped on disk behind the product's back                                  | typed by its magic bytes — JPEG, PNG, WebP, GIF, BMP and PDF only, everything else refused with a sentence; 25 MiB for every file; image dimensions capped from the header before decoding; thumbnails decoded under limits; a PDF never parsed or rendered; SVG refused; copied by the host and named by hash, deduplicated; shown as data URLs; opened by the operating system's handler from Rust, only on a click; the hostile corpus in `cargo test` with its committed manifest; every file re-hashed on demand in Diagnostics; orphans listed, never deleted | **F4**–**F7**          |
| The person's privacy                                               | a network request that carries what the work holds                                                                                                                                                | no network: no account, no telemetry, no crash reporting, no update check, no weather service                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **F0**                 |
| The person's machine                                               | a command injected through a name, a path or a file                                                                                                                                               | Tauri capabilities declared one by one; no shell, file-system, HTTP or asset-protocol permission; the opener used only from Rust, for a file the person clicked; every path the host writes is inside the work folder, but for a template exported to the `.json` path the person chose in the save dialog                                                                                                                                                                                                                                                          | **F0**, **F4**, **F9** |
| Exports read by other tools                                        | a spreadsheet formula injected through a diary text or a name                                                                                                                                     | every cell that begins with `=`, `+`, `-`, `@`, tab or carriage return is neutralised on export                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | F10                    |
| Backups                                                            | a restore that brings back less than was saved, or something else                                                                                                                                 | one file with a manifest and a hash; restore round-trips a full work byte for byte, proven in `cargo test`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | F11                    |
| The public repository                                              | a real address, person, contractor, price or e-mail committed; a secret                                                                                                                           | fixtures are synthetic and say so; `.gitignore` refuses `.env`, keys and certificates; review refuses the rest                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **F0**                 |
| The template library                                               | a wrong or hostile template accepted into the library; a real brand, supplier, price, place or contact published as advice                                                                        | templates are JSON data with a closed list of fields and no code; the library test in CI validates every file at the strict level — both languages, ranges never points, no amounts, no text that looks like a web address, an e-mail address or a phone number, no cycle — and applies it to an empty work; a maintainer reviews every template before merge; the loader drops, and logs, a file that fails                                                                                                                                                        | **F9**                 |
| A template from a file                                             | a crafted template: huge, not JSON, not UTF-8, with fields the product does not know, a link cycle or an include cycle, text past every limit, or a plan written into a work that already has one | `.json` only, 1 MiB, UTF-8, read by the host as text and never parsed there; parsed by the domain as JSON and validated field by field, every unknown field refused and every problem named; includes resolve only against the library; applied in one transaction, every row re-checked by the host with its own limits, only into an empty work that is not approved; nothing in a template is ever run                                                                                                                                                           | **F9**                 |

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
  zero. The one decode the product does is the image thumbnail — 320 px, JPEG — through the
  `image` crate with its limits set (width, height, at most 256 MiB of allocation). A photo whose
  thumbnail fails is kept, marked, and says so.
- **A PDF is never parsed and never rendered.** The product reads its first bytes, its size and
  its hash, and nothing else. On screen it is a mark and a name; it opens in the operating
  system's own viewer, from Rust, on the person's click. No PDF library is compiled into the
  product.
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
  "broken at #k" with the reason; Diagnostics runs it on demand, and the export (F10) will print
  the result in its header. `cargo test` tampers with a work file through a second, plain
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

**An approved plan changes only after somebody says why** (F8, ADR-027). Once the plan is
approved, the host refuses every command that changes what a baseline records — the stages, the
activities' names, durations and order, the dependencies, the calendar, the start date, the cost
lines — with `plan_approved`, unless a **replanning** is open. A replanning is opened with a
reason that is not blank, and closed only by taking the next baseline, which copies the reason
and is insert-only like every baseline. There is no abandon: an edit already in the file ends in
a baseline that records it. Facts are never locked — the diary, answers, payments and the rest
are the record, and refusing them would push them out of it.

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

**What the chain cannot see.** An entry removed from the _end_ of the diary leaves no successor
pointing at it, so what remains still verifies. The export (F10) records the count and the last
hash, so that a copy kept elsewhere can show the loss; until then, a backup kept elsewhere is
the only witness.

**What the chain is, stated plainly.** It is tamper-evidence: it shows whether the record has
been altered since it was written. It is **not** a signature, it does not prove who wrote an
entry, and it is **not** legal proof. What a diary is worth in a dispute is the jurisdiction's
to decide, not the product's. The product says this in Diagnostics, in the export header, and
here, and never claims more.

## The plan has no progress command

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

Nobody types "60 % done" into a stage. There is no command, column or control that sets
progress (F0, ADR-009); progress is derived from diary entries (F4, ADR-020) — _not started_,
_started_ or _finished_, and a share only where the diary recorded quantities against a planned
one. This is a security rule as much as a product rule: a plan that can be rewritten with no
trace, or a diary whose entries can be edited after the fact, is a notes app.

## Exports and backups

- **CSV** neutralises formula injection: a cell beginning with `=`, `+`, `-`, `@`, a tab or a
  carriage return is prefixed so that a spreadsheet reads it as text.
- **PDF** reports are rendered from the same domain rows the screen shows; a second reader
  parses the file in the tests.
- **A backup** is one file holding the database, the documents and a manifest with a hash of
  each part. Restore checks the manifest before it writes anything, and round-trips a full work
  byte for byte in `cargo test`.
- **JSON export** carries no path from the person's machine.
- **A template export** is written whole or not at all, `.json` only, and carries no person,
  contact, payment, diary entry or document (ADR-030).

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

Tauri capabilities are declared one by one in `src-tauri/capabilities/`. The shell plugin is
not used. There is no file-system permission, no HTTP permission and no asset protocol: the
webview cannot read a path. The dialog plugin returns a path the person chose — a work folder,
a document to attach, the new place of a moved work, a template to read, where to save one — and only the host's own commands read or write there. The opener is a Rust
dependency with no JavaScript permission: the host opens a document with the operating
system's handler when the person clicks it, and nothing else. The window is a single window with no
remote content.

## Out of the threat model, stated plainly

An attacker with write access to the person's account can edit the database file with any
SQLite tool, and the triggers do not stop them — they can be dropped by whoever owns the file.
The chain would show an alteration of the diary; it would not prevent it — and somebody who
rewrites every entry and recomputes every hash leaves a chain that verifies. The database is **not encrypted
at rest**; the folder's access control is the operating system's. A person who needs the record
protected from somebody with their password needs full-disk encryption and a backup kept
elsewhere, and the product does not claim otherwise.

The host cannot tell that the path a template is exported to came from the save dialog: it trusts
the interface, which sends only the path the dialog returned, and it limits what any path can
receive — a `.json` name, at most 1 MiB, written whole, never over a folder, and over an existing
file only with the flag the dialog's confirmation sets.

## Reporting a vulnerability

Do not open a public issue. Report privately through the repository's Security tab
(**Security → Report a vulnerability**). Say what you found, how to reproduce it, and which
version. You will get an answer, and the fix will be credited to you in the changelog unless you
ask otherwise.
