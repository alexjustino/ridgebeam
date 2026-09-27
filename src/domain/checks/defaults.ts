/**
 * The usual checks: a small library a stage can take its checks from until templates arrive.
 *
 * Checks come from the template (SPEC §2.7); until slice F9 ships templates, a stage offers these,
 * and a button inserts them as ordinary checks the person then edits like any other. F9 replaces
 * this library with each template's own checks; the shape stays the same.
 *
 * What this module is not: text. It holds message keys; the interface resolves them into the
 * person's language and hands the host the names in that language.
 */

import type { Gate } from '../plan';

export const DEFAULT_CHECK_KEYS = {
  start: [
    'checks.default.start.previousClosed',
    'checks.default.start.materialsOnSite',
    'checks.default.start.areaProtected',
    'checks.default.start.peopleConfirmed',
  ],
  close: [
    'checks.default.close.inspected',
    'checks.default.close.photosTaken',
    'checks.default.close.ownerWalked',
    'checks.default.close.wasteRemoved',
  ],
} as const satisfies Record<Gate, readonly string[]>;

export type DefaultCheckKey = (typeof DEFAULT_CHECK_KEYS)[Gate][number];
