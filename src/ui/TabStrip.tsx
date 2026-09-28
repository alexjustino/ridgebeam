import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * A row of tabs.
 *
 * The WAI-ARIA tabs pattern, with automatic activation: ArrowRight and ArrowLeft move to the
 * neighbour (wrapping at either end), Home to the first tab and End to the last — and the focus
 * goes with the selection, so every press moves on from where the last one landed rather than from
 * a tab that no longer holds the focus. Only the selected tab is in the Tab order. Each tab carries
 * its id as `data-tab`, and, given a `panelId`, the tabs and the one panel point at each other
 * (`aria-controls` / the tab's `id`, `${panelId}-tab-${id}`, for the panel's `aria-labelledby`).
 */
export interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
}

/**
 * Where a key sends the focus in a row of `count` tabs, from `from`: the neighbour for the arrows
 * (wrapping), the first for Home, the last for End — `null` for any other key, which is left alone.
 */
function tabTarget(key: string, from: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight') return (from + 1) % count;
  if (key === 'ArrowLeft') return (from - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function TabStrip({
  label,
  tabs,
  active,
  onSelect,
  actions,
  panelId,
}: {
  /** The accessible name of the strip. Required — a strip with no name is a list of words. */
  label: string;
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
  actions?: ReactNode;
  /** The id of the `role="tabpanel"` the strip controls. */
  panelId?: string;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const keyed = (event: KeyboardEvent, from: number) => {
    const to = tabTarget(event.key, from, tabs.length);
    if (to === null) return;
    event.preventDefault();
    const next = tabs[to];
    if (next === undefined) return;
    onSelect(next.id);
    // The focus goes with the selection: the tab pressed from is now out of the Tab order, and a
    // press met from there would always move from the same place.
    buttons.current.get(next.id)?.focus();
  };

  return (
    <div className="flex items-end justify-between gap-4 border-b border-stroke-subtle">
      <div role="tablist" aria-label={label} className="flex gap-0.5">
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element === null) buttons.current.delete(tab.id);
                else buttons.current.set(tab.id, element);
              }}
              id={panelId === undefined ? undefined : `${panelId}-tab-${tab.id}`}
              data-tab={tab.id}
              aria-controls={panelId}
              role="tab"
              type="button"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => keyed(event, index)}
              className={[
                'relative flex items-center gap-2 px-3 py-2 text-body whitespace-nowrap',
                'transition-colors duration-100 ease-easy',
                selected ? 'font-semibold text-fg' : 'text-fg-secondary hover:text-fg',
              ].join(' ')}
            >
              {tab.icon}
              {tab.label}
              {tab.badge && <span className="text-caption text-fg-tertiary">{tab.badge}</span>}
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent"
                />
              )}
            </button>
          );
        })}
      </div>
      {actions && <div className="flex items-center gap-1 pb-1">{actions}</div>}
    </div>
  );
}
