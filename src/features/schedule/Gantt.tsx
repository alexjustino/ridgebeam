import { useId } from 'react';

import { useI18n } from '@/i18n/useI18n';

/**
 * What the Gantt draws: columns of days and rows of stages and bars, already laid out.
 *
 * The layout is the domain's (`ganttLayout`, pure and benchmarked); `toGanttView` in this feature
 * turns it into this shape, and this component only draws it. x is in day columns, a row is one
 * line of the chart.
 */
export interface GanttView {
  columns: readonly { date: string; working: boolean; holiday: boolean }[];
  rows: readonly GanttRow[];
  arrows: readonly { from: string; to: string; critical: boolean }[];
}

export type GanttRow =
  | { kind: 'band'; id: string; label: string }
  | {
      kind: 'bar';
      id: string;
      label: string;
      /** The sentence a screen reader hears on the focused bar. */
      spoken: string;
      x: number;
      width: number;
      critical: boolean;
      baseline: { x: number; width: number } | null;
      /** What the diary says of it (F4): the planned bar stays; this is drawn over it. */
      state: 'not-started' | 'started' | 'finished';
      /** The days the diary says it really took, when they fall on the chart. */
      actual: { x: number; width: number } | null;
    };

/* Drawing units of the SVG's own coordinate system — the chart's geometry, not CSS. */
const DAY = 26;
const ROW = 30;
const BAR = 16;
const LABEL = 240;
const AXIS = 40;

/**
 * The Gantt chart, drawn from a layout it is given.
 *
 * The critical path is never colour alone (DESIGN_SYSTEM §2, §8): a critical bar is the solid
 * accent **and** carries a heavy outline, a plain bar is the pale tint with a thin one, and the
 * legend under the chart says which is which in words. The baseline is drawn **under** the plan,
 * never over it: a thin ghost bar at the foot of the row. Days that are not working days are
 * shaded across every row. Each bar is one Tab stop, in the chart's reading order, and says its
 * whole row in a sentence; the bands, the shading and the arrows are decoration and are hidden
 * from assistive technology.
 */
export function Gantt({ view, label }: { view: GanttView; label: string }) {
  const { language } = useI18n();
  const arrowhead = useId();
  const width = LABEL + view.columns.length * DAY;
  const height = AXIS + view.rows.length * ROW;
  const rowOf = new Map(view.rows.map((row, index) => [row.id, index]));
  const bars = new Map(
    view.rows.flatMap((row) => (row.kind === 'bar' ? [[row.id, row] as const] : [])),
  );
  const day = new Intl.DateTimeFormat(language, { day: 'numeric', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
  const at = (date: string) => new Date(`${date}T00:00:00Z`);

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="overflow-x-auto rounded-xl border border-stroke-subtle bg-card"
    >
      <svg
        data-testid="gantt"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block text-fg"
      >
        <defs>
          <marker
            id={arrowhead}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 Z" className="fill-fg-tertiary" />
          </marker>
        </defs>

        {/* The days: shading for the ones the site does not work, and the axis. */}
        <g aria-hidden="true">
          {view.columns.map((column, index) => {
            const x = LABEL + index * DAY;
            const date = at(column.date);
            const firstOfMonth = index === 0 || date.getUTCDate() === 1;
            return (
              <g key={column.date}>
                {!column.working && (
                  <rect
                    x={x}
                    y={AXIS}
                    width={DAY}
                    height={height - AXIS}
                    className="fill-card-hover"
                  />
                )}
                {firstOfMonth && (
                  <text x={x + 2} y={14} className="fill-fg-secondary text-caption">
                    {month.format(date)}
                  </text>
                )}
                <text
                  x={x + DAY / 2}
                  y={32}
                  textAnchor="middle"
                  className={
                    column.working
                      ? 'fill-fg-secondary text-caption'
                      : 'fill-fg-tertiary text-caption'
                  }
                >
                  {day.format(date)}
                </text>
              </g>
            );
          })}
          <line
            x1={LABEL}
            x2={width}
            y1={AXIS - 0.5}
            y2={AXIS - 0.5}
            className="stroke-stroke-subtle"
          />
        </g>

        {/* The rows: stage bands and activity bars, in the breakdown's order. */}
        {view.rows.map((row, index) => {
          const y = AXIS + index * ROW;
          if (row.kind === 'band') {
            return (
              <g key={row.id} aria-hidden="true">
                <rect x={0} y={y} width={width} height={ROW} className="fill-layer-alt" />
                <text x={8} y={y + ROW / 2 + 5} className="fill-fg text-body font-semibold">
                  {row.label}
                </text>
              </g>
            );
          }
          const barY = y + (ROW - BAR) / 2 - 2;
          const x = LABEL + row.x * DAY;
          const w = Math.max(row.width * DAY, 4);
          return (
            <g
              key={row.id}
              data-bar-id={row.id}
              data-critical={row.critical ? 'true' : 'false'}
              tabIndex={0}
              role="img"
              aria-label={row.spoken}
              className="group focus:outline-none"
            >
              <text x={16} y={y + ROW / 2 + 5} className="fill-fg-secondary text-body">
                {row.label.length > 30 ? `${row.label.slice(0, 29)}…` : row.label}
              </text>
              {row.baseline !== null && (
                <rect
                  x={LABEL + row.baseline.x * DAY}
                  y={barY + BAR + 2}
                  width={Math.max(row.baseline.width * DAY, 4)}
                  height={4}
                  rx={2}
                  className="fill-stroke-strong opacity-60"
                />
              )}
              <rect
                x={x + 1}
                y={barY}
                width={w - 2}
                height={BAR}
                rx={3}
                className={
                  row.critical
                    ? 'fill-accent stroke-fg [stroke-width:2.5]'
                    : 'fill-accent-subtle stroke-accent [stroke-width:1]'
                }
              />
              {/* What the diary says (ADR-020): finished fills a band across the bar and ticks
                  its end; started marks the bar's first day. Words say the same in the
                  bar's sentence — the shape is never the only reading. */}
              {row.state === 'finished' && (
                <rect
                  x={x + 3}
                  y={barY + BAR / 2 - 3}
                  width={Math.max(w - 6, 2)}
                  height={6}
                  rx={3}
                  className="fill-success"
                />
              )}
              {row.state === 'started' && (
                <path
                  d={`M ${x + 2} ${barY + 2} L ${x + 10} ${barY + BAR / 2} L ${x + 2} ${barY + BAR - 2} Z`}
                  className="fill-caution"
                />
              )}
              {row.actual !== null && (
                <line
                  x1={LABEL + row.actual.x * DAY + 2}
                  x2={LABEL + (row.actual.x + row.actual.width) * DAY - 2}
                  y1={barY - 3}
                  y2={barY - 3}
                  className="stroke-fg-secondary [stroke-width:1.5]"
                />
              )}
              {/* The focus ring, drawn: an outline is not something every SVG element gets. */}
              <rect
                x={2}
                y={y + 1}
                width={width - 4}
                height={ROW - 2}
                rx={4}
                className="fill-none stroke-(--focus-ring) opacity-0 [stroke-width:2] group-focus-visible:opacity-100"
              />
            </g>
          );
        })}

        {/* The links, from the end of what waits to be finished to the start of what waits. */}
        <g aria-hidden="true">
          {view.arrows.map((arrow) => {
            const from = bars.get(arrow.from);
            const to = bars.get(arrow.to);
            const fromRow = rowOf.get(arrow.from);
            const toRow = rowOf.get(arrow.to);
            if (!from || !to || fromRow === undefined || toRow === undefined) return null;
            const x1 = LABEL + (from.x + from.width) * DAY;
            const y1 = AXIS + fromRow * ROW + ROW / 2 - 2;
            const x2 = LABEL + to.x * DAY;
            const y2 = AXIS + toRow * ROW + ROW / 2 - 2;
            const bend = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
            return (
              <path
                key={`${arrow.from}>${arrow.to}`}
                d={`M ${x1} ${y1} H ${bend} V ${y2} H ${x2 - 1}`}
                fill="none"
                strokeWidth={arrow.critical ? 2 : 1.25}
                className={arrow.critical ? 'stroke-fg' : 'stroke-fg-tertiary'}
                markerEnd={`url(#${arrowhead})`}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
