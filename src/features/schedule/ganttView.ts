import type { GanttLayout } from '@/domain/schedule/gantt';

import type { GanttView } from './Gantt';

/** The words a bar is spoken with, from the window's language. */
export interface BarWords {
  spoken: (bar: {
    number: string;
    name: string;
    durationDays: number;
    start: string;
    finish: string;
    critical: boolean;
  }) => string;
}

/**
 * The domain's layout, as the drawing reads it. Nothing is computed here but words: the geometry,
 * the critical flags and the ghosts are `ganttLayout`'s, so the chart and every other reading of
 * the schedule are the same numbers.
 */
export function toGanttView(layout: GanttLayout, words: BarWords): GanttView {
  return {
    columns: layout.columns,
    rows: layout.rows.map((row) =>
      row.kind === 'band'
        ? { kind: 'band', id: `stage:${row.stageId}`, label: `${row.number} ${row.name}` }
        : {
            kind: 'bar',
            id: row.activityId,
            label: `${row.number ?? ''} ${row.name}`.trim(),
            spoken: words.spoken({
              number: row.number ?? '',
              name: row.name,
              durationDays: row.durationDays,
              start: row.start,
              finish: row.finish,
              critical: row.critical,
            }),
            x: row.x,
            width: row.width,
            critical: row.critical,
            baseline: row.ghost === null ? null : { x: row.ghost.x, width: row.ghost.width },
          },
    ),
    arrows: layout.arrows.map((arrow) => ({
      from: arrow.fromId,
      to: arrow.toId,
      critical: arrow.critical,
    })),
  };
}
