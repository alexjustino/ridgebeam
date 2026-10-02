# Releasing Ridgebeam

The flow is in [`VERSIONING.md`](../VERSIONING.md); this is the checklist that runs it. Every
step is a command or a thing a person looks at, in order, and nothing here is optional — a
release that skipped a step is a release nobody can reason about afterwards.

## Before the tag

1. **The slice branches are merged** into `develop` and CI is green on it.
2. **Bump the version** in `src-tauri/tauri.conf.json`. Mirror it into `package.json` and its
   lockfile with `npm version X.Y.Z --no-git-tag-version`, into `src-tauri/Cargo.toml` by hand,
   and let cargo rewrite `Cargo.lock` — `cargo metadata` does it without compiling. Then prove
   the six agree:

   ```bash
   cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 > /dev/null
   npm run check:version
   ```

3. **Close the changelog.** Move `[Unreleased]` into `[X.Y.Z] — YYYY-MM-DD`. Write it for
   somebody who has never seen the product, not as a diff against the last commit. Note any
   migration the release adds, as `VERSIONING.md` requires.
4. **The glossary is in step.** `npm run check:glossary` is one of the gates, so the battery
   below fails if it is not — but read [`GLOSSARY.md`](GLOSSARY.md) once, in both languages,
   against the screens this release adds. A term on a screen that is not in the glossary is a
   defect the gate cannot see.
5. **Run the whole battery**, which builds the installers and checks them:

   ```bash
   npm run release:check
   ```

   That is `npm run gates`, then `tauri build`, then `check:bundle` — which fails if an
   installer is over **10 MB** (SPEC §4), if `dist/` carries source, or if the binary was not
   stripped.

6. **Run the end-to-end suite against the release binary**, not the debug one. This is the
   closest thing to a clean machine that a developer machine can offer: an application database
   created from empty, a work folder created in a temporary directory, the whole journey driven
   through the real product in both languages, and a restart that must bring everything back.

   ```powershell
   $env:RIDGEBEAM_E2E_APP = "$PWD\src-tauri\target\release\ridgebeam.exe"
   $env:RIDGEBEAM_E2E_EDGEDRIVER = '<the path to msedgedriver.exe>'
   npm run e2e:only
   ```

   A release build ignores `RIDGEBEAM_DATA_DIR` and has no typed folder path on the Start screen
   (ADR-010), so the steps that need them run against the debug binary; say in the release
   notes which ones did.

7. **The name sweep, repeated.** Re-run the collision check behind [`SPEC.md`](SPEC.md) §0 and
   ADR-001 — GitHub, npm, crates.io, the domains, the Microsoft Store, USPTO and INPI — and
   record what changed since the decision. Risk R11 is the reason: a name is only clear on the
   day somebody looked.
8. **Install the MSI and use it.** The suite cannot choose a folder in the system dialog, cannot
   judge whether a sentence reads naturally, and cannot hear a screen reader. A person does:
   - install, launch, and create a work in a new folder chosen **in the dialog**;
   - add a stage and an activity with a duration and no responsible; open the readiness figure
     and read what it says is missing, in English and in Portuguese;
   - add a responsible, watch readiness reach 100 %, and restart — everything is still there;
   - close the work and check the folder holds one database file and no `-wal` or `-shm`;
   - move the folder, reopen the product, and check the recent list says the folder is gone and
     offers a way to find it;
   - switch the theme and the lens, and check that nothing in the work changed;
   - **verify the diary after the upgrade**: open a work written by the previous release — one
     with diary entries, a correction and photos — in the new one, let it migrate, and run
     **Verify the diary** in Diagnostics. It must read "N entries, chain intact" with the same N
     as before the upgrade, every photo's thumbnail must still show, and `documents/` must hold
     the same files. A release whose migration touches a diary table ships only after this has
     passed on a real work, not only in `cargo test`;
   - attach a real PDF and a real photo to a stage from the dialog, open each with the system
     viewer, try a Word file and see it refused by name, then run **Re-hash the documents** in
     Diagnostics and read "all as recorded";
   - on **Reports**, write the weekly report, the diary as a PDF and as CSV, the schedule and the
     work as JSON, each to a path chosen **in the save dialog**, and press **Open** on each PDF: the
     system viewer shows it. Read the weekly report in English and in Portuguese — the accents
     print, and nothing reads `?` — and check that a week with no entry says so on its first line.
     The diary PDF opens with "Chain verified on …" and says it is not a signature and not legal
     proof. Open the CSV in a spreadsheet: one entry per row, the columns split, and a note typed
     as `=1+1` shows as text with its apostrophe, not as `2`;
   - **write the handover book of a real work** with rooms, a check that needs a photo answered
     with one, a diary photo, a warranty as a PDF and a care note: the card lists what the book
     still lacks before it is written, and the book opens in the system viewer with every photo
     drawn — the hidden-work photo full width, captioned with its check and its day — the room's
     section, the decision's answer, the care note as it was typed, and the warranty listed by name,
     not reproduced. Print one page with photos on a real printer: they are sharp enough to find
     a pipe by. While a stage is still open, the first page says the book was written while the
     work was in progress;
   - **write the owner's snapshot of a real work** with an activity starting this week, a decision
     due within 14 days and a diary entry with a photo, and press **Open**: the system's browser shows
     it. Then send it to a real phone yourself — by WhatsApp or by e-mail — and open it there, in light
     and in dark: it reads as one column with no sideways scroll but inside a table, every figure
     opens onto its rows with a tap, the photo shows, and the last line says the day and that it does
     not change. Open the file in a text editor and search it for `<script` and `http`: neither is
     there. Write it in Portuguese too and read the same on the phone;
   - **back up and restore a real work**: open a work with diary entries, a correction, photos
     and a PDF, and in **Settings → This work** press **Back up this work** and save the
     `.ridgebeam` file where the save dialog says. The sentence names the path, the size and how
     many files it holds, and Settings and Diagnostics now show today as the last backup. Open
     the file with Windows' own **Extract all** and look inside: `manifest.json`, `work.sqlite3`,
     `documents/`, `thumbnails/` and `manifest.sha256`. Close the work, press **Restore a
     backup…** on the Start screen, choose the file and a **new, empty** folder in the dialogs:
     the preview names the work, the day it was backed up and the build that wrote it, and after
     restoring the Start screen says "Restored: N entries, chain verified, N documents as
     recorded", with the same N the work had. The dashboard reads the same readiness, finish date,
     slip and money as before; the old folder is still where it was, untouched. Then flip one byte
     of a copy of the file in a hex editor and restore that copy: it is refused with a sentence,
     and no folder is left behind;
   - **drop files from Explorer**: the suite emits Tauri's own drop event to the window and checks
     everything after it, but no test performs the operating system's gesture itself. Drag two photos from a folder in Explorer over the **Diary**: before they land,
     one overlay over the whole window says they will join the entry's photos; drop them, and they
     are listed with the entry's photos, **More…** open. Save the entry: the photos show on its
     card. On **Documents**, choose a kind in the form and drag a real PDF and a Word file onto the
     page: the PDF is added at once with that kind, attached to the work, and the Word file is left
     out by name — _"… was left out: it is a folder, or not a kind of file taken here."_ Filter the
     page on a stage and drop a photo: it is attached to that stage. Drag a folder onto either page
     and see it left out by name; rename a folder to end in `.jpg`, drop it on Documents, and see
     the host refuse it by name in the page's list. Drop a photo on the **Schedule**: an information
     bar at the top says where files can be dropped, nothing is added anywhere, and the bar closes
     with its button and goes when you change screen. Drag files over the window and back out
     without dropping: the overlay goes. Do it once in Portuguese;
   - **tick "same people"**: on a day after an entry naming two people, open the diary entry and
     press **Same people as {day}**: exactly those two are ticked, anyone already ticked stays
     ticked, and the press is announced. Remove one of them from the plan, press it again on a new
     day, and read that one of them is no longer in the plan. While writing a correction, the button
     is not there;
   - **see the backup reminder**: open a work with a diary entry that has never been backed up. The
     dashboard says, in a muted line under its header, _"This work has never been backed up on this
     machine."_; **Back up now…** lands on **Settings → This work** with the focus on the backup's
     file field. Write the backup there, go back to the dashboard, and the line is gone. Press **Not
     now** on another work and see it come back after a restart. In Portuguese the button reads
     _Fazer a cópia de segurança agora…_;
   - **raise, approve and decline a change order** on an approved plan with an activity on the
     critical path and no replanning open. Before approval, the Plan's **Changes** tab offers no
     form and says why. After it, raise a change the owner asked for that adds an activity of 2
     working days after the critical one, priced at 300: before it is saved, the form says it
     finishes 2 working days later, with both dates and the money. Approve it: the dialog shows the
     same impact and says what approving will do, and afterwards the replanning is open with the
     reason _"Change order #1 — …"_, the new activity is in the plan with its link, and a cost line
     _"Change order #1"_ is on its stage. Go to the Schedule and take the next baseline: its reason
     names the change, and comparing it with the one before lists the change. Raise a second change
     asked for by a person of the plan and decline it: nothing in the plan moves. Raise a third and
     leave it waiting. The dashboard's **Changes** card reads +300 and +2 working days, each figure
     opening onto its rows, and one change waiting; write the owner's snapshot and the weekly
     report, and both say a change is waiting for a decision. Try to edit or remove a change: there
     is no control that does it. Do it once in Portuguese, where a change order is an _aditivo_;
   - for every capability the release adds, the check its slice's proof of done names.
9. **The host proof, when the release carries one** (SPEC §6). For 1.0.0: a real small work — not
   committed — planned from a template to readiness 100 %, run for a week through the diary, and
   its weekly report **written from Reports, printed on paper** and read by somebody who is not an
   engineer. Print it from the system viewer on a real printer, A4: the footer reads "page N of M"
   on every page, nothing is cut at a margin, and the reader can say from the page what was done
   that week, what is late, what to decide and what to pay. Write down who read it and what they
   could not follow; a sentence they could not follow is a defect in the dictionaries, not in the
   reader. A release that carries this proof ships only when a person has done it.

## The tag

10. **Open a pull request from `release/vX.Y` into `main`.** `main` is always releasable; it
    receives releases and nothing else.
11. **Merge it, then tag `main`:**

    ```bash
    git checkout main && git pull
    git tag -a vX.Y.Z -m "Ridgebeam X.Y.Z — <theme>"
    git push origin vX.Y.Z
    ```

    An annotated tag, so the tag carries who made it, when, and the theme.

12. The **Release workflow** runs on the tag: it refuses a tag that does not name the version the
    tree declares or that is not on `main`, then gates, build, bundle check, and a **draft**
    GitHub Release with `Ridgebeam_X.Y.Z_x64_en-US.msi` and `Ridgebeam_X.Y.Z_x64-setup.exe`
    attached — the very files the bundle check approved, built once — and the SHA-256 of each
    written into the notes by the same job. It is a draft on purpose — somebody reads the notes
    before the world does.
13. **Edit the draft release notes** from the changelog. Check the two SHA-256 values against the
    downloaded assets (`Get-FileHash -Algorithm SHA256`), then publish.
14. **Merge `main` back into `develop`** so the release commits are not stranded.

## After

- The installers are unsigned (ADR-012); SmartScreen warns on first run. The README and the
  release notes both say so, and neither pretends otherwise.
- If a fix is needed before the next minor, branch `release/vX.Y` from the tag, fix, and cut
  `vX.Y.Z+1` the same way.
