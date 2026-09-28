import {
  Board20Regular,
  ClipboardTask20Regular,
  DocumentBulletList20Regular,
  DocumentMultiple20Regular,
  Money20Regular,
  Notebook20Regular,
  GanttChartRegular,
  Info20Regular,
  Settings20Regular,
  TaskListLtr20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons';
import { Fragment, useId, type ReactNode } from 'react';

import {
  DESTINATIONS,
  DESTINATION_LABELS,
  NEEDS_WORK,
  RAIL_SEPARATOR_BEFORE,
  type Destination,
} from '@/features/shell/destinations';
import { useI18n } from '@/i18n/useI18n';

/**
 * The navigation rail.
 *
 * Every destination here is built. A destination that is planned and not built is not listed —
 * nothing on the rail pretends to work when it does not.
 *
 * Eleven destinations are two groups: the eight that show a work, and the three that are about the
 * product itself. The gap between them is a `separator`, and never a button, so the rail a
 * keyboard walks through is exactly the destinations it names.
 *
 * With no work open, the eight that show one are **unavailable, not hidden**: they stay buttons
 * with `aria-disabled`, reachable by Tab so a keyboard finds them where a pointer does, and the
 * reason is visible text — shown under the entry on hover and on focus, and wired to it as its
 * description — never a `title` tooltip that a keyboard and a screen reader cannot reach
 * (DESIGN_SYSTEM §10: degrade visibly). Pressing one leads to the Start screen, where a work is
 * created or opened: the way back from Settings, Diagnostics or About before any work exists.
 */

const ICONS: Record<Destination, ReactNode> = {
  dashboard: <Board20Regular />,
  plan: <TaskListLtr20Regular />,
  // The Gantt icon ships unsized; it is drawn at the rail's 20 px like the others.
  schedule: <GanttChartRegular fontSize={20} />,
  decisions: <ClipboardTask20Regular />,
  diary: <Notebook20Regular />,
  money: <Money20Regular />,
  documents: <DocumentMultiple20Regular />,
  reports: <DocumentBulletList20Regular />,
  settings: <Settings20Regular />,
  diagnostics: <Wrench20Regular />,
  about: <Info20Regular />,
};

export function Sidebar({
  active,
  hasWork,
  onNavigate,
}: {
  /** The destination on screen, or `null` when the Start screen is showing. */
  active: Destination | null;
  hasWork: boolean;
  onNavigate: (destination: Destination) => void;
}) {
  const { t } = useI18n();
  const reason = useId();

  return (
    <nav
      data-rail
      aria-label={t('shell.main')}
      className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-stroke-subtle bg-layer-alt p-2"
    >
      {DESTINATIONS.map((destination) => {
        const selected = destination === active;
        const unavailable = !hasWork && NEEDS_WORK.has(destination);
        const describedBy = unavailable ? `${reason}-${destination}` : undefined;
        return (
          <Fragment key={destination}>
            {destination === RAIL_SEPARATOR_BEFORE && (
              <div role="separator" className="my-1 h-px shrink-0 bg-stroke-subtle" />
            )}
            <div className="relative flex flex-col">
              <button
                type="button"
                data-destination={destination}
                aria-current={selected ? 'page' : undefined}
                aria-disabled={unavailable ? 'true' : undefined}
                aria-describedby={describedBy}
                // Unavailable is not a dead end: its description says to create or open a work,
                // and pressing it goes where that is done — the Start screen, which every
                // destination that needs a work shows while none is open. Without this, a person
                // who opened Settings before any work had no way back.
                onClick={() => onNavigate(destination)}
                className={[
                  'peer flex h-(--density-row) shrink-0 items-center gap-3 rounded-md px-3 text-body',
                  'transition-colors duration-100 ease-easy',
                  unavailable
                    ? 'cursor-not-allowed text-fg-tertiary'
                    : selected
                      ? 'bg-accent-subtle font-semibold text-fg hover:bg-card-hover'
                      : 'text-fg-secondary hover:bg-card-hover',
                ].join(' ')}
              >
                <span aria-hidden="true" className={selected ? 'text-accent' : undefined}>
                  {ICONS[destination]}
                </span>
                <span className="truncate">{t(DESTINATION_LABELS[destination])}</span>
              </button>
              {unavailable && (
                <span
                  id={describedBy}
                  // A flyout beside the entry, never a line inside the rail: text that pushed the
                  // entries below it down on hover or focus moved them out from under the pointer,
                  // and a click aimed at one landed on the next. It takes no pointer either.
                  className="pointer-events-none absolute top-1/2 left-full z-20 ml-2 hidden w-max max-w-56 -translate-y-1/2 rounded-md border border-stroke-subtle bg-flyout px-2 py-1 text-caption text-fg shadow-flyout peer-hover:block peer-focus-visible:block"
                >
                  {t('shell.needsWork')}
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
    </nav>
  );
}
