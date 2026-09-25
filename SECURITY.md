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

| Asset                       | Threat                                                                   | Control                                                                                                                                                                                                                     | Slice  |
| --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The diary and the baselines | an entry silently edited or deleted; a baseline overwritten              | insert-only tables, triggers refuse `UPDATE` and `DELETE`, no edit command exists, hash chain, chain verified on export and in Diagnostics                                                                                  | F4, F8 |
| The plan's progress         | progress typed in that the site never did                                | there is no command that writes progress into a stage; progress is derived from diary entries only                                                                                                                          | F4     |
| Photos and documents        | a hostile file — a crafted image, a huge file, an executable in disguise | caps on size and dimensions before decoding; never executed; opened by the operating system's own handler only on the person's click; a `.jpg` that is not a JPEG is refused with a sentence                                | F7     |
| The person's privacy        | a network request that carries what the work holds                       | no network: no account, no telemetry, no crash reporting, no update check, no weather service                                                                                                                               | F0     |
| The person's machine        | a command injected through a name, a path or a file                      | Tauri capabilities declared one by one; the shell plugin is not used; the opener is used only for a file the person clicked; every path the host touches is inside the work folder or a folder the person chose in a dialog | F0     |
| Exports read by other tools | a spreadsheet formula injected through a diary text or a name            | every cell that begins with `=`, `+`, `-`, `@`, tab or carriage return is neutralised on export                                                                                                                             | F10    |
| Backups                     | a restore that brings back less than was saved, or something else        | one file with a manifest and a hash; restore round-trips a full work byte for byte, proven in `cargo test`                                                                                                                  | F11    |
| The public repository       | a real address, person, contractor, price or e-mail committed; a secret  | fixtures are synthetic and say so; `.gitignore` refuses `.env`, keys and certificates; review refuses the rest                                                                                                              | F0     |
| The template library        | a wrong or hostile template accepted into the library                    | templates are data with no code; the schema test in CI validates every one; a maintainer reviews before merge                                                                                                               | F9     |

## No network

The product makes no network request of any kind. There is no account, no login, no sync, no
telemetry, no crash reporting, no update check, no weather service, no font or script loaded
from anywhere. The Tauri capabilities do not include HTTP. The product reads and writes the
work folder the person chose and nothing else; the About screen says so, and a reader of the
source can confirm it in `src-tauri/capabilities/`.

## Files are hostile

Every file the product opens arrived from somebody else — a photo from a phone, a quote from a
contractor, a drawing from an architect, a backup from another machine. The host treats each
one as hostile:

- **Caps before decoding.** A file is measured before it is opened. Size and, for images,
  dimensions read from the header are checked against caps; a file over a cap is refused with a
  sentence that names the cap. The caps are constants in the host and are listed in
  `docs/DATA_MODEL.md` once slice F7 sets them.
- **Never executed.** The product never runs, installs, or opens a file with anything but the
  operating system's own handler, and only when the person clicks it. A file's extension is a
  hint, not a fact: a `.jpg` that is not a JPEG is a sentence, not a crash.
- **Copied, never linked.** A document attached to a work is copied into the work folder and
  hashed. The original location is not kept; a work never depends on a path that may move.
- **A corpus in `cargo test`.** Slice F7 adds a corpus of hostile files — truncated images,
  wrong extensions, oversized dimensions in the header, zip bombs where an archive is accepted —
  and a test that every one is refused with a sentence.

## The diary and the baselines are append-only

This is requirement one of the specification, and it is enforced in two places on purpose:

- **In the schema.** The diary entries, their photos, their corrections, the baselines and the
  payments ledger are insert-only tables. Triggers refuse `UPDATE` and `DELETE` on each of them,
  so that no code path — not the product's, not a script's — can edit or remove a row through
  the database.
- **In the host.** No Tauri command edits or deletes an entry or a baseline. A correction is a
  new entry that points at the one it corrects; a replan is a new baseline with its reason. The
  interface offers the correction where an edit would be expected, and says why.
- **A chain.** Each entry carries the hash of the previous one. The export verifies the chain
  and prints the result in its header; Diagnostics verifies it on demand. A tampered file fails
  the verification, and `cargo test` proves it by tampering with one.

**What the chain is, stated plainly.** It is tamper-evidence: it shows whether the record has
been altered since it was written. It is **not** a signature, it does not prove who wrote an
entry, and it is **not** legal proof. What a diary is worth in a dispute is the jurisdiction's
to decide, not the product's. The product says this in the export header, in Diagnostics, and
here, and never claims more.

## The plan has no progress command

Nobody types "60 % done" into a stage. The only way progress changes is a diary entry that says
what was done. This is a security rule as much as a product rule: a plan that can be rewritten
with no trace, or a diary whose entries can be edited after the fact, is a notes app.

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
not used. The dialog plugin is used to choose a work folder or a file to attach; the opener is
used only for a file the person clicked. The window is a single window with no remote content.

## Out of the threat model, stated plainly

An attacker with write access to the person's account can edit the database file with any
SQLite tool, and the triggers do not stop them — they can be dropped by whoever owns the file.
The chain would show the alteration; it would not prevent it. The database is **not encrypted
at rest**; the folder's access control is the operating system's. A person who needs the record
protected from somebody with their password needs full-disk encryption and a backup kept
elsewhere, and the product does not claim otherwise.

## Reporting a vulnerability

Do not open a public issue. Report privately through the repository's Security tab
(**Security → Report a vulnerability**). Say what you found, how to reproduce it, and which
version. You will get an answer, and the fix will be credited to you in the changelog unless you
ask otherwise.
