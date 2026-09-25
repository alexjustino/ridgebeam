/**
 * The version is one fact, declared in six places across five files.
 *
 * `src-tauri/tauri.conf.json` is the source of truth — it is what the installer
 * and the running binary carry. `package.json`, its lockfile (in two places),
 * `src-tauri/Cargo.toml` and `Cargo.lock` mirror it. VERSIONING.md has always said a gate fails
 * if they disagree; this is that gate.
 *
 * The lockfile is here because it drifted the first time this was used in
 * anger: `package.json` was edited by hand, and npm's copy of the version stayed
 * a release behind until something looked.
 *
 * Run by `npm run gates`, so a bump that misses a file cannot reach a tag.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Semantic Versioning 2.0.0, with the pre-release and build forms we use. */
const SEMVER = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;

/**
 * A file's text, or `null` when it is not there. A missing file is one more
 * disagreement to report beside the others, not a stack trace that hides them:
 * `Cargo.lock` in particular does not exist until the first cargo command.
 */
function read(relative) {
  try {
    return readFileSync(path.join(root, relative), 'utf-8');
  } catch {
    return null;
  }
}

function readJson(relative, key) {
  const text = read(relative);
  if (text === null) return { file: relative, missing: true };
  return { file: relative, value: JSON.parse(text)[key] };
}

function readCargo(relative) {
  const text = read(relative);
  if (text === null) return { file: relative, missing: true };
  // The first `version` after `[package]`, and only that one: the dependency
  // table below is full of versions that are not ours.
  const packageBlock = text.slice(text.indexOf('[package]'));
  const match = packageBlock.match(/^version\s*=\s*"([^"]+)"/m);
  return { file: relative, value: match?.[1] };
}

/** The lockfile's second copy of the version: `packages[""].version`, which `npm version` moves too. */
function readLockRoot(relative) {
  const file = `${relative} (packages[""])`;
  const text = read(relative);
  if (text === null) return { file, missing: true };
  return { file, value: JSON.parse(text).packages?.['']?.version };
}

/** The crate's own entry in Cargo.lock, which a cargo command rewrites and a release must commit. */
function readCargoLock(relative) {
  const text = read(relative);
  if (text === null) return { file: relative, missing: true };
  const match = text.match(/\[\[package\]\]\r?\nname = "ridgebeam"\r?\nversion = "([^"]+)"/);
  return { file: relative, value: match?.[1] };
}

const truth = readJson('src-tauri/tauri.conf.json', 'version');
const mirrors = [
  readJson('package.json', 'version'),
  readJson('package-lock.json', 'version'),
  readLockRoot('package-lock.json'),
  readCargo('src-tauri/Cargo.toml'),
  readCargoLock('src-tauri/Cargo.lock'),
];

const problems = [];

if (truth.missing) {
  problems.push(`${truth.file}: missing`);
} else if (!truth.value) {
  problems.push(`${truth.file} declares no version`);
} else if (!SEMVER.test(truth.value)) {
  problems.push(`${truth.file}: "${truth.value}" is not a semantic version`);
}

for (const mirror of mirrors) {
  if (mirror.missing) {
    problems.push(`${mirror.file}: missing — expected "${truth.value}"`);
  } else if (mirror.value === undefined) {
    problems.push(`${mirror.file}: no version for ridgebeam found — expected "${truth.value}"`);
  } else if (mirror.value !== truth.value) {
    problems.push(`${mirror.file}: "${mirror.value}" — expected "${truth.value}"`);
  }
}

if (problems.length > 0) {
  console.error('The version is not one fact:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nThe source of truth is ${truth.file}. Bring the others to it.`);
  process.exit(1);
}

console.log(`version ${truth.value}, agreed in ${mirrors.length + 1} places`);
