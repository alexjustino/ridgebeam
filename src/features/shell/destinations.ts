/**
 * The destinations, and what each one calls itself.
 *
 * Kept beside the rail rather than inside it so the shell can name the region a destination
 * opens into with the same word the navigation used to get there — which is what DESIGN_SYSTEM
 * §7 asks of every screen — without importing a component to read a label.
 */

import type { MessageKey } from '@/i18n/en';

export type Destination =
  'dashboard' | 'plan' | 'schedule' | 'decisions' | 'diary' | 'settings' | 'diagnostics' | 'about';

/** The order of the rail: the work first, then the three that are about the product itself. */
export const DESTINATIONS: readonly Destination[] = [
  'dashboard',
  'plan',
  'schedule',
  'decisions',
  'diary',
  'settings',
  'diagnostics',
  'about',
];

/**
 * Where the rail draws its one separator: before the three that are about the product rather
 * than about a work. Named here, beside the order it divides, so a destination inserted into
 * the list cannot silently land on the wrong side of the line.
 */
export const RAIL_SEPARATOR_BEFORE: Destination = 'settings';

/** The destinations that show a work, and so have nothing to show while none is open. */
export const NEEDS_WORK: ReadonlySet<Destination> = new Set<Destination>([
  'dashboard',
  'plan',
  'schedule',
  'decisions',
  'diary',
]);

export const DESTINATION_LABELS: Record<Destination, MessageKey> = {
  dashboard: 'nav.dashboard',
  plan: 'nav.plan',
  schedule: 'nav.schedule',
  decisions: 'nav.decisions',
  diary: 'nav.diary',
  settings: 'nav.settings',
  diagnostics: 'nav.diagnostics',
  about: 'nav.about',
};
