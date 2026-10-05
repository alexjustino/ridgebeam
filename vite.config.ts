/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

/**
 * How many test workers this machine can hold in memory.
 *
 * Vitest's default is one per core but one, which ignores memory. On a machine that runs out of
 * RAM, Windows starts failing file lookups with ERROR_NO_SYSTEM_RESOURCES (1450); libuv reports it
 * as UNKNOWN, and every resolver on the way (Node's, and the native one inside Vite 8) reads a
 * failed lookup as "no such file" — so a test file fails to load with "Cannot find module" for a
 * file that is there. Measured on an 8-core, 4 GB machine: three suites side by side failed with
 * seven or four workers each and passed with two. One worker per 2 GB, never more than the default:
 * the 16 GB CI runners keep the default, a small machine stops starving itself.
 */
function testWorkers(): number {
  const byMemory = Math.round(os.totalmem() / 2 ** 31);
  const byCores = os.availableParallelism() - 1;
  return Math.max(1, Math.min(byMemory, byCores));
}

/**
 * The commit this build came from.
 *
 * Baked in at build time so a bug report from an installed binary can be traced
 * to a line of code. Best-effort: a build from a source archive has no git, and
 * that is a reason to say "unknown" rather than to fail the build.
 */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    __GIT_COMMIT__: JSON.stringify(commit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },

  // Tauri expects a fixed port and must not have Rust errors hidden by Vite.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },

  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    // Bounded by memory, not cores — see testWorkers().
    maxWorkers: testWorkers(),
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.{test,spec}.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
