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
   - **ask whether the money will last** on a work with a scheduled stage of two activities, priced
     cost lines and a commitment with a payment plan. With no fund recorded, readiness reads _"Where
     the money comes from is not written down yet."_ On **Money → Funding**, record two funds
     smaller than the work's total — savings expected today and a loan tranche in three weeks — and
     **Mark as received…** the savings for their whole amount, today: the receipt is in the ledger,
     and a day after today is refused with a sentence. The **Will the money last?** card reads
     _"Money runs short in the week of … — … short."_ beside a danger-toned error icon; **Money runs
     short in the week of** shows that week's Monday, every week is a row of the table, and the
     short week's closing reads _"… short"_ with no minus sign. Receive part of the tranche early
     and read the sentence change; then add a fund that covers the gap and read _"The money lasts to
     the end, with … to spare."_, with no success colour. Add a fund expected yesterday and leave it
     unreceived: a note says _"1 expected sum has not arrived: … not counted — money that has not
     come is not money."_ and **Money expected and late** reads 1; a fund expected today is still
     counted. Change the late fund's day and amount: it is allowed. Reverse a receipt: the reversal
     is a new row for the whole amount, the original stays, and reversing it again is refused; try
     to remove a fund with money received against it and read the refusal. Give two activities a
     range and read _"N in 10 chances that the money runs short before the work ends."_; take the
     ranges away and read _"Every duration is taken as certain, …"_. The card ends _"A projection,
     not a promise: …"_. The dashboard's money card shows the short week's Monday, or the money left
     at the end, with the sentence and no chance; the weekly report prints the sentence with the
     short week's rows, and none once the money lasts; and the owner's snapshot, opened in a
     browser, says the same sentence. Do it once in Portuguese, where the card reads _O dinheiro vai
     dar?_, the money left is _Dinheiro que sobra no fim_, a fund is _recursos_, and the money that
     lasts reads _"O dinheiro dá até o fim, e sobram …."_;
   - **ask why the work is late** — first on a work written by the previous release, with diary
     entries, a correction, photos and a day marked lost: let it migrate and run **Verify the
     diary** in Diagnostics. It must still read "N entries, chain intact", with the same N as before
     the upgrade — no hash moved. Then, on an approved plan with a stage of two chained activities
     and a responsible, write a day worked, then a day with **No work was possible** ticked: **Why?**
     offers seven causes; choose _Waiting for a decision_ and save — the entry reads _"Lost — waiting
     for a decision"_. Write another lost day, rainy, with no cause; choose _Crew did not come_ on a
     third and name the person under **Who**: the entry carries the name. Correct one entry to change
     its cause: the original is struck through beside its correction, and no control edits a cause
     in place. On the **Schedule**, the **As things stand** card sits
     beside the finish and the slip and says which is which — _"As things stand it finishes on … — N
     working days after the baseline's …."_ — while the slip, the Gantt and the plan's finish date
     have not moved. On the dashboard, **Why is it late?** reads the days late as things stand, and
     the ledger by cause and by party: the stated decision, the weather, the absence on the named
     person's account, and what the record does not explain in words — every figure opening onto
     the entries it was counted from. Approve a change order that adds working days and read it
     appear as a cause of its own, on the account of who asked. Run **Verify the diary** again: still
     "chain intact". Write the weekly report and the owner's snapshot, and both carry the forecast's
     sentence and the causes. Do it once in Portuguese, where the cards read _Do jeito que está_ and
     _Por que está atrasada?_ and the cause _Esperando uma decisão_;
   - **close the work out** on a work with a stage of one activity, a person of the plan and a
     commitment on that stage with that person. Give the commitment a payment plan of 95 % when the
     stage closes and, as its last part, **Hold back as retention**: the editor offers 5 % and says,
     beside it, that it is a common practice, not advice. Close the stage: the retention reads
     earned — no snag holds it yet. On **Plan → Snags**, raise two snags in that closed stage, on
     that person, each with a photo of the problem — one chosen in the dialog, one dropped on the
     window — and give one a due day already past: the list shows both open, the overdue one marked
     in words, and the closed stage refused neither. On **Money**, the retention now reads _held
     until …_ with two snags open, and is not in **due now**; on the **Will the money last?** card
     it is listed apart as money held, not counted in a week. **Fix…** the first snag with a photo
     of it fixed: it reads fixed, and the retention is still held, by one snag. Try to fix the
     second with no photo: it is refused, and the dialog says a fix needs its photo. **Withdraw…**
     it instead, with a reason: it stays in the list as withdrawn, with its reason, and the
     retention reads earned. Look for a control that edits or deletes a snag: there is none. Raise a
     third snag on that person and the retention is held again; record a payment of the whole
     commitment on the Ledger, and the warning says it pays ahead of the work before it is saved —
     and it is still recorded. The dashboard's **Still to fix** card reads the open and the overdue,
     by person, every figure opening onto its rows. On **Reports**, the handover book's gaps list
     the open snag as **Still to fix**; write the book anyway, and find the fixed snag in its
     stage's section with both photos, before and after, side by side. Write the weekly report and
     the owner's snapshot: both say what is still open and on whom. Do it once in Portuguese, where
     the tab reads _Pendências_, a snag is a _pendência_ and the retention a _retenção_;
   - **hold a site meeting** on an approved plan with a decision past its deadline, a change order
     waiting and a snag open, and two people in the plan. On the dashboard, **This week's meeting**
     says no meeting has been held yet; open it: the agenda lists the decision as overdue, the
     change with how long it has waited and the snag, each in its section, in the fixed order, and
     no section is shown with nothing in it. Tick the two people as there and add somebody by name;
     write a note on the decision. **Make the decision…** from its item: the decision's own dialog
     opens, and once made the item says _"Decision made: …"_ and that it is already in the record.
     **Approve…** the change from its item: the dialog shows its impact and says that approving
     opens the replanning, as it does on the Plan. Add an action — what, one of the two people, due
     on Friday. Try to leave the page: it asks before discarding the draft. **Close the meeting**:
     the confirmation says the minutes cannot be changed afterwards; confirm, and the dashboard's
     card reads meeting #1 on today, with one action open on that person. The decision is made and
     the change approved in the record — the replanning is open — and nothing about the meeting
     offers an edit or a delete. Open the meeting again: the agenda starts with the action still
     open, from meeting #1, and no longer lists the decision or the change. Close the action as
     **Done** and close meeting #2. On **Reports**, choose meeting #1 and write its minutes to a
     path chosen in the save dialog, then **Open** them: the system viewer shows the number and the
     day, who was there, the decision with its answer, the change approved, the note, and the action
     — who, by when — and the last line says the minutes are a record, not a signature; meeting #2's
     minutes list the action closed as done. Write the owner's snapshot and find the last meeting in
     it. Do it once in Portuguese, where the card reads _Reunião da semana_, the minutes are the
     _ata_ and an action an _encaminhamento_;
   - **order what takes time to arrive** on a work with an activity that starts in ten days. On the
     Plan's **Purchases** tab add _Worktop_ for that activity with a lead time of 21 days, and
     _Cabinet handles_ with 3. The worktop reads **late to order**, by eleven days, and its row says
     what its day to order by was computed from — the day the activity starts as things stand and
     the 21 days; the handles read to order by a day next week, with no flag. On the dashboard, **To
     order this week** shows 1 to order this week, 1 late to order and none late to arrive, and each
     figure opens onto its rows. **Mark as ordered…** the worktop today: it is expected in 21 days,
     and the row says it will arrive after it is needed; the dashboard no longer counts it late to
     order, and nothing on its row offers an edit or a remove. Open this week's meeting: the
     agenda's **Purchases** section, between the snags and the money, lists the worktop. **Mark as
     delivered…** the worktop: it leaves every list. Mark the handles ordered, then **The order fell
     through…** with a note: they read to order again, and the row says an order fell through. Write
     the weekly report and the owner's snapshot and find the purchases in both, in the owner's
     words. Do it once in Portuguese, where the tab reads _Compras_, the lead time is the _prazo de
     entrega_ and the day to order by reads _encomendar até_;
   - **let the work teach the next** on a work whose plan has three activities in one stage —
     _Fit the cabinets_ planned at 3 working days, _Hang the doors_ at 2 with a range of 2 to 4,
     _Fit the handles_ at 1. In the diary, say the cabinets started on a day three weeks back and
     finished a week later, the doors started and finished within two days, and the handles started
     yesterday and did not finish. On the **Schedule**, the **Planned and actual** card reads 2
     finished, 1 took longer than planned; the cabinets' row says, in words and with the unit,
     planned 3 working days, what they took, and how many more; the doors' row says inside the range
     it was given; the handles' row says so far, and nothing about a difference yet. Each figure
     opens onto its rows. On a work where nothing has started, the card says the diary is what tells
     it. On the Plan, **Export as a template…**: choose **Learned from this work** — its hint says
     what it does and that 2 activities finished — and **Where** offers **My templates** first; save
     it as _kitchen-joinery-learned_ and the dialog says where it went. Save it again under the same
     id: it asks before replacing. Create a new work and open the template picker: under **Your
     templates**, after the library, is the template by its title, and the picker says where the
     folder is. Start from it: the cabinets' activity has **no duration**, and its range runs from 3
     up to what the cabinets took; the **Schedule**'s chance of finishing is drawn from it. Put a
     file that is not a template into that folder by hand: it is listed, disabled, with its reason.
     Choose your template again and **Remove from my templates…**: the confirmation, in the danger
     tone, says it deletes the file; confirm, and it leaves the picker and the folder. Export once
     more **to a file**, as before, and find the file where the save dialog put it. Do it once in
     Portuguese, where the card reads _Planejado e real_, the actual duration is the _duração real_
     and My templates are _meus modelos_;
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
