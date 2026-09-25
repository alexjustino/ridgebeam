import {
  Board20Regular,
  ClipboardTask20Regular,
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
 * Seven destinations are two groups: the four that show a work, and the three that are about the
 * product itself. The gap between them is a `separator`, and never a button, so the rail a
 * keyboard walks through is exactly the destinations it names.
 *
 * With no work open, the two that show one are **unavailable, not hidden**: they stay buttons
 * with `aria-disabled`, reachable by Tab so a keyboard finds them where a pointer does, and the
 * reason is visible text — shown under the entry on hover and on focus, and wired to it as its
 * description — never a `title` tooltip that a keyboard and a screen reader cannot reach
 * (DESIGN_SYSTEM §10: degrade visibly).
 */

const ICONS: Record<Destination, ReactNode> = {
  dashboard: <Board20Regular />,
  plan: <TaskListLtr20Regular />,
  // The Gantt icon ships unsized; it is drawn at the rail's 20 px like the others.
  schedule: <GanttChartRegular fontSize={20} />,
  decisions: <ClipboardTask20Regular />,
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
            <div className="flex flex-col">
              <button
                type="button"
                data-destination={destination}
                aria-current={selected ? 'page' : undefined}
                aria-disabled={unavailable ? 'true' : undefined}
                aria-describedby={describedBy}
                onClick={() => {
                  if (!unavailable) onNavigate(destination);
                }}
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
                  className="hidden px-3 pt-0.5 pb-1 text-caption text-fg-tertiary peer-hover:block peer-focus-visible:block"
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
