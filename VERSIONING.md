# Versioning

Ridgebeam follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

```
MAJOR . MINOR . PATCH
```

- **MAJOR** — a change that forces the person to act: a work-folder or database migration that
  cannot be reversed, a removed feature, an export or backup format that older versions cannot
  read.
- **MINOR** — new capability, backwards compatible. This is where release themes land
  (1.1 "the site", 1.2 "the crew").
- **PATCH** — bug fixes and corrections only; no schema change, no new surface.

## Single source of truth

The version is declared in `src-tauri/tauri.conf.json` and mirrored into `package.json`, its
lockfile (in two places — `npm version --no-git-tag-version` moves both), `src-tauri/Cargo.toml`
and `src-tauri/Cargo.lock` (rewritten by the first cargo command, and committed with the bump).
`scripts/check-version.mjs` fails if any of the six disagree, and runs as the first gate in
`npm run gates` — so a bump that misses a file cannot reach a tag. The Release workflow adds the
last check: the tag has to name the version the tree declares, and has to sit on `main`. The
About screen reads the version from the running binary, never from a constant typed by hand.

These files and scripts arrive with slice F0's toolchain; this document states the rule they
enforce, and F0 is not done until they enforce it.

## The schema version is separate

A work's database carries its own `schema_version`, which tracks migrations and moves
independently of the product version. Migrations are **forward-only** and numbered
(`001_init.sql`, `002_*.sql`, …). A release that adds a migration must state so in the changelog
and must be covered by a round-trip test that opens a work at version N-1 and migrates it without
loss — and, for this product, without touching a single diary entry or baseline, which are
append-only by requirement one of the specification.

## Release flow

```
feat/*  ->  develop  ->  release/vX.Y  ->  main  ->  tag vX.Y.Z
```

1. Slices merge into `develop` by pull request, gates green.
2. A release branch stabilises: changelog, version bump, documentation sweep.
3. `main` receives the release branch by pull request. `main` is always releasable.
4. Tagging `vX.Y.Z` on `main` triggers the release workflow: it builds the MSI and NSIS
   installers and attaches them to the GitHub Release.

Pre-release tags use `-alpha.N`, `-beta.N`, `-rc.N`.

The checklist that runs this flow is `docs/RELEASE.md`, written with the first release branch.
