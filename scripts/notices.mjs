/**
 * The licence of every third-party package the product ships, as data.
 *
 * The About screen lists every crate compiled into the binary and every npm
 * package in the interface's production tree, each with its licence (F11,
 * ADR-033's slice). That list is not typed by hand: this script writes it from
 * the two lockfiles, so the screen and the dependencies are one fact, not two.
 *
 *   node scripts/notices.mjs           write src/features/about/notices.json
 *   node scripts/notices.mjs --check   fail if the committed file is not
 *                                      byte-for-byte what would be written
 *
 * What counts as shipped:
 *
 * - Rust: every package reachable from `ridgebeam` over **normal** dependency
 *   edges, for the Windows target (`cargo metadata --filter-platform
 *   x86_64-pc-windows-msvc`). Dev-dependencies (test-only, like the second PDF
 *   reader) and build-dependencies (build scripts, run on the build machine)
 *   are not followed. Procedural macros are normal dependencies and are kept:
 *   the code they generate is in the binary.
 * - npm: every package `package-lock.json` does not mark `dev` or
 *   `devOptional`, and whose `os`/`cpu`, when declared, admit `win32`/`x64` —
 *   the production tree `npm ci --omit=dev` would install on the machine the
 *   product is built on. Build tools in that tree (Vite's plugins, Tailwind's
 *   compiler) are listed too: the plan's rule is the production tree, and a
 *   list that guesses which of them leave a trace in the output is a list
 *   nobody checked.
 *
 * No network, ever: `cargo metadata` runs `--offline --locked`, reading the
 * committed Cargo.lock and the crates already in the local cache. When the
 * cache lacks a crate the lockfile names, the script says so and stops; the one
 * step that fetches is `cargo fetch` in `src-tauri/`, run by a person (or by the
 * cargo gates, which run before this one in `scripts/gates.ps1`).
 *
 * The output is deterministic — sorted by name then version, no timestamp — so
 * the check can be a byte comparison. It is a gate (`scripts/gates.ps1`, run by
 * CI): a dependency added, removed or upgraded without regenerating this file
 * fails it.
 *
 * `rustPackages`, `npmPackages` and `render` are exported so they can be
 * exercised on fixtures; the command runs only when this file is the entry
 * point.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 'src/features/about/notices.json';
const CRATE = 'ridgebeam';
const TRIPLE = 'x86_64-pc-windows-msvc';
const OS = 'win32';
const CPU = 'x64';

/** Said in the file itself, so a reader of the JSON knows where it came from. */
export const GENERATED =
  'node scripts/notices.mjs — Rust: cargo metadata --offline --locked, normal dependencies of ' +
  `${CRATE} for ${TRIPLE} (no dev or build dependencies); npm: package-lock.json, production ` +
  `dependencies for ${OS} ${CPU} (no dev dependencies). Do not edit by hand.`;

/** Name, then version, compared as plain strings: the same order on every machine. */
function byNameThenVersion(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  return 0;
}

/**
 * The licence a package declares, or `null` when it declares none. An empty
 * string is not a licence.
 */
function declared(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

/**
 * Every crate reachable from the root over normal edges, from the JSON of
 * `cargo metadata --format-version 1`. The root itself is not listed — it is
 * this product, whose licence the About screen already states.
 */
export function rustPackages(metadata) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const start = metadata.resolve.root;
  if (start === null || start === undefined || !nodes.has(start)) {
    throw new Error('cargo metadata has no root package; run it from src-tauri/');
  }

  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = nodes.get(queue.shift());
    for (const dep of node?.deps ?? []) {
      const normal = dep.dep_kinds.some((kind) => kind.kind === null);
      if (normal && !seen.has(dep.pkg)) {
        seen.add(dep.pkg);
        queue.push(dep.pkg);
      }
    }
  }
  seen.delete(start);

  return [...seen]
    .map((id) => {
      const pkg = packages.get(id);
      if (pkg === undefined) throw new Error(`cargo metadata names ${id} but does not describe it`);
      return { name: pkg.name, version: pkg.version, license: declared(pkg.license) };
    })
    .sort(byNameThenVersion);
}

/** True when a declared `os`/`cpu` list admits the value (npm's `!` negation included). */
function admits(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const positive = list.filter((item) => !item.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
}

/** The package name of a lockfile key: the part after the last `node_modules/`. */
function nameOf(key, entry) {
  if (typeof entry.name === 'string' && entry.name !== '') return entry.name;
  const at = key.lastIndexOf('node_modules/');
  return at === -1 ? key : key.slice(at + 'node_modules/'.length);
}

/**
 * Every package of the production tree, from a lockfile of version 2 or 3.
 * A package with no `license` in the lockfile is looked up in its installed
 * `package.json` (a `license` string, or the old `licenses` list), when
 * `installed` can read it; otherwise its licence is `null` and the command
 * reports it.
 */
export function npmPackages(lock, installed = () => null) {
  if (lock?.packages === undefined) {
    throw new Error('package-lock.json has no `packages` map; lockfile version 2 or later needed');
  }
  const out = new Map();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '' || entry.link === true) continue;
    if (entry.dev === true || entry.devOptional === true) continue;
    if (!admits(entry.os, OS) || !admits(entry.cpu, CPU)) continue;

    const name = nameOf(key, entry);
    let license = declared(entry.license);
    if (license === null) {
      const manifest = installed(key);
      license =
        declared(manifest?.license) ??
        (Array.isArray(manifest?.licenses)
          ? declared(
              manifest.licenses
                .map((item) => (typeof item === 'string' ? item : item?.type))
                .filter((item) => typeof item === 'string')
                .join(' OR '),
            )
          : null);
    }
    const item = { name, version: entry.version, license };
    out.set(`${name}@${entry.version}`, item);
  }
  return [...out.values()].sort(byNameThenVersion);
}

/**
 * The file before formatting: one package per line. `format` then passes it
 * through Prettier with the repository's own configuration (an object whose
 * first key shares its line with `{` stays on one line when it fits, and one
 * that does not fit is opened), so the formatter gate and this gate can never
 * disagree about the same bytes.
 */
export function render(rust, npm) {
  const field = (key, value) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  const row = (item) =>
    `    { ${field('name', item.name)}, ${field('version', item.version)}, ` +
    `${field('license', item.license)} }`;
  const list = (items) => (items.length === 0 ? '[]' : `[\n${items.map(row).join(',\n')}\n  ]`);
  return (
    '{\n' +
    `  "generated": ${JSON.stringify(GENERATED)},\n` +
    `  "rust": ${list(rust)},\n` +
    `  "npm": ${list(npm)}\n` +
    '}\n'
  );
}

/** `render`'s text as Prettier would leave it. */
async function format(text, target) {
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(target)) ?? {};
  return prettier.format(text, { ...options, filepath: target });
}

/** `cargo metadata`, offline, or a sentence that says why it could not run. */
function cargoMetadata() {
  const args = [
    'metadata',
    '--format-version',
    '1',
    '--offline',
    '--locked',
    '--filter-platform',
    TRIPLE,
    '--manifest-path',
    path.join(root, 'src-tauri', 'Cargo.toml'),
  ];
  try {
    return JSON.parse(
      execFileSync('cargo', args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    const stderr = String(error.stderr ?? error.message ?? '');
    const offline = /offline|download|failed to (get|load|select)|no matching package/i.test(
      stderr,
    );
    const stale = /lock file .* needs to be updated|--locked/i.test(stderr);
    const lines = ['notices: `cargo metadata` could not run without the network.'];
    if (stale) {
      lines.push(
        'Cargo.lock does not match src-tauri/Cargo.toml. Build the host once (or run',
        '`cargo generate-lockfile` in src-tauri/) so the lockfile is current, then run this again.',
      );
    } else if (offline) {
      lines.push(
        'The lockfile names crates that are not in the local cache. Run `cargo fetch` in',
        'src-tauri/ — the one step that uses the network — and run this again.',
      );
    }
    lines.push('', stderr.trim());
    throw new Error(lines.join('\n'));
  }
}

async function main() {
  const check = process.argv.includes('--check');

  const lockPath = path.join(root, 'package-lock.json');
  if (!existsSync(lockPath)) {
    console.error('notices: package-lock.json is missing; run `npm install` once.');
    return 1;
  }

  let rust;
  let npm;
  try {
    rust = rustPackages(cargoMetadata());
    npm = npmPackages(JSON.parse(readFileSync(lockPath, 'utf8')), (key) => {
      const manifest = path.join(root, key, 'package.json');
      return existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : null;
    });
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const unlicensed = [...rust, ...npm].filter((item) => item.license === null);
  const target = path.join(root, TARGET);
  const text = await format(render(rust, npm), target);

  const summary =
    `notices: ${rust.length} crates, ${npm.length} npm packages` +
    (unlicensed.length === 0
      ? ', every one with a declared licence.'
      : `; ${unlicensed.length} without a licence field: ` +
        unlicensed.map((item) => `${item.name}@${item.version}`).join(', '));

  if (check) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current !== text) {
      console.error(
        `notices: ${TARGET} is ${current === null ? 'missing' : 'out of date'} — ` +
          'a dependency changed without the list. Run `node scripts/notices.mjs` and commit it.',
      );
      return 1;
    }
    console.log(summary.replace('notices:', `notices: ${TARGET} is current —`));
    return 0;
  }

  writeFileSync(target, text);
  console.log(summary);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
