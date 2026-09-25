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
   - for every capability the release adds, the check its slice's proof of done names.
9. **The host proof, when the release carries one** (SPEC §6). For 1.0.0: a real small work — not
   committed — planned from a template to readiness 100 %, run for a week through the diary, and
   its weekly report read by somebody who is not an engineer. A release that carries this proof
   ships only when a person has done it.

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
