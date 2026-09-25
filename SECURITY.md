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

| Asset                       | Threat                                                                          | Control                                                                                                                                                                                                                                                                                                             | Slice          |
| --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| The diary                   | an entry silently edited, deleted or replaced; an entry slipped in out of order | four insert-only tables; triggers refuse `UPDATE`, `DELETE` and `REPLACE`; a guard refuses a sequence number that exists; the chain trigger refuses an entry that is not next or does not carry the previous hash; no edit command, a correction instead; a hash chain verified in Diagnostics (and on export, F10) | **F4**         |
| The baselines               | a baseline overwritten, withdrawn or given rows it did not have                 | insert-only tables, triggers refuse `UPDATE`, `DELETE` and `REPLACE`; rows only on the latest baseline; `approved_at` never changes; the reason for each change                                                                                                                                                     | **F2**, F8     |
| The plan's progress         | progress typed in that the site never did                                       | there is no command, column or control that writes progress; progress is derived from diary entries only, in states                                                                                                                                                                                                 | **F0**, **F4** |
| Photos                      | a hostile file — a crafted image, a huge file, an executable in disguise        | measured before decoding: 25 MiB, magic bytes, 12 000 px from the header; copied by the host and named by hash; thumbnails decoded under limits; shown as data URLs; opened by the operating system's handler from Rust, only on the person's click; a hostile corpus in `cargo test`                               | **F4**         |
| Other documents             | the same, for quotes, drawings, permits and receipts                            | the same rules, extended to their formats                                                                                                                                                                                                                                                                           | F7             |
| The person's privacy        | a network request that carries what the work holds                              | no network: no account, no telemetry, no crash reporting, no update check, no weather service                                                                                                                                                                                                                       | **F0**         |
| The person's machine        | a command injected through a name, a path or a file                             | Tauri capabilities declared one by one; no shell, file-system, HTTP or asset-protocol permission; the opener used only from Rust, for a file the person clicked; every path the host writes is inside the work folder                                                                                               | **F0**, **F4** |
| Exports read by other tools | a spreadsheet formula injected through a diary text or a name                   | every cell that begins with `=`, `+`, `-`, `@`, tab or carriage return is neutralised on export                                                                                                                                                                                                                     | F10            |
| Backups                     | a restore that brings back less than was saved, or something else               | one file with a manifest and a hash; restore round-trips a full work byte for byte, proven in `cargo test`                                                                                                                                                                                                          | F11            |
| The public repository       | a real address, person, contractor, price or e-mail committed; a secret         | fixtures are synthetic and say so; `.gitignore` refuses `.env`, keys and certificates; review refuses the rest                                                                                                                                                                                                      | **F0**         |
| The template library        | a wrong or hostile template accepted into the library                           | templates are data with no code; the schema test in CI validates every one; a maintainer reviews before merge                                                                                                                                                                                                       | F9             |

A slice in **bold** has shipped the control; the others are promises, held to by the slice named.

## No network

The product makes no network request of any kind. There is no account, no login, no sync, no
telemetry, no crash reporting, no update check, no weather service, no font or script loaded
from anywhere. The Tauri capabilities do not include HTTP. The product reads and writes the
work folder the person chose and nothing else; the About screen says so, and a reader of the
source can confirm it in `src-tauri/capabilities/`.

## Files are hostile

Every file the product opens arrived from somebody else — a photo from a phone, a quote from a
contractor, a drawing from an architect, a backup from another machine. The host treats each
one as hostile. **Shipped for photos in F4** (ADR-021); documents other than photos follow the
same rules in F7.

- **Measured before decoding.** The host reads the file itself — the webview never touches it —
  and refuses it, with a sentence that names the file and the reason, if it is over **25 MiB**,
  if its **magic bytes** are not JPEG, PNG, WebP, GIF or BMP, or if the **dimensions** read from
  its header, without decoding, exceed **12 000 × 12 000** pixels. HEIC is recognised and refused
  by name: 1.0 does not decode it. A file's extension is a hint, not a fact: a `.jpg` that is not
  a JPEG is a sentence, not a crash.
- **Copied, named by hash, never linked.** An accepted photo is hashed (SHA-256) and copied to
  `documents/<hash>.<ext>` inside the work folder, the extension from the detected type and
  never from the name. The original location is not kept; a work never depends on a path that
  may move. A photo already in the folder is referenced by its hash and never copied twice.
- **Decoded only under limits.** The one decode the product does is the thumbnail — 320 px,
  JPEG, to `thumbnails/<hash>.jpg` — through the `image` crate with its limits set: maximum
  width and height, and at most 256 MiB of allocation. A photo whose thumbnail fails is kept,
  marked, and says so on screen.
- **One entry, one transaction.** A refused photo refuses the whole diary entry it came with, and
  any file already copied for that entry is removed. Nothing is half-written.
- **Never executed, never read by the webview.** Thumbnails reach the screen as `data:image/jpeg`
  URLs returned by a command; the capabilities hold no asset protocol and no file-system
  permission. The original is opened only by the operating system's own handler, from Rust, when
  the person clicks it.
- **A corpus in `cargo test`.** A text file named `.jpg`, a PNG header that claims 100 000
  pixels, a truncated JPEG, an empty file and a 26 MiB file are each refused with a sentence, and
  nothing is written. F7 extends the corpus to the document formats it accepts.

## The diary and the baselines are append-only

This is requirement one of the specification, and it is enforced in two places on purpose.
**Shipped: the baselines in F2 (ADR-016), the diary in F4 (ADR-019).**

- **In the schema.** The diary is four tables — `diary_entry`, `diary_done`, `diary_present`
  and `diary_photo` — and the baselines two, `baseline` and `baseline_activity`. On each,
  triggers refuse `UPDATE` and `DELETE`. `INSERT OR REPLACE` removes the row it replaces
  without firing a delete trigger when `recursive_triggers` is off, so each table also has a
  guard before insert that refuses a key that already exists; the product opens every file with
  `recursive_triggers` on as well. A done line, a person present or a photo may be added only to
  the latest entry — the one being written — so a past entry cannot gain a line it did not have
  when its hash was computed; rows are added only to the latest baseline for the same reason. A
  further trigger refuses a diary entry whose sequence number is not the next one, or whose
  `prev_hash` is not the hash of the entry before it: the chain cannot fork, skip or start again.
  Every one of these raises `diary: append-only` or `baseline: append-only`, so that no code
  path — not the product's, not a script's through the database — can edit, remove or reorder a
  row.
- **In the host.** No Tauri command edits or deletes an entry or a baseline. The Rust module that
  writes the diary contains no `UPDATE`, `DELETE` or `REPLACE`, and a test reads its source to
  prove it; the same rule holds for baselines. An entry dated in the future is refused by the
  domain against today and by the host against its own clock.
- **A correction is a new entry.** It names the entry it corrects, restates the day, and says
  what was wrong. The interface offers _Correct…_ where an edit would be expected, and says why;
  the day view shows the original struck through beside its correction. A replan (F8) is a new
  baseline with its reason.
- **A chain.** Each entry carries the SHA-256 hash of the entry before it — the empty string for
  the first — and its own hash over a canonical form of the entry and its children: every field,
  every done line, every person present and every photo, with `NULL` distinguishable from the
  empty text, versioned and written out in full in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). The host
  refuses control characters in every text of an entry, so no value can forge a separator.
  `diary_verify` recomputes every hash and every link and answers "N entries, chain intact" or
  "broken at #k" with the reason; Diagnostics runs it on demand, and the export (F10) will print
  the result in its header. `cargo test` tampers with a work file through a second, plain
  connection — the triggers dropped, a note rewritten, a photo's hash changed, a row deleted —
  and shows the verification fails at that entry.
- **The author is the account's name.** The host writes the display name of the Windows account
  that is running it on each entry. It is what the machine says, not an identity the product
  checks: the product has no accounts.

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

## Public repository hygiene

Nothing in this repository is a real address, a real person, a real contractor, a real price or
a personal e-mail. Fixtures are synthetic and say so in their name or their header. The
template library carries duration **ranges** and cost **lines**, never quotes. No `.env`, no
key, no certificate, no secret, ever; `.gitignore` refuses the obvious ones and a reviewer
refuses the rest. `CONTRIBUTING.md` says how a template enters the library and the schema test
says whether it may.

## Minimum capabilities

Tauri capabilities are declared one by one in `src-tauri/capabilities/`. The shell plugin is
not used. There is no file-system permission, no HTTP permission and no asset protocol: the
webview cannot read a path. The dialog plugin returns a path the person chose — a work folder,
a photo to attach — and only the host's own commands read or write there. The opener is a Rust
dependency with no JavaScript permission: the host opens a photo with the operating system's
handler when the person clicks it, and nothing else. The window is a single window with no
remote content.

## Out of the threat model, stated plainly

An attacker with write access to the person's account can edit the database file with any
SQLite tool, and the triggers do not stop them — they can be dropped by whoever owns the file.
The chain would show an alteration of the diary; it would not prevent it — and somebody who
rewrites every entry and recomputes every hash leaves a chain that verifies. The database is **not encrypted
at rest**; the folder's access control is the operating system's. A person who needs the record
protected from somebody with their password needs full-disk encryption and a backup kept
elsewhere, and the product does not claim otherwise.

## Reporting a vulnerability

Do not open a public issue. Report privately through the repository's Security tab
(**Security → Report a vulnerability**). Say what you found, how to reproduce it, and which
version. You will get an answer, and the fix will be credited to you in the changelog unless you
ask otherwise.
